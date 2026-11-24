import express from 'express';
import rateLimit from 'express-rate-limit';
import * as usuarios from '../services/usuarios.service';
import {
  crearSesion,
  destruirSesion,
  limpiarCookieSesion,
  obtenerSesion,
} from '../middleware/sesion';

const router = express.Router();

/**
 * Límite de intentos de login fallidos (fuerza bruta):
 * máximo 5 intentos fallidos por IP cada 15 minutos.
 * Los logins correctos no cuentan. Al superar el límite responde 429.
 */
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.' },
});

/**
 * Inicio de sesión.
 */
router.post('/login', limitadorLogin, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Falta usuario o contraseña.' });
    }

    const usuario = await usuarios.autenticar(username, password);

    if (!usuario) {
      // Mismo estado y mismo mensaje para "no existe" y "clave incorrecta":
      // no se puede averiguar qué cuentas existen, y no se refleja la entrada.
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    crearSesion(req, res, {
      id: usuario.id,
      username: usuario.username,
      rol: usuario.rol,
      nombre: usuario.nombre,
    });

    res.json({
      mensaje: `¡Bienvenido, ${usuario.nombre}!`,
      usuario: {
        id: usuario.id,
        username: usuario.username,
        rol: usuario.rol,
        nombre: usuario.nombre,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Cierre de sesión.
 *
 * Invalida la sesión EN EL SERVIDOR (la borra del almacén) y además limpia la
 * cookie del navegador: con un `sid` robado ya no se puede seguir operando.
 * Es idempotente: si no había sesión, responde igual.
 */
router.post('/logout', (req, res) => {
  destruirSesion(req);
  limpiarCookieSesion(res);
  res.json({ mensaje: 'Sesión cerrada.' });
});

/** Devuelve el usuario de la sesión actual. */
router.get('/yo', (req, res) => {
  const sesion = obtenerSesion(req);
  if (!sesion) {
    return res.status(401).json({ error: 'Necesitás iniciar sesión.' });
  }
  res.json({ usuario: sesion.usuario });
});

export default router;