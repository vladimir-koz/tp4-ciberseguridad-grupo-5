/**
 * Gestión de sesiones.
 *
 * Correcciones aplicadas (VUL-15, VUL-16 y VUL-17 de VULNERABILIDADES.md):
 *
 *  - Identificador: 32 bytes aleatorios criptográficamente seguros (hex), en
 *    lugar de un valor incremental adivinable.
 *  - Regeneración: al iniciar sesión se descarta la sesión anterior de la
 *    petición, así un id previo (fijación de sesión) no sobrevive al login.
 *  - Cookie: HttpOnly (JavaScript no la lee), SameSite=Lax (no viaja en
 *    peticiones cruzadas que cambian estado) y Secure en producción (en
 *    desarrollo se desactiva para que la demo en http://localhost funcione).
 *  - Expiración: por inactividad (30 min, se renueva al usarse) y máxima
 *    absoluta (8 h). Se valida SIEMPRE en el servidor, no sólo en la cookie.
 *
 * El cierre de sesión en el servidor (VUL-18) se completa en auth.routes.ts,
 * usando `destruirSesion` y `limpiarCookieSesion`.
 */

import crypto from 'crypto';
import type { CookieOptions, Request, Response } from 'express';

import config from '../config';
import type { Sesion, UsuarioSesion } from '../tipos';

export const sesiones = new Map<string, Sesion>();

/** Tiempo máximo sin actividad antes de que la sesión venza. */
const TTL_INACTIVIDAD_MS = 30 * 60 * 1000;
/** Vida máxima de una sesión, aunque se use todo el tiempo. */
const TTL_MAXIMO_MS = 8 * 60 * 60 * 1000;

/**
 * Atributos de la cookie de sesión. `secure` se activa por entorno: con
 * NODE_ENV=production exige HTTPS; en desarrollo (HTTP en localhost) el
 * navegador descartaría una cookie Secure y no se podría iniciar sesión.
 */
const COOKIE_BASE: CookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: config.nodeEnv === 'production',
};

/** Lee las cookies de la petición (parser mínimo, sin dependencias). */
export function leerCookies(req: Request): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const parte of header.split(';')) {
    const separador = parte.indexOf('=');
    if (separador < 0) continue;
    const nombre = parte.slice(0, separador).trim();
    const valor = parte.slice(separador + 1).trim();
    if (!nombre) continue;
    try {
      cookies[nombre] = decodeURIComponent(valor);
    } catch {
      // Valor mal codificado (por ejemplo "%"): se ignora esa cookie en lugar
      // de dejar que la excepción termine en un error 500.
      continue;
    }
  }
  return cookies;
}

/** Elimina del almacén las sesiones que ya vencieron. */
function purgarVencidas(ahora: number): void {
  for (const [id, sesion] of sesiones) {
    if (estaVencida(sesion, ahora)) sesiones.delete(id);
  }
}

function estaVencida(sesion: Sesion, ahora: number): boolean {
  if (typeof sesion.expiraEn !== 'number') return true;
  return ahora >= sesion.expiraEn || ahora >= sesion.creadaEn + TTL_MAXIMO_MS;
}

/** Crea una sesión nueva para el usuario y setea la cookie. */
export function crearSesion(req: Request, res: Response, usuario: UsuarioSesion): string {
  const ahora = Date.now();
  purgarVencidas(ahora);

  // Regeneración del id: la sesión que traía la petición (si la había) se
  // descarta, así un identificador previo no queda válido tras autenticarse.
  const idPrevio = leerCookies(req).sid;
  if (idPrevio) sesiones.delete(idPrevio);

  // 256 bits de aleatoriedad criptográfica: no se puede adivinar ni recorrer.
  const id = crypto.randomBytes(32).toString('hex');

  sesiones.set(id, {
    usuario,
    creadaEn: ahora,
    expiraEn: ahora + TTL_INACTIVIDAD_MS,
  });

  res.cookie('sid', id, { ...COOKIE_BASE, maxAge: TTL_MAXIMO_MS });

  return id;
}

/** Devuelve la sesión de la petición, si existe y no está vencida. */
export function obtenerSesion(req: Request): Sesion | null {
  const id = leerCookies(req).sid;
  if (!id) return null;

  const sesion = sesiones.get(id);
  if (!sesion) return null;

  const ahora = Date.now();
  if (estaVencida(sesion, ahora)) {
    sesiones.delete(id);
    return null;
  }

  // Renovación por actividad, sin superar nunca el máximo absoluto.
  sesion.expiraEn = Math.min(ahora + TTL_INACTIVIDAD_MS, sesion.creadaEn + TTL_MAXIMO_MS);
  return sesion;
}

/** Cierra la sesión en el servidor (debería llamarse en el logout). */
export function destruirSesion(req: Request): void {
  const cookies = leerCookies(req);
  const id = cookies.sid;
  if (id) sesiones.delete(id);
}

/**
 * Borra la cookie del navegador con los mismos atributos con que se creó.
 * (No lleva `maxAge`: Express 4 lo convertiría en una fecha futura.)
 */
export function limpiarCookieSesion(res: Response): void {
  res.clearCookie('sid', COOKIE_BASE);
}