import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiLimitError, AiService } from '../ai/ai.service';
import { ARTICLE_FIELDS, pickAllowed, scrubText } from '../ai/data-filter';
import { GeminiError } from '../ai/gemini.client';
import { AuthUser } from '../common/auth/auth-user';
import { ROLE_LABELS } from '../common/auth/roles';
import { SettingsService } from '../settings/settings.service';
import { Article, KnowledgeService, routePath } from './knowledge.service';

export type AnswerSource = 'MODEL' | 'CONTEXT' | 'GEMINI' | 'FALLBACK' | 'NO_PERMISSION';

interface Prediction {
  articleId: string;
  confidence: number;
  alternatives: { articleId: string; confidence: number }[];
  usedContext: boolean;
  version: number;
  latencyMs: number;
}

export interface Suggestion {
  id: string;
  title: string;
  route: string | null;
}

export interface AssistantMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  source: AnswerSource | null;
  articleId: string | null;
  confidence: number | null;
  modelVersion: number | null;
  createdAt: string;
  title?: string;
  steps?: string[];
  route?: string | null;
  routeLabel?: string;
  suggestions?: Suggestion[];
  notice?: string;
}

/** T-35.2: reglas para Gemini. Solo puede usar las fichas que le enviamos. */
export const ASSISTANT_SYSTEM = [
  'Eres el asistente de ayuda de StockSense, un sistema de inventario. Respondes en español de Colombia, con tuteo, en máximo 90 palabras.',
  'Tu única fuente es el bloque FICHAS (funciones de la aplicación que la persona sí puede usar). Usa la CONVERSACIÓN solo para entender la pregunta.',
  'Reglas obligatorias:',
  '1. Si la respuesta no está en las FICHAS, pon "known": false y di con amabilidad que no lo sabes. No inventes pantallas, botones, rutas ni funciones.',
  '2. Si mencionas una ruta, copia exactamente el campo "route" de una ficha. Nunca escribas otras rutas.',
  '3. En "articleIds" pon los id de las fichas que usaste (máximo 2), en orden de importancia.',
  '4. No pidas ni repitas contraseñas, claves, costos ni datos personales.',
  '5. Si la pregunta no tiene que ver con usar StockSense, di que solo ayudas con el uso de la aplicación.',
].join('\n');

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: { type: 'STRING' },
    articleIds: { type: 'ARRAY', items: { type: 'STRING' } },
    known: { type: 'BOOLEAN' },
  },
  required: ['answer', 'articleIds', 'known'],
};

const HISTORY_MESSAGES = 6;
const CONVERSATION_IDLE_DAYS = 7;

/** Rutas escritas en un texto (/inventario/registrar, /compras/ordenes/nueva…). */
export function routesInText(text: string): string[] {
  return [...text.matchAll(/(?<![\w.])\/[a-z0-9][a-z0-9\-/]*(?:\?[a-z0-9=&-]+)?/gi)].map((m) => m[0]);
}

/** Quita del texto las rutas que no estén en el catálogo del rol. */
export function stripUnknownRoutes(text: string, allowed: Set<string>): { text: string; removed: string[] } {
  const removed: string[] = [];
  const clean = text.replace(/(?<![\w.])\/[a-z0-9][a-z0-9\-/]*(?:\?[a-z0-9=&-]+)?/gi, (route) => {
    if (allowed.has(routePath(route).replace(/\/$/, '') || '/')) return route;
    removed.push(route);
    return '(pantalla no disponible)';
  });
  return { text: clean, removed };
}

/**
 * HU-34 y HU-35: chat de ayuda.
 * 1. El modelo propio (Python) reconoce la función y da una confianza.
 * 2. Con confianza suficiente se responde con la ficha: pasos y botón, según el rol.
 * 3. Si no, Gemini responde usando la conversación y las fichas más parecidas.
 * 4. Si Gemini no está, falla o tarda más de 10 s, se sugieren las fichas más cercanas.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly knowledge: KnowledgeService,
    private readonly ai: AiService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------- conversación

  async current(user: AuthUser) {
    const [conversation] = await this.db.query(
      `SELECT id FROM assistant_conversations
        WHERE user_id = $1 AND updated_at > now() - make_interval(days => $2)
        ORDER BY updated_at DESC LIMIT 1`,
      [user.id, CONVERSATION_IDLE_DAYS],
    );
    if (!conversation) return { id: null, messages: [] as AssistantMessage[] };
    return { id: conversation.id as string, messages: await this.messages(conversation.id, 40) };
  }

  async startNew(user: AuthUser) {
    const [conversation] = await this.db.query(
      `INSERT INTO assistant_conversations (user_id) VALUES ($1) RETURNING id`,
      [user.id],
    );
    return { id: conversation.id as string, messages: [] as AssistantMessage[] };
  }

  private async ownConversation(user: AuthUser, id: string | undefined): Promise<string> {
    if (!id) return (await this.startNew(user)).id;
    const [row] = await this.db.query(`SELECT user_id AS "userId" FROM assistant_conversations WHERE id = $1`, [id]);
    if (!row) throw new NotFoundException('La conversación ya no existe. Empieza una nueva.');
    if (row.userId !== user.id) throw new ForbiddenException('Esa conversación no es tuya.');
    return id;
  }

  private async messages(conversationId: string, limit: number): Promise<AssistantMessage[]> {
    const rows = await this.db.query(
      `SELECT * FROM (
         SELECT id, role, content, source, article_id AS "articleId", confidence::float AS confidence,
                model_version AS "modelVersion", payload, created_at AS "createdAt"
           FROM assistant_messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2) m
        ORDER BY "createdAt"`,
      [conversationId, limit],
    );
    return rows.map(({ payload, ...m }: { payload: Record<string, unknown> | null } & AssistantMessage) => ({ ...m, ...(payload ?? {}) }));
  }

  // ------------------------------------------------------------------ preguntar

  async ask(user: AuthUser, text: string, conversationId?: string) {
    const question = text.trim();
    const conversation = await this.ownConversation(user, conversationId);
    const history = await this.messages(conversation, HISTORY_MESSAGES);
    const previousQuestions = history.filter((m) => m.role === 'USER').map((m) => m.content).slice(-3);
    await this.db.query(
      `INSERT INTO assistant_messages (conversation_id, role, content) VALUES ($1, 'USER', $2)`,
      [conversation, question],
    );

    const { assistantConfidenceThreshold: threshold } = await this.settings.get();
    const prediction = await this.predict(question, previousQuestions);
    const article = prediction ? this.knowledge.get(prediction.articleId) : undefined;

    let answer: Omit<AssistantMessage, 'id' | 'role' | 'createdAt'>;
    if (prediction && article && prediction.confidence >= threshold) {
      answer = this.fromArticle(user, article, prediction);
    } else {
      answer = await this.withGemini(user, question, history, prediction);
    }

    const { content, source, articleId, confidence, modelVersion, ...payload } = answer;
    const [saved] = await this.db.query(
      `INSERT INTO assistant_messages (conversation_id, role, content, source, article_id, confidence, model_version, payload)
       VALUES ($1, 'ASSISTANT', $2, $3, $4, $5, $6, $7) RETURNING id, created_at AS "createdAt"`,
      [conversation, content, source, articleId, confidence, modelVersion, JSON.stringify(payload)],
    );
    await this.db.query(`UPDATE assistant_conversations SET updated_at = now() WHERE id = $1`, [conversation]);
    return { conversationId: conversation, message: { id: saved.id, role: 'ASSISTANT', createdAt: saved.createdAt, ...answer } };
  }

  /** T-34.3: respuesta con pasos y botón, o aviso de permisos sin mostrar la ruta. */
  private fromArticle(user: AuthUser, article: Article, prediction: Prediction): Omit<AssistantMessage, 'id' | 'role' | 'createdAt'> {
    const base = {
      articleId: article.id,
      confidence: prediction.confidence,
      modelVersion: prediction.version,
      title: article.title,
    };
    if (!this.knowledge.allowed(article, user.role)) {
      return {
        ...base,
        source: 'NO_PERMISSION',
        content: `Tu rol (${ROLE_LABELS[user.role]}) no tiene permiso para «${article.title.toLowerCase()}». ${this.knowledge.whoCanHelp(article)}`,
      };
    }
    return {
      ...base,
      source: prediction.usedContext ? 'CONTEXT' : 'MODEL',
      content: article.summary,
      steps: article.steps,
      route: article.route,
      routeLabel: article.route ? `Ir a ${article.section === 'Ayuda' ? 'la pantalla' : article.section}` : undefined,
      suggestions: this.suggestions(user, prediction.alternatives.filter((a) => a.confidence >= 0.1).map((a) => a.articleId), 2),
    };
  }

  /** HU-35: Gemini responde con la conversación y las fichas más parecidas. */
  private async withGemini(
    user: AuthUser,
    question: string,
    history: AssistantMessage[],
    prediction: Prediction | null,
  ): Promise<Omit<AssistantMessage, 'id' | 'role' | 'createdAt'>> {
    const similar = await this.similar(question, history);
    const allowed = similar.filter((id) => {
      const a = this.knowledge.get(id);
      return a && this.knowledge.allowed(a, user.role);
    });
    const base = {
      articleId: null,
      confidence: prediction?.confidence ?? null,
      modelVersion: prediction?.version ?? null,
    };
    const fallback = (notice: string): Omit<AssistantMessage, 'id' | 'role' | 'createdAt'> => ({
      ...base,
      source: 'FALLBACK',
      notice,
      content: allowed.length
        ? 'No estoy seguro de haber entendido. Estas fichas pueden ayudarte:'
        : 'No estoy seguro de haber entendido. ¿Puedes contarme con otras palabras qué quieres hacer?',
      suggestions: this.suggestions(user, allowed, 3),
    });

    if (!this.ai.configured) return fallback('La ayuda con Gemini no está activa en este servidor.');
    try {
      await this.ai.assertQuota(user);
    } catch (error) {
      if (error instanceof AiLimitError) return fallback(error.message);
      throw error;
    }

    const fichas = allowed.slice(0, 4).map((id) => pickAllowed(this.knowledge.get(id)!, ARTICLE_FIELDS));
    const conversation = history
      .slice(-HISTORY_MESSAGES)
      .map((m) => `${m.role === 'USER' ? 'Persona' : 'Asistente'}: ${scrubText(m.content).slice(0, 300)}`)
      .join('\n');
    const prompt = [
      `FICHAS:\n${JSON.stringify(fichas)}`,
      `CONVERSACIÓN (lo más reciente al final):\n${conversation || '(sin mensajes anteriores)'}`,
      `PREGUNTA:\n${scrubText(question)}`,
    ].join('\n\n');
    const validRoutes = this.knowledge.routesFor(user.role);

    try {
      const { value } = await this.ai.generate(
        user,
        'ASSISTANT',
        { system: ASSISTANT_SYSTEM, prompt, schema: SCHEMA, temperature: 0.2, maxOutputTokens: 1024 },
        (r) => {
          const parsed = JSON.parse(r.text) as { answer?: string; articleIds?: string[]; known?: boolean };
          if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) throw new Error('Respuesta vacía.');
          return parsed;
        },
      );
      const ids = (value.articleIds ?? []).filter((id) => allowed.slice(0, 4).includes(id)).slice(0, 2);
      const { text, removed } = stripUnknownRoutes(value.answer!.trim(), validRoutes);
      const main = ids[0] ? this.knowledge.get(ids[0]) : undefined;
      if (removed.length) this.logger.warn(`Gemini mencionó rutas fuera del catálogo: ${removed.join(', ')}`);
      return {
        ...base,
        source: 'GEMINI',
        articleId: value.known ? (main?.id ?? null) : null,
        content: text,
        route: value.known ? (main?.route ?? null) : null,
        routeLabel: value.known && main?.route ? `Ir a ${main.section}` : undefined,
        suggestions: value.known ? this.suggestions(user, ids.slice(1), 1) : this.suggestions(user, allowed, 3),
        notice: removed.length ? 'Quitamos de la respuesta una ruta que no existe en StockSense.' : undefined,
      };
    } catch (error) {
      if (error instanceof AiLimitError) return fallback(error.message);
      if (error instanceof GeminiError && error.kind === 'TIMEOUT') {
        return fallback(`Gemini tardó más de ${this.ai.timeoutSeconds} segundos en responder.`);
      }
      if (error instanceof GeminiError) return fallback('No pudimos consultar a Gemini en este momento.');
      this.logger.warn(`Respuesta de Gemini inválida: ${(error as Error).message}`);
      return fallback('La respuesta de Gemini no vino en el formato esperado.');
    }
  }

  private suggestions(user: AuthUser, ids: string[], limit: number): Suggestion[] {
    return ids
      .map((id) => this.knowledge.get(id))
      .filter((a): a is Article => !!a && this.knowledge.allowed(a, user.role))
      .slice(0, limit)
      .map((a) => ({ id: a.id, title: a.title, route: a.route }));
  }

  // ------------------------------------------------------- modelo propio (Python)

  private async python<T>(path: string, body: unknown): Promise<T | null> {
    const base = this.config.get<string>('FORECAST_URL');
    if (!base) return null;
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': this.config.get<string>('FORECAST_TOKEN') ?? '' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn(`El modelo del asistente no respondió (${path}): ${(error as Error).message}`);
      return null;
    }
  }

  private predict(text: string, previous: string[]) {
    return this.python<Prediction>('/assistant/predict', { text, previous });
  }

  /** T-35.1: fichas parecidas a la pregunta (con contexto si es de seguimiento). */
  private async similar(question: string, history: AssistantMessage[]): Promise<string[]> {
    const lastUser = history.filter((m) => m.role === 'USER').at(-1)?.content;
    const text = question.split(/\s+/).length <= 6 && lastUser ? `${lastUser} ${question}` : question;
    const result = await this.python<{ items: { articleId: string; score: number }[] }>('/assistant/similar', { text, k: 6 });
    const items = result?.items ?? this.knowledge.keywordSearch(text, 6);
    return items.filter((i) => i.score > 0.05).map((i) => i.articleId);
  }

  // ---------------------------------------------------------- administración

  async models() {
    const versions = await this.db.query(
      `SELECT id, version, status, is_active AS "isActive", accuracy::float AS accuracy, train_size AS "trainSize",
              test_size AS "testSize", articles, reason, duration_ms AS "durationMs", trained_at AS "trainedAt",
              metrics->'latencyMsAvg' AS "latencyMsAvg", metrics->'thresholds' AS thresholds,
              metrics->'confusions' AS confusions
         FROM assistant_models ORDER BY version DESC LIMIT 20`,
    );
    const [{ articles, examples }] = await this.db.query(
      `SELECT count(*)::int AS articles, COALESCE(sum(jsonb_array_length(examples)), 0)::int AS examples FROM assistant_articles`,
    );
    const [answers] = await this.db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE source IN ('MODEL', 'CONTEXT'))::int AS model,
              count(*) FILTER (WHERE source = 'GEMINI')::int AS gemini,
              count(*) FILTER (WHERE source = 'FALLBACK')::int AS fallback,
              count(*) FILTER (WHERE source = 'NO_PERMISSION')::int AS "noPermission"
         FROM assistant_messages WHERE role = 'ASSISTANT' AND created_at > now() - interval '30 days'`,
    );
    return { versions, knowledge: { articles, examples }, answers };
  }
}
