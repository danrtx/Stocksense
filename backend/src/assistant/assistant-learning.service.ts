import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { scrubText } from '../ai/data-filter';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { KnowledgeService } from './knowledge.service';

export type ExampleStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED';

/** Igual que `normalize` del modelo en Python: minúsculas, sin tildes ni signos. */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Una pregunta sirve de ejemplo si se entiende sola (no «¿y luego?»). */
export function goodExample(text: string): boolean {
  const words = normalizeQuestion(text).split(' ').filter(Boolean);
  return words.length >= 3 && words.length <= 40;
}

const DEFAULT_RETRAIN = { enabled: true, weekday: 7, time: '04:00' };
const WEEKDAYS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/**
 * HU-36: el asistente mejora con el uso.
 * T-36.1 calificación y ejemplos por aprobar; T-36.3 métricas. El reentrenamiento
 * programado (T-36.2) lo hace el servicio de Python con los ejemplos aprobados.
 */
@Injectable()
export class AssistantLearningService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly knowledge: KnowledgeService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ calificación

  async rate(user: AuthUser, messageId: string, rating: 1 | -1) {
    const [message] = await this.db.query(
      `SELECT m.id, m.role, m.source, m.article_id AS "articleId", m.conversation_id AS "conversationId",
              m.created_at AS "createdAt", c.user_id AS "userId"
         FROM assistant_messages m JOIN assistant_conversations c ON c.id = m.conversation_id
        WHERE m.id = $1`,
      [messageId],
    );
    if (!message || message.role !== 'ASSISTANT') throw new NotFoundException('No encontramos esa respuesta.');
    if (message.userId !== user.id) throw new ForbiddenException('Solo puedes calificar las respuestas de tu conversación.');

    await this.db.query(`UPDATE assistant_messages SET rating = $2, rated_at = now() WHERE id = $1`, [messageId, rating]);

    let proposed = false;
    if (rating === -1) {
      // Si la persona cambió de opinión, el ejemplo que todavía no se revisó se retira.
      await this.db.query(`DELETE FROM assistant_examples WHERE message_id = $1 AND status = 'PROPOSED'`, [messageId]);
    } else if (message.source === 'GEMINI' && message.articleId && this.knowledge.get(message.articleId)) {
      const [question] = await this.db.query(
        `SELECT content FROM assistant_messages
          WHERE conversation_id = $1 AND role = 'USER' AND created_at <= $2
          ORDER BY created_at DESC LIMIT 1`,
        [message.conversationId, message.createdAt],
      );
      // Correos, teléfonos o claves que la persona haya escrito no llegan a los ejemplos.
      const text = question ? scrubText(question.content).trim().slice(0, 500) : '';
      if (text && goodExample(text)) {
        const rows = await this.db.query(
          `INSERT INTO assistant_examples (article_id, text, normalized, message_id)
           VALUES ($1, $2, $3, $4) ON CONFLICT (article_id, normalized) DO NOTHING RETURNING id`,
          [message.articleId, text, normalizeQuestion(text).slice(0, 500), messageId],
        );
        proposed = rows.length > 0;
      }
    }
    return { id: messageId, rating, proposedExample: proposed };
  }

  // ------------------------------------------------------- ejemplos por aprobar

  async examples(status: ExampleStatus = 'PROPOSED') {
    const rows: { id: string; articleId: string; text: string; status: ExampleStatus; origin: string; proposedAt: string; reviewedAt: string | null; reviewedBy: string | null; answer: string | null }[] =
      await this.db.query(
        `SELECT e.id, e.article_id AS "articleId", e.text, e.status, e.origin, e.proposed_at AS "proposedAt",
                e.reviewed_at AS "reviewedAt", u.full_name AS "reviewedBy", m.content AS answer
           FROM assistant_examples e
           LEFT JOIN users u ON u.id = e.reviewed_by
           LEFT JOIN assistant_messages m ON m.id = e.message_id
          WHERE e.status = $1
          ORDER BY ${status === 'PROPOSED' ? 'e.proposed_at' : 'e.reviewed_at DESC'}
          LIMIT 200`,
        [status],
      );
    const [counts] = await this.db.query(
      `SELECT count(*) FILTER (WHERE status = 'PROPOSED')::int AS proposed,
              count(*) FILTER (WHERE status = 'APPROVED')::int AS approved,
              count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected
         FROM assistant_examples`,
    );
    return {
      items: rows.map((r) => ({ ...r, articleTitle: this.knowledge.get(r.articleId)?.title ?? r.articleId })),
      counts,
      articles: this.knowledge.articles.map((a) => ({ id: a.id, title: a.title, section: a.section })),
    };
  }

  /** Aprobar (con la ficha correcta y el texto corregido, si hace falta) o descartar. */
  async review(admin: AuthUser, id: string, input: { status: 'APPROVED' | 'REJECTED'; articleId?: string; text?: string }) {
    const [example] = await this.db.query(`SELECT id, article_id AS "articleId", text, status FROM assistant_examples WHERE id = $1`, [id]);
    if (!example) throw new NotFoundException('Ese ejemplo ya no existe.');
    const articleId = input.articleId ?? example.articleId;
    if (!this.knowledge.get(articleId)) throw new BadRequestException('Esa ficha no existe.');
    const text = (input.text ?? example.text).trim();
    if (input.status === 'APPROVED' && !goodExample(text)) {
      throw new BadRequestException('El ejemplo debe ser una pregunta completa, de 3 a 40 palabras.');
    }
    const normalized = normalizeQuestion(text);
    const [duplicate] = await this.db.query(
      `SELECT id FROM assistant_examples WHERE article_id = $1 AND normalized = $2 AND id <> $3`,
      [articleId, normalized, id],
    );
    if (duplicate) {
      // Ya hay un ejemplo igual para esa ficha: este sobra.
      await this.db.query(`DELETE FROM assistant_examples WHERE id = $1`, [id]);
      return { id, status: 'DUPLICATE' as const };
    }
    await this.db.query(
      `UPDATE assistant_examples SET status = $2, article_id = $3, text = $4, normalized = $5, reviewed_by = $6, reviewed_at = now()
        WHERE id = $1`,
      [id, input.status, articleId, text.slice(0, 500), normalized.slice(0, 500), admin.id],
    );
    await this.audit.record({
      actor: admin,
      action: input.status === 'APPROVED' ? 'assistant.example_approved' : 'assistant.example_rejected',
      entityType: 'assistant_example',
      entityId: id,
      changes: { text, article: articleId, ...(articleId !== example.articleId ? { previousArticle: example.articleId } : {}) },
    });
    return { id, status: input.status };
  }

  // ------------------------------------------------------------------ métricas

  async metrics(days = 30) {
    const period = Math.min(365, Math.max(1, Math.round(days)));
    const answered = `role = 'ASSISTANT' AND created_at > now() - make_interval(days => $1)`;
    const [totals] = await this.db.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE source IN ('MODEL', 'CONTEXT'))::int AS model,
              count(*) FILTER (WHERE source = 'GEMINI' AND article_id IS NOT NULL)::int AS gemini,
              count(*) FILTER (WHERE source = 'FALLBACK' OR (source = 'GEMINI' AND article_id IS NULL))::int AS unanswered,
              count(*) FILTER (WHERE source = 'NO_PERMISSION')::int AS "noPermission",
              count(*) FILTER (WHERE rating = 1)::int AS "ratedUp",
              count(*) FILTER (WHERE rating = -1)::int AS "ratedDown",
              count(*) FILTER (WHERE rating = 1 AND source IN ('MODEL', 'CONTEXT'))::int AS "modelUp",
              count(*) FILTER (WHERE rating = -1 AND source IN ('MODEL', 'CONTEXT'))::int AS "modelDown",
              count(*) FILTER (WHERE rating = 1 AND source = 'GEMINI')::int AS "geminiUp",
              count(*) FILTER (WHERE rating = -1 AND source = 'GEMINI')::int AS "geminiDown"
         FROM assistant_messages WHERE ${answered}`,
      [period],
    );
    const weeks = await this.db.query(
      `SELECT to_char(date_trunc('week', created_at AT TIME ZONE 'America/Bogota'), 'YYYY-MM-DD') AS week,
              count(*)::int AS total,
              count(*) FILTER (WHERE source IN ('MODEL', 'CONTEXT'))::int AS model,
              count(*) FILTER (WHERE source = 'GEMINI' AND article_id IS NOT NULL)::int AS gemini,
              count(*) FILTER (WHERE source = 'FALLBACK' OR (source = 'GEMINI' AND article_id IS NULL))::int AS unanswered
         FROM assistant_messages
        WHERE role = 'ASSISTANT' AND created_at > date_trunc('week', now()) - interval '7 weeks'
        GROUP BY 1 ORDER BY 1`,
    );
    const unanswered = await this.db.query(
      `SELECT a.id, q.content AS question, a.created_at AS "createdAt",
              CASE WHEN a.rating = -1 THEN 'RATED_DOWN' WHEN a.source = 'FALLBACK' THEN 'FALLBACK' ELSE 'UNKNOWN' END AS reason,
              a.source
         FROM assistant_messages a
         JOIN LATERAL (
           SELECT content FROM assistant_messages u
            WHERE u.conversation_id = a.conversation_id AND u.role = 'USER' AND u.created_at <= a.created_at
            ORDER BY u.created_at DESC LIMIT 1) q ON true
        WHERE a.role = 'ASSISTANT' AND a.created_at > now() - make_interval(days => $1)
          AND (a.source = 'FALLBACK' OR (a.source = 'GEMINI' AND a.article_id IS NULL) OR a.rating = -1)
        ORDER BY a.created_at DESC LIMIT 25`,
      [period],
    );
    const [pending] = await this.db.query(`SELECT count(*)::int AS n FROM assistant_examples WHERE status = 'PROPOSED'`);
    const [approved] = await this.db.query(`SELECT count(*)::int AS n FROM assistant_examples WHERE status = 'APPROVED'`);
    const [model] = await this.db.query(
      `SELECT version, accuracy::float AS accuracy, trained_at AS "trainedAt", metrics->>'approvedExamples' AS "approvedExamples"
         FROM assistant_models WHERE is_active`,
    );
    const [setting] = await this.db.query(`SELECT value FROM app_settings WHERE key = 'assistant.retrain'`);
    const retrain = { ...DEFAULT_RETRAIN, ...(setting?.value ?? {}) } as typeof DEFAULT_RETRAIN;
    const share = (n: number) => (totals.total ? Math.round((n / totals.total) * 1000) / 1000 : null);
    const rated = totals.ratedUp + totals.ratedDown;
    return {
      days: period,
      totals,
      shares: { model: share(totals.model), gemini: share(totals.gemini), unanswered: share(totals.unanswered), noPermission: share(totals.noPermission) },
      satisfaction: rated ? Math.round((totals.ratedUp / rated) * 1000) / 1000 : null,
      weeks,
      unanswered,
      examples: { pending: pending.n, approved: approved.n },
      model: model
        ? { version: model.version, accuracy: model.accuracy, trainedAt: model.trainedAt, approvedExamples: model.approvedExamples == null ? null : Number(model.approvedExamples) }
        : null,
      retrain: { ...retrain, label: retrain.enabled ? `Cada ${WEEKDAYS[retrain.weekday] ?? 'semana'} a las ${retrain.time}` : 'Desactivado' },
    };
  }
}
