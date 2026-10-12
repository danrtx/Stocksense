import http from 'node:http';
import { AddressInfo } from 'node:net';

export interface FakeRequest {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

type Handler = (req: FakeRequest) => { status?: number; body: unknown; delayMs?: number } | Promise<{ status?: number; body: unknown; delayMs?: number }>;

/**
 * Servidor HTTP de mentira que hace de servicio de Python (/assistant/*) y de Gemini
 * (/v1beta/models/...:generateContent) en las pruebas. Cada prueba cambia los manejadores.
 */
export class FakeServices {
  calls: FakeRequest[] = [];
  predict: Handler = () => ({ status: 503, body: { detail: 'sin modelo' } });
  similar: Handler = () => ({ body: { version: 1, items: [] } });
  gemini: Handler = () => ({ status: 500, body: { error: { message: 'sin configurar' } } });
  private server?: http.Server;
  url = '';

  async start() {
    this.server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        const request: FakeRequest = { path: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : {} };
        this.calls.push(request);
        const handler: Handler = request.path.startsWith('/assistant/predict')
          ? this.predict
          : request.path.startsWith('/assistant/similar')
            ? this.similar
            : request.path.includes(':generateContent')
              ? this.gemini
              : () => ({ status: 404, body: {} });

        const out = await handler(request);
        if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs));
        if (res.destroyed) return;
        res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out.body));
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
    return this;
  }

  reset() {
    this.calls = [];
    this.predict = () => ({ status: 503, body: { detail: 'sin modelo' } });
    this.similar = () => ({ body: { version: 1, items: [] } });
    this.gemini = () => ({ status: 500, body: { error: { message: 'sin configurar' } } });
  }

  geminiCalls() {
    return this.calls.filter((c) => c.path.includes(':generateContent'));
  }

  stop() {
    this.server?.closeAllConnections();
    return new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

/** Respuesta de Gemini con un JSON como texto y conteo de tokens. */
export function geminiReply(value: unknown, tokens = { prompt: 900, output: 120 }) {
  return {
    body: {
      candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: tokens.prompt, candidatesTokenCount: tokens.output, thoughtsTokenCount: 30 },
    },
  };
}

/** El JSON de DATOS o FICHAS que la API le mandó a Gemini. */
export function sentPrompt(call: FakeRequest): string {
  const contents = call.body.contents as { parts: { text: string }[] }[];
  return contents[0].parts[0].text;
}
