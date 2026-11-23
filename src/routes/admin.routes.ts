import express from 'express';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

import config from '../config';
import * as catalogo from '../services/catalogo.service';
import * as usuarios from '../services/usuarios.service';
import { requiereSesion, requiereRol } from '../middleware/auth';
import type { Rol, Usuario } from '../tipos';

const router = express.Router();

/**
 * Rutas del panel de administración.
 *
 * Autorización (OWASP A01:2021): TODAS las rutas de este router exigen una
 * sesión válida y el rol "admin". El control se aplica a nivel de router,
 * antes del ruteo, así que también cubre cualquier ruta que se agregue después
 * (y una ruta inexistente responde 401/403 en lugar de revelar un 404).
 */
router.use(requiereSesion, requiereRol('admin'));

/** Roles que se pueden asignar (lista blanca). */
const ROLES_PERMITIDOS: readonly Rol[] = ['admin', 'barista', 'mozo', 'cliente'];

/** Máximo valor de una columna INTEGER / SERIAL de PostgreSQL. */
const ID_MAXIMO = 2147483647;

/** Formato de nombre de usuario admitido. */
const FORMATO_USERNAME = /^[A-Za-z0-9._-]{3,30}$/;
const LONGITUD_NOMBRE = { min: 2, max: 60 };

/** Valida un id de la URL: entero positivo dentro del rango de la base. */
function validarId(valor: string): number | null {
  if (!/^\d+$/.test(valor)) return null;
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0 || id > ID_MAXIMO) return null;
  return id;
}

/** Datos de un usuario que se pueden mostrar: nunca la contraseña (ni su hash). */
function usuarioPublico(usuario: Usuario) {
  const { id, username, rol, nombre, creado_en } = usuario;
  return { id, username, rol, nombre, creado_en };
}

/** GET /api/admin/usuarios */
router.get('/usuarios', async (req, res, next) => {
  try {
    const lista = await usuarios.listar();
    res.json({ usuarios: lista.map(usuarioPublico) });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/usuarios/:id
 *
 * Escalada de privilegios: el cuerpo ya no se copia tal cual (asignación
 * masiva). Sólo se aceptan `username`, `nombre` y `rol`, cada uno validado:
 *  - el rol sólo lo cambia un admin y tiene que estar en la lista blanca,
 *  - nadie puede cambiar su PROPIO rol (ni subirse ni bajarse por error),
 *  - la contraseña no se modifica por esta ruta (tiene su propio flujo).
 */
router.put('/usuarios/:id', async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'El identificador de usuario no es válido.' });
    }

    const { username, nombre, rol, password } = req.body || {};
    if (password !== undefined) {
      return res.status(400).json({ error: 'La contraseña no se puede modificar desde esta operación.' });
    }

    const cambios: Partial<Usuario> = {};

    if (username !== undefined) {
      if (typeof username !== 'string' || !FORMATO_USERNAME.test(username)) {
        return res.status(400).json({
          error: 'El usuario debe tener entre 3 y 30 caracteres (letras, números, punto, guion o guion bajo).',
        });
      }
      cambios.username = username;
    }

    if (nombre !== undefined) {
      const limpio = typeof nombre === 'string' ? nombre.trim() : '';
      if (limpio.length < LONGITUD_NOMBRE.min || limpio.length > LONGITUD_NOMBRE.max) {
        return res.status(400).json({ error: 'El nombre debe tener entre 2 y 60 caracteres.' });
      }
      cambios.nombre = limpio;
    }

    if (rol !== undefined) {
      // Defensa en profundidad: además del control del router, el cambio de
      // rol se verifica explícitamente contra el rol de quien lo pide.
      if (!req.usuario || req.usuario.rol !== 'admin') {
        return res.status(403).json({ error: 'No tenés permisos para cambiar roles.' });
      }
      if (!ROLES_PERMITIDOS.includes(rol)) {
        return res.status(400).json({ error: 'El rol indicado no es válido.' });
      }
      if (req.usuario.id === id && rol !== req.usuario.rol) {
        return res.status(403).json({ error: 'No podés cambiar tu propio rol.' });
      }
      cambios.rol = rol;
    }

    if (Object.keys(cambios).length === 0) {
      return res.status(400).json({ error: 'No hay cambios para aplicar.' });
    }

    const usuario = await usuarios.actualizar(id, cambios);
    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    res.json(usuarioPublico(usuario));
  } catch (err) {
    // El nombre de usuario es único en la base.
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese nombre.' });
    }
    next(err);
  }
});

/** POST /api/admin/productos — alta de producto. */
router.post('/productos', async (req, res, next) => {
  try {
    const producto = await catalogo.crear(req.body || {});
    res.status(201).json(producto);
  } catch (err) {
    // El nombre del producto es único en la base.
    if ((err as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Ya existe un producto con ese nombre.' });
    }
    next(err);
  }
});

/** PUT /api/admin/productos/:id */
router.put('/productos/:id', async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'El identificador de producto no es válido.' });
    }
    const producto = await catalogo.actualizar(id, req.body || {});
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json(producto);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/productos/:id
 *
 * FALLA — CSRF: la petición que borra un producto no lleva ningún token y se
 * acepta con un simple GET/POST desde cualquier origen.
 */
router.delete('/productos/:id', async (req, res, next) => {
  try {
    const id = validarId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'El identificador de producto no es válido.' });
    }
    const producto = await catalogo.eliminar(id);
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json(producto);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/cambiar-contrasena
 *
 * FALLAS: sin token anti-CSRF, sin límite de intentos, y la contraseña nueva
 * se guarda en texto plano.
 */
router.post('/cambiar-contrasena', async (req, res, next) => {
  try {
    const { nueva } = req.body || {};
    if (!nueva || typeof nueva !== 'string') {
      return res.status(400).json({ error: 'Falta la contraseña nueva.' });
    }
    // FALLA: no se valida la longitud ni la complejidad de la contraseña.
    // (`req.usuario!`: requiereSesion ya garantizó que hay un usuario.)
    await usuarios.cambiarPassword(req.usuario!.id, nueva);
    // No se devuelve el usuario: la respuesta incluía la contraseña.
    res.json({ mensaje: 'Contraseña actualizada.' });
  } catch (err) {
    next(err);
  }
});

/**
 * Servidores que se pueden probar desde el panel (lista blanca).
 * Sólo destinos propios del entorno: nunca se hace ping a sistemas ajenos.
 * Para agregar un proveedor real, sumarlo acá (y al <select> de admin.html).
 */
const HOSTS_PERMITIDOS: readonly string[] = ['db', 'localhost', '127.0.0.1'];

/** Límites del proceso de ping. */
const PING_PAQUETES = '3';
const PING_ESPERA_SEGUNDOS = '2';
const PING_TIMEOUT_MS = 10_000;
const PING_SALIDA_MAX = 64 * 1024;

/**
 * POST /api/admin/probar-conexion
 *
 * Inyección de comandos (OWASP A03:2021). Defensas:
 *  1. El host se valida contra una LISTA BLANCA: cualquier otro valor
 *     (incluidos `;`, `&&`, `|`, `$()`) se rechaza antes de ejecutar nada.
 *  2. `ping` se ejecuta con execFile, con los argumentos en un array y
 *     `shell: false`: no hay /bin/sh que interprete operadores, así que el
 *     host es siempre UN argumento de ping y nunca un comando nuevo.
 *  3. El proceso tiene tiempo y salida acotados.
 */
router.post('/probar-conexion', (req, res) => {
  const { host } = req.body || {};
  const destino = typeof host === 'string' ? host.trim().toLowerCase() : '';

  if (!HOSTS_PERMITIDOS.includes(destino)) {
    return res.status(400).json({
      error: 'Servidor no permitido. Elegí uno de la lista de servidores habilitados.',
    });
  }

  const argumentos = ['-c', PING_PAQUETES, '-W', PING_ESPERA_SEGUNDOS, destino];

  execFile(
    'ping',
    argumentos,
    { shell: false, timeout: PING_TIMEOUT_MS, maxBuffer: PING_SALIDA_MAX },
    (error, stdout, stderr) => {
      res.json({
        // Sólo para mostrar en el panel: NO se ejecuta como texto de shell.
        comando: ['ping', ...argumentos].join(' '),
        salida: stdout,
        error: stderr || (error ? 'El servidor no respondió al ping.' : null),
      });
    }
  );
});

/**
 * POST /api/admin/subir-archivo
 *
 * -----------------------------------------------------------------------------
 * FALLA — Carga de archivos sin restricciones (OWASP A04:2021)
 * -----------------------------------------------------------------------------
 * No se valida la extensión, el tipo MIME ni el tamaño del archivo, y se
 * guarda con el nombre que manda el cliente (además sin sanitizar "../", lo
 * que permite escribir fuera de la carpeta de subidas). Los archivos subidos
 * se sirven con express.static desde el mismo origen.
 *
 * Corrección: validar extensión contra lista blanca (.png/.jpg/.svg saneado),
 * verificar el tipo MIME real, limitar el tamaño, generar un nombre aleatorio
 * y guardar fuera del árbol web.
 * -----------------------------------------------------------------------------
 */
router.post('/subir-archivo', express.json({ limit: '8mb' }), (req, res, next) => {
  try {
    const { nombre, contenidoBase64 } = req.body || {};

    if (!nombre || !contenidoBase64) {
      return res.status(400).json({ error: 'Falta el archivo.' });
    }

    // FALLA: sin validación de extensión, MIME ni tamaño.
    const buffer = Buffer.from(contenidoBase64, 'base64');
    fs.mkdirSync(config.uploadsDir, { recursive: true });

    // FALLA: nombre tomado del cliente sin sanear (path traversal).
    const destino = path.join(config.uploadsDir, nombre);
    fs.writeFileSync(destino, buffer);

    res.json({
      mensaje: 'Archivo subido.',
      url: `/uploads/${nombre}`,
      bytes: buffer.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
