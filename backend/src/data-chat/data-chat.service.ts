import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AiLimitError, AiService } from '../ai/ai.service';
import { scrubText } from '../ai/data-filter';
import { GeminiClient, GeminiContent, GeminiError, GeminiPart } from '../ai/gemini.client';
import { AuthUser } from '../common/auth/auth-user';
import { Permission, permissionsFor, ROLE_LABELS, roleHas } from '../common/auth/roles';
import { unknownNumbers, wordCount } from '../forecast/number-check';
import { DataTool, OUT_OF_SCOPE, Query, ToolOutput, toolsFor } from './tools';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatSource extends ToolOutput {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  consultedAt: string;
}

export type ChatStatus = 'OK' | 'OUT_OF_SCOPE' | 'UNVERIFIED' | 'FAILED' | 'UNAVAILABLE' | 'LIMIT' | 'DIRECT';

export interface ChatAnswer {
  id: string;
  status: ChatStatus;
  answer: string | null;
  message?: string;
  sources: ChatSource[];
  suggestions: Suggestion[];
  model?: string;
  latencyMs?: number;
}

export interface Suggestion {
  text: string;
  /** Herramienta y argumentos para responder sin Gemini (modo directo). */
  tool: string;
  args: Record<string, unknown>;
}

const SUGGESTIONS: Suggestion[] = [
  { text: '¿Qué productos se agotan este mes?', tool: 'productos_por_agotarse', args: { semanas: 4 } },
  { text: '¿Qué productos están bajo el punto de reorden?', tool: 'productos_bajo_reorden', args: {} },
  { text: '¿Qué fue lo más vendido en los últimos 30 días?', tool: 'ventas_resumen', args: { agrupar: 'producto' } },
  { text: '¿Cuánto vale mi inventario por categoría?', tool: 'valor_inventario', args: { agrupar: 'categoria' } },
  { text: '¿Qué órdenes de compra siguen abiertas?', tool: 'ordenes_compra_abiertas', args: {} },
  { text: '¿Hay ventas o mermas raras sin revisar?', tool: 'anomalias_abiertas', args: {} },
  { text: '¿Cuáles son los últimos movimientos?', tool: 'movimientos_recientes', args: { dias: 7 } },
];

const MAX_ROUNDS = 5;
const MAX_CALLS_PER_ROUND = 4;
const ROWS_FOR_GEMINI = 25;

const OUT_OF_SCOPE_MESSAGES: Record<string, (role: string) => string> = {
  no_es_inventario: () =>
    'Solo puedo responder sobre el inventario, las ventas, las compras y el pronóstico de tu negocio. Prueba con alguna de estas preguntas:',
  pide_modificar: () =>
    'Desde aquí solo consulto datos: no puedo crear, cambiar ni borrar nada. Para registrar o modificar algo usa la pantalla correspondiente (por ejemplo, Inventario › Registrar entrada o salida). Puedo ayudarte con preguntas como estas:',
  sin_permiso: (role) =>
    `Tu rol (${role}) no tiene acceso a esa información, por ejemplo costos o márgenes. Si la necesitas, pídesela a una persona administradora. Esto sí te lo puedo responder:`,
  otro: () => 'No puedo responder esa pregunta con los datos de StockSense. Prueba con alguna de estas:',
};

function system(user: AuthUser, tools: DataTool[], today: string) {
  return [
    'Eres el asistente de datos de StockSense, un sistema de inventario para negocios en Colombia.',
    `Hoy es ${today}. La persona tiene el rol ${ROLE_LABELS[user.role]} y escribe en español; responde en español de Colombia, con tuteo.`,
    'Reglas obligatorias:',
    '1. Toda cifra, producto o fecha de tu respuesta debe salir de los resultados de las herramientas de esta conversación. Nunca inventes ni estimes. No calcules sumas, promedios ni porcentajes nuevos.',
    '2. Si la pregunta necesita datos, llama primero a la herramienta adecuada (puedes llamar varias). Si un producto se nombra de forma aproximada, busca con buscar_productos.',
    '3. Si la pregunta no es sobre el inventario, ventas, compras o pronóstico del negocio, si pide crear, cambiar o borrar algo, o si necesita datos que ninguna de tus herramientas da (por ejemplo costos sin la herramienta valor_inventario), llama a fuera_de_alcance y no escribas nada más.',
    '4. Respuesta corta: máximo 120 palabras. Para listas usa viñetas que empiecen con «- », máximo 8. Sin tablas, sin encabezados y sin mencionar el nombre de las herramientas ni SQL: la pantalla ya muestra los datos consultados.',
    '5. Las cantidades van con su unidad. Si una herramienta trae una «nota», tenla en cuenta.',
    '6. Si los resultados vienen vacíos, dilo con claridad.',
    `Herramientas disponibles para este rol: ${tools.map((t) => t.name).join(', ')}.`,
  ].join('\n');
}

/**
 * HU-25: preguntas al inventario en lenguaje natural.
 *
 * Gemini decide qué herramientas de solo lectura llamar; la API las ejecuta con los
 * permisos de la persona y le devuelve los resultados; Gemini redacta la respuesta y la
 * API verifica que cada cifra esté en esos resultados antes de mostrarla. Las consultas
 * hechas se muestran como «fuentes».
 */
@Injectable()
export class DataChatService {
  private readonly logger = new Logger(DataChatService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly ai: AiService,
    private readonly gemini: GeminiClient,
    private readonly config: ConfigService,
  ) {}

  get timeoutMs() {
    return Number(this.config.get('GEMINI_CHAT_TIMEOUT_MS') ?? 25_000);
  }

  suggestions(user: AuthUser): Suggestion[] {
    const allowed = new Set(toolsFor(permissionsFor(user.role)).map((t) => t.name));
    return SUGGESTIONS.filter((s) => allowed.has(s.tool)).slice(0, 5);
  }

  status(user: AuthUser) {
    return {
      configured: this.ai.configured,
      tools: toolsFor(permissionsFor(user.role)).map((t) => t.name),
      suggestions: this.suggestions(user),
      canSeeCost: roleHas(user.role, Permission.ProductsCostRead),
    };
  }

  /** Corre una función dentro de una transacción de solo lectura con tiempo máximo. */
  async readOnly<T>(fn: (q: Query) => Promise<T>): Promise<T> {
    const runner = this.db.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('BEGIN TRANSACTION READ ONLY');
      await runner.query(`SET LOCAL statement_timeout = '4000'`);
      const out = await fn((sql, params) => runner.query(sql, params));
      await runner.query('ROLLBACK');
      return out;
    } catch (error) {
      await runner.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await runner.release();
    }
  }

  private async execute(tool: DataTool, args: Record<string, unknown>, user: AuthUser): Promise<ChatSource> {
    const output = await this.readOnly((q) => tool.run(q, args, { canSeeCost: roleHas(user.role, Permission.ProductsCostRead) }));
    return { ...output, id: randomUUID(), tool: tool.name, args, consultedAt: new Date().toISOString() };
  }

  /** Modo directo: una sugerencia se responde con su herramienta, sin Gemini. */
  async direct(user: AuthUser, toolName: string): Promise<ChatAnswer> {
    const suggestion = SUGGESTIONS.find((s) => s.tool === toolName);
    const tool = toolsFor(permissionsFor(user.role)).find((t) => t.name === toolName);
    if (!suggestion || !tool) throw new BadRequestException('Esa consulta no está disponible para tu rol.');
    const source = await this.execute(tool, suggestion.args, user);
    const n = source.total;
    return {
      id: randomUUID(),
      status: 'DIRECT',
      answer:
        n === 0
          ? `No encontré resultados para «${suggestion.text}».`
          : `${source.title}: ${n === 1 ? 'hay 1 resultado' : `hay ${n} resultados`}${n > source.rows.length ? `, te muestro los primeros ${source.rows.length}` : ''}.`,
      sources: [source],
      suggestions: [],
    };
  }

  async ask(user: AuthUser, rawQuestion: string, history: ChatTurn[] = []): Promise<ChatAnswer> {
    const id = randomUUID();
    const question = rawQuestion.trim().slice(0, 500);
    const suggestions = this.suggestions(user);
    if (!this.ai.configured) {
      return {
        id,
        status: 'UNAVAILABLE',
        answer: null,
        message: 'Las preguntas libres necesitan Gemini y no está activo en este servidor. Mientras tanto, estas consultas responden con tus datos:',
        sources: [],
        suggestions,
      };
    }
    try {
      await this.ai.assertQuota(user);
    } catch (error) {
      if (error instanceof AiLimitError) return { id, status: 'LIMIT', answer: null, message: error.message, sources: [], suggestions };
      throw error;
    }

    const started = Date.now();
    const deadline = started + this.timeoutMs;
    const tools = toolsFor(permissionsFor(user.role));
    const declarations = [...tools.map(({ name, description, parameters }) => ({ name, description, ...(parameters ? { parameters } : {}) })), OUT_OF_SCOPE];
    const today = new Intl.DateTimeFormat('es-CO', { dateStyle: 'full', timeZone: 'America/Bogota' }).format(new Date());
    const todayIso = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota' }).format(new Date());

    const contents: GeminiContent[] = [
      ...history.slice(-6).map((t) => ({
        role: (t.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
        parts: [{ text: scrubText(String(t.text ?? '')).slice(0, 600) }],
      })),
      { role: 'user', parts: [{ text: scrubText(question) }] },
    ];
    const sources: ChatSource[] = [];
    const evidence: unknown[] = [question, todayIso];
    const usage = { promptTokens: 0, outputTokens: 0 };
    let model = this.gemini.model;
    let answer: string | null = null;
    let outOfScope: string | null = null;
    let retried = false;
    let invented: string[] = [];

    const finish = async (status: ChatStatus, logStatus: string, extra: Partial<ChatAnswer> = {}): Promise<ChatAnswer> => {
      await this.ai.recordUsage(user, 'DATA_CHAT', {
        status: logStatus,
        model,
        latencyMs: Date.now() - started,
        detail: `${status}: ${sources.map((s) => s.tool).join(', ') || 'sin consultas'}`,
        ...usage,
      });
      return { id, status, answer: null, sources, suggestions: [], model, latencyMs: Date.now() - started, ...extra };
    };

    try {
      for (let round = 0; round < MAX_ROUNDS && Date.now() < deadline; round++) {
        const result = await this.gemini.chat({ system: system(user, tools, today), contents, tools: declarations, deadline });
        usage.promptTokens += result.promptTokens;
        usage.outputTokens += result.outputTokens;
        model = result.model;
        const calls = result.parts.filter((p) => p.functionCall);

        if (!calls.length) {
          const text = result.parts
            .filter((p) => !p.thought && typeof p.text === 'string')
            .map((p) => p.text)
            .join('')
            .trim();
          invented = unknownNumbers(text, evidence);
          if (!invented.length && wordCount(text) <= 180) {
            answer = text;
            break;
          }
          if (retried) break;
          // Un segundo intento diciéndole qué corregir.
          retried = true;
          contents.push({ role: 'model', parts: result.parts });
          contents.push({
            role: 'user',
            parts: [
              {
                text: invented.length
                  ? `Tu respuesta usa cifras que no están en los resultados de las herramientas: ${invented.slice(0, 6).join(', ')}. Escríbela de nuevo usando solo cifras de los resultados.`
                  : 'Tu respuesta es demasiado larga. Escríbela de nuevo en máximo 120 palabras.',
              },
            ],
          });
          continue;
        }

        contents.push({ role: 'model', parts: result.parts });
        const responses: GeminiPart[] = [];
        for (const part of calls.slice(0, MAX_CALLS_PER_ROUND)) {
          const call = part.functionCall!;
          if (call.name === OUT_OF_SCOPE.name) {
            outOfScope = typeof call.args?.motivo === 'string' ? call.args.motivo : 'otro';
            break;
          }
          const tool = tools.find((t) => t.name === call.name);
          let response: Record<string, unknown>;
          if (!tool) {
            response = { error: 'Esa herramienta no existe o este rol no puede usarla.' };
            this.logger.warn(`Gemini pidió una herramienta no permitida para ${user.role}: ${call.name}`);
          } else {
            try {
              const source = await this.execute(tool, call.args ?? {}, user);
              sources.push(source);
              response = { filas: source.rows.slice(0, ROWS_FOR_GEMINI), totalFilas: source.total, ...(source.extra ?? {}) };
              evidence.push(response);
            } catch (error) {
              this.logger.error(`La herramienta ${call.name} falló: ${(error as Error).message}`);
              response = { error: 'La consulta falló. Di que no pudiste obtener ese dato.' };
            }
          }
          responses.push({ functionResponse: { name: call.name, response, ...(call.id ? { id: call.id } : {}) } });
        }
        if (outOfScope) break;
        contents.push({ role: 'user', parts: responses });
      }
    } catch (error) {
      if (error instanceof GeminiError) {
        const timeout = error.kind === 'TIMEOUT';
        usage.promptTokens += error.usage?.promptTokens ?? 0;
        usage.outputTokens += error.usage?.outputTokens ?? 0;
        return finish('FAILED', timeout ? 'TIMEOUT' : 'ERROR', {
          message: timeout
            ? `Gemini tardó más de ${Math.round(this.timeoutMs / 1000)} segundos. ${sources.length ? 'Abajo están los datos que alcancé a consultar.' : 'Intenta de nuevo o usa una de estas consultas:'}`
            : `Gemini no respondió en este momento. ${sources.length ? 'Abajo están los datos que alcancé a consultar.' : 'Prueba con una de estas consultas:'}`,
          suggestions: sources.length ? [] : suggestions,
        });
      }
      throw error;
    }

    if (outOfScope) {
      const message = (OUT_OF_SCOPE_MESSAGES[outOfScope] ?? OUT_OF_SCOPE_MESSAGES.otro)(ROLE_LABELS[user.role]);
      return finish('OUT_OF_SCOPE', 'OK', { message, sources: [], suggestions });
    }
    if (answer) return finish('OK', 'OK', { answer });
    if (invented.length) {
      this.logger.warn(`Respuesta del chat rechazada por cifras no verificadas: ${invented.join(', ')}`);
      return finish('UNVERIFIED', 'REJECTED', {
        message: 'No pude verificar todas las cifras de la respuesta, así que no la muestro. Estos son los datos consultados:',
      });
    }
    return finish('FAILED', Date.now() >= deadline ? 'TIMEOUT' : 'ERROR', {
      message: sources.length ? 'No alcancé a redactar la respuesta. Estos son los datos consultados:' : 'No logré responder esa pregunta. Prueba con una de estas:',
      suggestions: sources.length ? [] : suggestions,
    });
  }
}
