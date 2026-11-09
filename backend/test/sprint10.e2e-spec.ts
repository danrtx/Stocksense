import { DataSource } from 'typeorm';
import { Role } from '../src/common/auth/roles';
import { FakeServices, geminiReply } from './fakes';
import { bearer, createTestApp, createUser, login, resetDatabase, TestContext } from './helpers';

const lowConfidence = (articleId: string) => ({
  body: { articleId, confidence: 0.2, alternatives: [], usedContext: false, version: 4, latencyMs: 2 },
});
const highConfidence = (articleId: string) => ({
  body: { articleId, confidence: 0.93, alternatives: [], usedContext: false, version: 4, latencyMs: 2 },
});

describe('Sprint 10 · El asistente mejora con el uso (HU-36)', () => {
  let ctx: TestContext;
  let db: DataSource;
  let fake: FakeServices;
  let admin: string;
  let bodega: string;
  let compras: string;

  beforeAll(async () => {
    fake = await new FakeServices().start();
    process.env.FORECAST_URL = fake.url;
    process.env.GEMINI_BASE_URL = fake.url;
    process.env.GEMINI_API_KEY = 'clave-de-prueba-gemini';
    ctx = await createTestApp();
    db = ctx.db;
  });
  afterAll(async () => {
    await ctx.app.close();
    await fake.stop();
    for (const key of ['FORECAST_URL', 'GEMINI_BASE_URL', 'GEMINI_API_KEY']) delete process.env[key];
  });
  beforeEach(async () => {
    await resetDatabase(db);
    fake.reset();
    await createUser(db, { email: 'ana@x.co', role: Role.Admin, fullName: 'Ana Admin' });
    await createUser(db, { email: 'bruno@x.co', role: Role.Bodega });
    await createUser(db, { email: 'marta@x.co', role: Role.Compras });
    [admin, bodega, compras] = await Promise.all(['ana@x.co', 'bruno@x.co', 'marta@x.co'].map((e) => login(ctx, e)));
  });

  const ask = (token: string, text: string, conversationId?: string) =>
    ctx.http().post('/api/assistant/messages').set(bearer(token)).send({ text, conversationId }).expect(200);
  const rate = (token: string, id: string, rating: number, status = 200) =>
    ctx.http().post(`/api/assistant/messages/${id}/rating`).set(bearer(token)).send({ rating }).expect(status);

  async function geminiAnswer(token: string, question: string, articleId = 'transferir') {
    fake.predict = () => lowConfidence(articleId);
    fake.similar = () => ({ body: { version: 4, items: [{ articleId, score: 0.7 }] } });
    fake.gemini = () => geminiReply({ answer: 'Ve a Inventario › Transferencias y crea una nueva.', articleIds: [articleId], known: true });
    return (await ask(token, question)).body;
  }

  it('T-36.1: «Me sirvió» en una respuesta de Gemini propone la pregunta como ejemplo, sin datos personales', async () => {
    const answer = await geminiAnswer(bodega, 'necesito mandar cajas al local del centro, escríbeme a bruno@x.co');
    const res = await rate(bodega, answer.message.id, 1);
    expect(res.body).toMatchObject({ rating: 1, proposedExample: true });

    // Queda guardada en el historial de la conversación.
    const history = await ctx.http().get('/api/assistant/conversation').set(bearer(bodega)).expect(200);
    expect(history.body.messages.at(-1).rating).toBe(1);

    const list = await ctx.http().get('/api/assistant/examples').set(bearer(admin)).expect(200);
    expect(list.body.counts).toMatchObject({ proposed: 1, approved: 0 });
    expect(list.body.items[0]).toMatchObject({ articleId: 'transferir', status: 'PROPOSED' });
    expect(list.body.items[0].text).not.toContain('bruno@x.co');
    expect(list.body.articles.length).toBeGreaterThan(10);

    // Calificar otra vez no duplica; cambiar a «No me sirvió» retira la propuesta.
    await rate(bodega, answer.message.id, 1);
    expect((await ctx.http().get('/api/assistant/examples').set(bearer(admin))).body.counts.proposed).toBe(1);
    await rate(bodega, answer.message.id, -1);
    expect((await ctx.http().get('/api/assistant/examples').set(bearer(admin))).body.counts.proposed).toBe(0);
  });

  it('T-36.1: no se proponen respuestas del modelo propio, ni preguntas cortas; solo la dueña califica', async () => {
    fake.predict = () => highConfidence('registrar-salida');
    const own = (await ask(bodega, '¿cómo registro una salida de inventario?')).body;
    expect(own.message.source).toBe('MODEL');
    expect((await rate(bodega, own.message.id, 1)).body.proposedExample).toBe(false);

    const short = await geminiAnswer(bodega, 'y luego?');
    expect((await rate(bodega, short.message.id, 1)).body.proposedExample).toBe(false);

    await rate(compras, short.message.id, 1, 403);
    await rate(bodega, short.message.id, 5, 400);
    await rate(bodega, '6b7c0f1e-1a2b-4c3d-8e9f-001122334455', 1, 404);
  });

  it('T-36.1: la persona administradora aprueba (corrigiendo la ficha) o descarta, y queda en la auditoría', async () => {
    const a = await geminiAnswer(bodega, 'quiero pasar unas cajas de una bodega a otra');
    await rate(bodega, a.message.id, 1);
    const b = await geminiAnswer(bodega, 'cómo saco el reporte de algo que no existe', 'transferir');
    await rate(bodega, b.message.id, 1);
    const [first, second] = (await ctx.http().get('/api/assistant/examples').set(bearer(admin))).body.items;

    await ctx.http().patch(`/api/assistant/examples/${first.id}`).set(bearer(bodega)).send({ status: 'APPROVED' }).expect(403);
    await ctx.http().patch(`/api/assistant/examples/${first.id}`).set(bearer(admin)).send({ status: 'APPROVED', text: 'hola' }).expect(400);
    await ctx.http().patch(`/api/assistant/examples/${first.id}`).set(bearer(admin)).send({ status: 'APPROVED', articleId: 'no-existe' }).expect(400);
    await ctx.http()
      .patch(`/api/assistant/examples/${first.id}`)
      .set(bearer(admin))
      .send({ status: 'APPROVED', articleId: 'transferir', text: 'Quiero pasar unas cajas de una bodega a otra' })
      .expect(200);
    await ctx.http().patch(`/api/assistant/examples/${second.id}`).set(bearer(admin)).send({ status: 'REJECTED' }).expect(200);

    const approved = await ctx.http().get('/api/assistant/examples?status=APPROVED').set(bearer(admin)).expect(200);
    expect(approved.body.items).toHaveLength(1);
    expect(approved.body.items[0]).toMatchObject({ text: 'Quiero pasar unas cajas de una bodega a otra', reviewedBy: 'Ana Admin' });
    const audit = await db.query(`SELECT action FROM audit_logs WHERE entity_type = 'assistant_example' ORDER BY created_at`);
    expect(audit.map((r: { action: string }) => r.action)).toEqual(['assistant.example_approved', 'assistant.example_rejected']);
  });

  it('T-36.3: el panel separa modelo propio, Gemini y sin respuesta, con las preguntas que quedaron sin resolver', async () => {
    fake.predict = () => highConfidence('registrar-salida');
    const own = (await ask(bodega, '¿cómo registro una salida?')).body;
    await rate(bodega, own.message.id, 1);
    const good = await geminiAnswer(bodega, 'necesito mover mercancía entre bodegas');
    await rate(bodega, good.message.id, -1);
    fake.gemini = () => geminiReply({ answer: 'No encontré eso en la ayuda de StockSense.', articleIds: [], known: false });
    await ask(bodega, '¿puedo pagar la nómina desde aquí?');
    fake.predict = () => ({ status: 503, body: { detail: 'sin modelo' } });
    fake.gemini = () => ({ status: 503, body: {} });
    await ask(bodega, '¿cómo cambio el color del logo?');

    await ctx.http().get('/api/assistant/metrics').set(bearer(bodega)).expect(403);
    const res = await ctx.http().get('/api/assistant/metrics?days=30').set(bearer(admin)).expect(200);
    expect(res.body.totals).toMatchObject({ total: 4, model: 1, gemini: 1, unanswered: 2, ratedUp: 1, ratedDown: 1 });
    expect(res.body.shares).toMatchObject({ model: 0.25, gemini: 0.25, unanswered: 0.5 });
    expect(res.body.satisfaction).toBe(0.5);
    const questions = res.body.unanswered.map((u: { question: string }) => u.question);
    expect(questions).toEqual(
      expect.arrayContaining(['¿puedo pagar la nómina desde aquí?', '¿cómo cambio el color del logo?', 'necesito mover mercancía entre bodegas']),
    );
    expect(res.body.weeks.at(-1)).toMatchObject({ total: 4 });
    expect(res.body.retrain.label).toBe('Cada domingo a las 04:00');
  });
});
