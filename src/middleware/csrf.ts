/**
 * Protección anti-CSRF (OWASP A01:2021) — VUL-09 de VULNERABILIDADES.md.
 *
 * El navegador manda las cookies del sitio en cualquier petición, aunque la
 * dispare otra página. Por eso la cookie de sesión sola no alcanza para
 * autorizar una operación que cambia estado: además se exige un TOKEN que
 * una página ajena no puede conocer.
 *
 * Diseño (token firmado, ligado a la sesión):
 *  - GET /api/csrf-token entrega el token. Si el navegador todavía no tiene
 *    la cookie `csrf`, se le asigna una semilla aleatoria (32 bytes) en una
 *    cookie HttpOnly + SameSite=Strict.
 *  - token = HMAC-SHA256(secreto del servidor, semilla + id de sesión).
 *    Cambia al iniciar o cerrar sesión, y no se puede fabricar sin el secreto.
 *  - Toda petición POST/PUT/PATCH/DELETE a /api debe traer el token en la
 *    cabecera `X-CSRF-Token` (o en el campo `_csrf` del cuerpo; en DELETE
 *    también como `?_csrf=`). El servidor lo recalcula y lo compara en tiempo
 *    constante. Sin token válido → 403.
 *  - Capa adicional: si la petición trae cabecera Origin y no es el propio
 *    sitio, se rechaza. No se usa Referer (la app envía
 *    Referrer-Policy: no-referrer y el navegador puede omitirlo).
 *  - Funciona también sin sesión (pedidos y reseñas son públicos): en ese caso
 *    el token queda ligado sólo a la semilla de la cookie `csrf`.
 *
 * El login queda exento del token: todavía no hay sesión que proteger y lo
 * cubren SameSite, el control de Origin y el límite de intentos.
 */

import crypto from 'crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';

import config from '../config';
import { leerCookies } from './sesion';

const COOKIE_CSRF = 'csrf';
const FORMATO_SEMILLA = /^[a-f0-9]{64}$/;
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Rutas que cambian estado pero no exigen token (ver comentario de arriba). */
const RUTAS_SIN_TOKEN = new Set(['/api/auth/login']);

const COOKIE_CSRF_OPCIONES: CookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'strict',
  secure: config.nodeEnv === 'production',
};

const ERROR_CSRF = { error: 'Token anti-CSRF inválido o ausente.', codigo: 'csrf_invalido' };
const ERROR_ORIGEN = { error: 'Origen de la petición no permitido.', codigo: 'origen_invalido' };

/** Calcula el token esperado para una semilla y una sesión. */
function firmar(semilla: string, sid: string): string {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(`${semilla}.${sid}`)
    .digest('hex');
}

/** Compara dos tokens en tiempo constante (no filtra cuántos caracteres coinciden). */
function tokensIguales(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Toma el token de la cabecera, del cuerpo o (sólo en DELETE) de la query. */
function tokenRecibido(req: Request): string | null {
  const cabecera = req.get('x-csrf-token');
  if (cabecera) return cabecera;

  const cuerpo = req.body as { _csrf?: unknown } | undefined;
  if (cuerpo && typeof cuerpo._csrf === 'string') return cuerpo._csrf;

  if (req.method === 'DELETE' && typeof req.query._csrf === 'string') return req.query._csrf;

  return null;
}

/** true si la cabecera Origin (cuando viene) corresponde al propio sitio. */
function origenPermitido(req: Request): boolean {
  const origen = req.get('origin');
  if (!origen) return true;
  try {
    return new URL(origen).host === req.get('host');
  } catch {
    return false; // incluye Origin: null (páginas locales, iframes sandbox)
  }
}

/** GET /api/csrf-token — entrega el token para la sesión actual. */
export function emitirTokenCsrf(req: Request, res: Response): void {
  const cookies = leerCookies(req);
  let semilla = cookies[COOKIE_CSRF];

  if (!semilla || !FORMATO_SEMILLA.test(semilla)) {
    semilla = crypto.randomBytes(32).toString('hex');
    res.cookie(COOKIE_CSRF, semilla, COOKIE_CSRF_OPCIONES);
  }

  res.set('Cache-Control', 'no-store');
  res.json({ token: firmar(semilla, cookies.sid || '') });
}

/** Middleware: exige un token válido en las peticiones que cambian estado. */
export function verificarCsrf(req: Request, res: Response, next: NextFunction): void {
  if (METODOS_SEGUROS.has(req.method)) {
    next();
    return;
  }

  if (!origenPermitido(req)) {
    res.status(403).json(ERROR_ORIGEN);
    return;
  }

  if (RUTAS_SIN_TOKEN.has(req.baseUrl + req.path)) {
    next();
    return;
  }

  const cookies = leerCookies(req);
  const semilla = cookies[COOKIE_CSRF];
  const token = tokenRecibido(req);

  if (
    !semilla ||
    !FORMATO_SEMILLA.test(semilla) ||
    !token ||
    !tokensIguales(token, firmar(semilla, cookies.sid || ''))
  ) {
    res.status(403).json(ERROR_CSRF);
    return;
  }

  // El token ya cumplió su función: no se pasa a la lógica de negocio.
  if (req.body && typeof req.body === 'object') delete (req.body as { _csrf?: unknown })._csrf;

  next();
}
