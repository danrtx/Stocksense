import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Permission, Role, ROLE_LABELS, ROLE_PERMISSIONS, roleHas } from '../common/auth/roles';
import knowledge from './knowledge/articles.json';

/** HU-32: una ficha por función de la aplicación. */
export interface Article {
  id: string;
  title: string;
  section: string;
  summary: string;
  /** Pantalla a la que lleva el botón (null = acción sin pantalla propia). */
  route: string | null;
  /** Otras rutas de la aplicación que esta ficha explica (por ejemplo, /productos/:id). */
  covers?: string[];
  /** Permisos que exige (todos). Vacío = cualquier persona con sesión. */
  permissions: string[];
  /** Basta con uno de estos permisos. */
  anyPermissions?: string[];
  steps: string[];
  /** Frases en infinitivo que se combinan con las plantillas («registrar una salida»). */
  phrases: string[];
  /** Preguntas completas escritas a mano. */
  examples: string[];
  keywords?: string[];
}

export const MIN_EXAMPLES = 20;
const RAW = knowledge as { version: number; templates: string[]; articles: (Omit<Article, 'permissions'> & { permissions?: string[] })[] };
const KB = { ...RAW, articles: RAW.articles.map((a) => ({ ...a, permissions: a.permissions ?? [] })) as Article[] };
export const KNOWLEDGE = KB;

/** Preguntas de ejemplo: las escritas a mano más cada frase en cada plantilla. */
export function expandExamples(article: Article, templates: string[] = KB.templates): string[] {
  const generated = article.phrases.flatMap((phrase) => templates.map((t) => t.replace('{p}', phrase)));
  return [...new Set([...article.examples, ...generated].map((e) => e.trim()).filter(Boolean))];
}

export function articleAllowed(article: Pick<Article, 'permissions' | 'anyPermissions'>, role: Role): boolean {
  const all = article.permissions.every((p) => roleHas(role, p as Permission));
  const any = !article.anyPermissions?.length || article.anyPermissions.some((p) => roleHas(role, p as Permission));
  return all && any;
}

/** Roles que sí pueden usar una ficha («pídeselo a…»). */
export function rolesThatCan(article: Pick<Article, 'permissions' | 'anyPermissions'>): Role[] {
  return (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) => articleAllowed(article, role));
}

/** Ruta sin parámetros de búsqueda (/inventario/registrar?tipo=salida → /inventario/registrar). */
export const routePath = (route: string) => route.split('?')[0].split('#')[0];

@Injectable()
export class KnowledgeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeService.name);
  readonly articles: Article[] = KB.articles;
  private readonly byId = new Map(KB.articles.map((a) => [a.id, a]));

  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Al arrancar, la tabla queda igual al archivo (el servicio de Python entrena desde la tabla). */
  async onApplicationBootstrap() {
    try {
      await this.sync();
    } catch (error) {
      this.logger.error(`No se pudieron sincronizar las fichas del asistente: ${(error as Error).message}`);
    }
  }

  async sync() {
    await this.db.transaction(async (m) => {
      for (const a of this.articles) {
        await m.query(
          `INSERT INTO assistant_articles (id, title, summary, route, section, steps, permissions, any_permissions, examples, keywords, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary, route = EXCLUDED.route,
             section = EXCLUDED.section, steps = EXCLUDED.steps, permissions = EXCLUDED.permissions,
             any_permissions = EXCLUDED.any_permissions, examples = EXCLUDED.examples, keywords = EXCLUDED.keywords,
             updated_at = CASE WHEN assistant_articles.examples IS DISTINCT FROM EXCLUDED.examples
                                 OR assistant_articles.title IS DISTINCT FROM EXCLUDED.title
                               THEN now() ELSE assistant_articles.updated_at END`,
          [
            a.id,
            a.title,
            a.summary,
            a.route,
            a.section,
            JSON.stringify(a.steps),
            a.permissions,
            a.anyPermissions ?? [],
            JSON.stringify(expandExamples(a)),
            a.keywords ?? [],
          ],
        );
      }
      await m.query(`DELETE FROM assistant_articles WHERE NOT (id = ANY($1))`, [this.articles.map((a) => a.id)]);
    });
  }

  get(id: string): Article | undefined {
    return this.byId.get(id);
  }

  allowed(article: Article, role: Role) {
    return articleAllowed(article, role);
  }

  /** T-32.3: solo las funciones que el rol puede usar. */
  forRole(role: Role) {
    return this.articles
      .filter((a) => articleAllowed(a, role))
      .map((a) => ({
        id: a.id,
        title: a.title,
        section: a.section,
        summary: a.summary,
        route: a.route,
        steps: a.steps,
        examples: a.examples.slice(0, 5),
      }));
  }

  /** Rutas que una persona con este rol puede abrir (para validar lo que diga Gemini). */
  routesFor(role: Role): Set<string> {
    const routes = new Set<string>();
    for (const a of this.articles) {
      if (!articleAllowed(a, role) || !a.route) continue;
      routes.add(routePath(a.route));
    }
    return routes;
  }

  /** «Pídeselo a una persona administradora o a alguien con rol Compras.» */
  whoCanHelp(article: Article): string {
    const others = rolesThatCan(article).filter((r) => r !== Role.Admin).map((r) => ROLE_LABELS[r]);
    const admin = 'una persona administradora (puede cambiar tu rol en Usuarios)';
    if (others.length === 0) return `Pídeselo a ${admin}.`;
    return `Pídeselo a ${admin} o a alguien con rol ${others.join(' o ')}.`;
  }

  /** Respaldo si el servicio de Python no responde: coincidencia simple de palabras. */
  keywordSearch(text: string, k = 4): { articleId: string; score: number }[] {
    const words = new Set(normalize(text).split(' ').filter((w) => w.length > 3));
    if (words.size === 0) return [];
    return this.articles
      .map((a) => {
        const haystack = new Set(normalize([a.title, a.summary, ...(a.keywords ?? []), ...a.phrases].join(' ')).split(' '));
        let hits = 0;
        for (const w of words) if (haystack.has(w)) hits += 1;
        return { articleId: a.id, score: hits / words.size };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
