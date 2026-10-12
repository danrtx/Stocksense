import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * T-23.1: cliente de Gemini con tiempo máximo y reintentos.
 *
 * - La clave (GEMINI_API_KEY) solo se lee del entorno o del gestor de secretos del
 *   servidor; nunca viaja al navegador ni se escribe en logs.
 * - Todo el intento, incluidos los reintentos, cabe en GEMINI_TIMEOUT_MS (10 s por defecto).
 * - Se reintenta ante 429 y errores 5xx o de red, con espera creciente.
 */
export type GeminiErrorKind = 'NOT_CONFIGURED' | 'TIMEOUT' | 'ERROR' | 'BLOCKED';

export class GeminiError extends Error {
  constructor(
    readonly kind: GeminiErrorKind,
    message: string,
    readonly usage?: { promptTokens: number; outputTokens: number },
  ) {
    super(message);
  }
}

export interface GeminiRequest {
  system: string;
  prompt: string;
  /** Esquema de la respuesta JSON (subconjunto OpenAPI que acepta Gemini). */
  schema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GeminiResult {
  text: string;
  model: string;
  promptTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

@Injectable()
export class GeminiClient {
  private readonly logger = new Logger(GeminiClient.name);

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return this.config.get<string>('GEMINI_MODEL') || 'gemini-3.1-pro-preview';
  }

  get configured(): boolean {
    return Boolean(this.config.get<string>('GEMINI_API_KEY'));
  }

  get timeoutMs(): number {
    return Number(this.config.get('GEMINI_TIMEOUT_MS') ?? 10_000);
  }

  async generate(request: GeminiRequest): Promise<GeminiResult> {
    const key = this.config.get<string>('GEMINI_API_KEY');
    if (!key) throw new GeminiError('NOT_CONFIGURED', 'Gemini no está configurado en el servidor.');
    const base = (this.config.get<string>('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const url = `${base}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const body = JSON.stringify(this.body(request));

    const started = Date.now();
    const deadline = started + this.timeoutMs;
    let attempt = 0;
    let lastError: GeminiError = new GeminiError('ERROR', 'Gemini no respondió.');
    while (Date.now() < deadline) {
      attempt += 1;
      const remaining = deadline - Date.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body,
          signal: AbortSignal.timeout(Math.max(1, remaining)),
        });
      } catch (error) {
        const name = (error as Error).name;
        if (name === 'TimeoutError' || name === 'AbortError' || Date.now() >= deadline) {
          throw new GeminiError('TIMEOUT', `Gemini tardó más de ${Math.round(this.timeoutMs / 1000)} segundos.`);
        }
        lastError = new GeminiError('ERROR', 'No pudimos conectarnos con Gemini.');
        if (!(await this.backoff(attempt, deadline))) break;
        continue;
      }

      const data = (await response.json().catch(() => ({}))) as GeminiResponse;
      if (!response.ok) {
        // Nunca se registra la clave; solo el código y el mensaje de Google.
        this.logger.warn(`Gemini respondió ${response.status}: ${data.error?.message ?? 'sin detalle'}`);
        lastError = new GeminiError('ERROR', `Gemini respondió con un error (${response.status}).`);
        if (RETRYABLE.has(response.status) && (await this.backoff(attempt, deadline))) continue;
        throw lastError;
      }

      const usage = {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        // Los tokens de razonamiento se cobran como salida.
        outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
      };
      const candidate = data.candidates?.[0];
      if (data.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY') {
        throw new GeminiError('BLOCKED', 'Gemini no quiso responder esta solicitud.', usage);
      }
      const text = (candidate?.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join('')
        .trim();
      if (!text) throw new GeminiError('ERROR', 'Gemini devolvió una respuesta vacía.', usage);
      return { text, model: this.model, ...usage, latencyMs: Date.now() - started, attempts: attempt };
    }
    if (Date.now() >= deadline) {
      throw new GeminiError('TIMEOUT', `Gemini tardó más de ${Math.round(this.timeoutMs / 1000)} segundos.`);
    }
    throw lastError;
  }

  private body(request: GeminiRequest) {
    const generationConfig: Record<string, unknown> = {
      temperature: request.temperature ?? 0.2,
      maxOutputTokens: request.maxOutputTokens ?? 1024,
    };
    if (request.schema) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = request.schema;
    }
    // Poco razonamiento: respuestas cortas y dentro de los 10 segundos.
    if (this.model.startsWith('gemini-2.5')) {
      generationConfig.thinkingConfig = { thinkingBudget: this.model.includes('pro') ? 128 : 0 };
    } else if (this.model.startsWith('gemini-3')) {
      generationConfig.thinkingConfig = { thinkingLevel: this.config.get<string>('GEMINI_THINKING_LEVEL') || 'low' };
    }
    return {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
      generationConfig,
    };
  }

  /** Espera antes de reintentar. Devuelve false si ya no hay tiempo. */
  private async backoff(attempt: number, deadline: number): Promise<boolean> {
    const wait = Math.min(2000, 300 * 2 ** (attempt - 1));
    if (Date.now() + wait >= deadline - 500 || attempt >= 3) return false;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return true;
  }
}
