import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';

/** Ajustes que se cambian desde la aplicación, sin tocar código ni reiniciar. */
export interface AiSettings {
  /** HU-33: debajo de esta confianza el asistente le pide ayuda a Gemini (0 a 1). */
  assistantConfidenceThreshold: number;
  /** HU-21: productos con error (WAPE) mayor a este valor se marcan para revisión (0 a 5). */
  forecastErrorThreshold: number;
  /** HU-22: reentrenamiento semanal. weekday: 1 = lunes … 7 = domingo. */
  retrain: { enabled: boolean; weekday: number; time: string };
  /** HU-23: llamadas a Gemini por persona y por mes. */
  monthlyLimitPerUser: number;
}

const KEYS = {
  assistantConfidenceThreshold: 'assistant.confidenceThreshold',
  forecastErrorThreshold: 'forecast.errorThreshold',
  retrain: 'forecast.retrain',
  monthlyLimitPerUser: 'ai.monthlyLimitPerUser',
} as const;

export const DEFAULT_SETTINGS: AiSettings = {
  assistantConfidenceThreshold: 0.55,
  forecastErrorThreshold: 0.5,
  retrain: { enabled: true, weekday: 1, time: '03:00' },
  monthlyLimitPerUser: 100,
};

export const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

@Injectable()
export class SettingsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<AiSettings & { updatedAt: string | null }> {
    const rows: { key: string; value: unknown; updated_at: string }[] = await this.db.query(
      `SELECT key, value, updated_at FROM app_settings WHERE key = ANY($1)`,
      [Object.values(KEYS)],
    );
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const pick = <K extends keyof AiSettings>(name: K): AiSettings[K] =>
      (byKey.get(KEYS[name]) as AiSettings[K] | undefined) ?? DEFAULT_SETTINGS[name];
    const updatedAt = rows.reduce<string | null>((max, r) => (!max || r.updated_at > max ? r.updated_at : max), null);
    return {
      assistantConfidenceThreshold: Number(pick('assistantConfidenceThreshold')),
      forecastErrorThreshold: Number(pick('forecastErrorThreshold')),
      retrain: { ...DEFAULT_SETTINGS.retrain, ...(pick('retrain') as object) },
      monthlyLimitPerUser: Number(pick('monthlyLimitPerUser')),
      updatedAt,
    };
  }

  async update(patch: Partial<AiSettings>, actor: AuthUser) {
    const current = await this.get();
    const next: AiSettings = {
      assistantConfidenceThreshold: patch.assistantConfidenceThreshold ?? current.assistantConfidenceThreshold,
      forecastErrorThreshold: patch.forecastErrorThreshold ?? current.forecastErrorThreshold,
      retrain: { ...current.retrain, ...(patch.retrain ?? {}) },
      monthlyLimitPerUser: patch.monthlyLimitPerUser ?? current.monthlyLimitPerUser,
    };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.retrain.time)) {
      throw new BadRequestException('La hora del reentrenamiento debe tener el formato HH:MM (24 horas).');
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    await this.db.transaction(async (m) => {
      for (const name of Object.keys(KEYS) as (keyof AiSettings)[]) {
        if (JSON.stringify(current[name]) === JSON.stringify(next[name])) continue;
        changes[name] = { from: current[name], to: next[name] };
        await m.query(
          `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [KEYS[name], JSON.stringify(next[name]), actor.id],
        );
      }
      if (Object.keys(changes).length > 0) {
        await this.audit.record({ actor, action: 'settings.updated', entityType: 'settings', changes }, m);
      }
    });
    return this.get();
  }
}

/** «lunes a las 03:00» para mostrar el horario. */
export function describeSchedule(retrain: AiSettings['retrain']): string {
  if (!retrain.enabled) return 'Reentrenamiento automático apagado';
  return `Cada ${WEEKDAYS[retrain.weekday - 1]} a las ${retrain.time} (hora de Bogotá)`;
}
