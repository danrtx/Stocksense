import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthUser } from '../common/auth/auth-user';
import { SettingsService } from '../settings/settings.service';
import { GeminiClient, GeminiError, GeminiRequest, GeminiResult } from './gemini.client';

export type AiFeature = 'EXPLAIN' | 'ASSISTANT';

export class AiLimitError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      limit === 0
        ? 'Las funciones con IA están apagadas para todas las personas este mes.'
        : `Ya usaste tus ${limit} consultas con IA de este mes. El resto de StockSense sigue funcionando; el cupo se renueva el primer día del próximo mes.`,
    );
  }
}

/** Inicio del mes en Bogotá (el cupo se renueva el día 1 a las 00:00 hora local). */
const MONTH_START = `date_trunc('month', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'`;

/**
 * HU-23: toda llamada a Gemini pasa por aquí.
 * Revisa el cupo mensual de la persona (T-23.3), llama a Gemini y registra tokens, costo
 * estimado, tiempo y resultado, tanto si sale bien como si falla.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly gemini: GeminiClient,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  get configured() {
    return this.gemini.configured;
  }

  get model() {
    return this.gemini.model;
  }

  get timeoutSeconds() {
    return Math.round(this.gemini.timeoutMs / 1000);
  }

  async quota(userId: string) {
    const [{ used }] = await this.db.query(
      `SELECT count(*)::int AS used FROM ai_usage WHERE user_id = $1 AND created_at >= ${MONTH_START}`,
      [userId],
    );
    const { monthlyLimitPerUser: limit } = await this.settings.get();
    return { used, limit, remaining: Math.max(0, limit - used) };
  }

  /** Lanza AiLimitError si la persona ya gastó su cupo del mes. */
  async assertQuota(user: AuthUser) {
    const quota = await this.quota(user.id);
    if (quota.used >= quota.limit) throw new AiLimitError(quota.used, quota.limit);
    return quota;
  }

  /**
   * Llama a Gemini y registra el uso. `validate` puede rechazar la respuesta (por ejemplo,
   * si trae cifras inventadas); en ese caso queda registrada como REJECTED.
   */
  async generate<T>(
    user: AuthUser,
    feature: AiFeature,
    request: GeminiRequest,
    validate: (result: GeminiResult) => T,
  ): Promise<{ value: T; result: GeminiResult }> {
    let result: GeminiResult;
    try {
      result = await this.gemini.generate(request);
    } catch (error) {
      if (error instanceof GeminiError && error.kind !== 'NOT_CONFIGURED') {
        await this.record(user, feature, {
          status: error.kind === 'TIMEOUT' ? 'TIMEOUT' : 'ERROR',
          promptTokens: error.usage?.promptTokens ?? 0,
          outputTokens: error.usage?.outputTokens ?? 0,
          detail: error.message,
        });
      }
      throw error;
    }
    try {
      const value = validate(result);
      await this.record(user, feature, { status: 'OK', ...result });
      return { value, result };
    } catch (error) {
      await this.record(user, feature, { status: 'REJECTED', ...result, detail: (error as Error).message });
      throw error;
    }
  }

  costUsd(promptTokens: number, outputTokens: number): number {
    const input = Number(this.config.get('GEMINI_PRICE_INPUT_PER_M') ?? 2);
    const output = Number(this.config.get('GEMINI_PRICE_OUTPUT_PER_M') ?? 12);
    return (promptTokens / 1_000_000) * input + (outputTokens / 1_000_000) * output;
  }

  private async record(
    user: AuthUser,
    feature: AiFeature,
    data: { status: string; promptTokens?: number; outputTokens?: number; latencyMs?: number; detail?: string; model?: string },
  ) {
    try {
      await this.db.query(
        `INSERT INTO ai_usage (user_id, feature, model, status, prompt_tokens, output_tokens, cost_usd, latency_ms, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.id,
          feature,
          data.model ?? this.gemini.model,
          data.status,
          data.promptTokens ?? 0,
          data.outputTokens ?? 0,
          this.costUsd(data.promptTokens ?? 0, data.outputTokens ?? 0),
          data.latencyMs ?? null,
          data.detail?.slice(0, 300) ?? null,
        ],
      );
    } catch (error) {
      this.logger.error(`No se pudo registrar el uso de IA: ${(error as Error).message}`);
    }
  }

  /** Consumo del mes para la persona administradora. */
  async usage() {
    const [totals] = await this.db.query(
      `SELECT count(*)::int AS calls,
              count(*) FILTER (WHERE status = 'OK')::int AS ok,
              count(*) FILTER (WHERE status IN ('ERROR', 'TIMEOUT'))::int AS failed,
              count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
              COALESCE(sum(prompt_tokens), 0)::int AS "promptTokens",
              COALESCE(sum(output_tokens), 0)::int AS "outputTokens",
              COALESCE(sum(cost_usd), 0)::float AS "costUsd",
              COALESCE(avg(latency_ms) FILTER (WHERE status = 'OK'), 0)::int AS "avgLatencyMs"
         FROM ai_usage WHERE created_at >= ${MONTH_START}`,
    );
    const byUser = await this.db.query(
      `SELECT u.id, u.full_name AS "fullName", u.email, u.role,
              count(*)::int AS calls,
              COALESCE(sum(a.prompt_tokens + a.output_tokens), 0)::int AS tokens,
              COALESCE(sum(a.cost_usd), 0)::float AS "costUsd",
              count(*) FILTER (WHERE a.feature = 'EXPLAIN')::int AS explain,
              count(*) FILTER (WHERE a.feature = 'ASSISTANT')::int AS assistant
         FROM ai_usage a JOIN users u ON u.id = a.user_id
        WHERE a.created_at >= ${MONTH_START}
        GROUP BY u.id ORDER BY calls DESC LIMIT 50`,
    );
    const recent = await this.db.query(
      `SELECT a.created_at AS "createdAt", a.feature, a.status, a.model, a.prompt_tokens AS "promptTokens",
              a.output_tokens AS "outputTokens", a.cost_usd::float AS "costUsd", a.latency_ms AS "latencyMs",
              a.detail, u.full_name AS "user"
         FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC LIMIT 20`,
    );
    const { monthlyLimitPerUser } = await this.settings.get();
    return {
      configured: this.configured,
      model: this.model,
      timeoutSeconds: Math.round(this.gemini.timeoutMs / 1000),
      monthlyLimitPerUser,
      totals,
      byUser,
      recent,
    };
  }

  async feedback(user: AuthUser, data: { feature: AiFeature; targetId?: string; content: string; comment?: string }) {
    const [row] = await this.db.query(
      `INSERT INTO ai_feedback (user_id, feature, target_id, content, comment) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at AS "createdAt"`,
      [user.id, data.feature, data.targetId ?? null, data.content.slice(0, 4000), data.comment?.slice(0, 500) ?? null],
    );
    return row;
  }

  listFeedback() {
    return this.db.query(
      `SELECT f.id, f.feature, f.target_id AS "targetId", f.content, f.comment, f.created_at AS "createdAt",
              u.full_name AS "user"
         FROM ai_feedback f LEFT JOIN users u ON u.id = f.user_id
        ORDER BY f.created_at DESC LIMIT 30`,
    );
  }
}
