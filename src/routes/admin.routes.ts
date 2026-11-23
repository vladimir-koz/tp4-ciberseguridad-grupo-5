import express from 'express';
import crypto from 'crypto';
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

/** Tipos de imagen admitidos. */
type TipoImagen = 'png' | 'jpeg' | 'webp';

/**
 * Lista blanca de extensiones → tipo de imagen esperado.
 * No se admite SVG (es XML y puede llevar <script>) ni HTML.
 */
const EXTENSIONES_PERMITIDAS: Readonly<Record<string, TipoImagen>> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
};

/** Extensión con la que se guarda cada tipo (la decide el servidor). */
const EXTENSION_DE_TIPO: Readonly<Record<TipoImagen, string>> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
};

/** MIME real de cada tipo (para informar en la respuesta). */
const MIME_DE_TIPO: Readonly<Record<TipoImagen, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * Tamaño máximo del archivo YA decodificado. El cuerpo JSON global de la app
 * está limitado a 1 MB y el base64 agrega ~33 %, así que 512 KB entra holgado.
 */
const TAMANO_MAX = 512 * 1024;
const TAMANO_MAX_BASE64 = Math.ceil(TAMANO_MAX / 3) * 4;
const LONGITUD_MAX_NOMBRE = 255;
const FORMATO_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Detecta el tipo REAL del archivo por su firma (magic number), sin confiar
 * en la extensión ni en el MIME que declara el cliente.
 */
function detectarTipoImagen(buffer: Buffer): TipoImagen | null {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= 8 && PNG.every((byte, i) => buffer[i] === byte)) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/**
 * POST /api/admin/subir-archivo
 *
 * Carga de archivos (OWASP A04:2021). Defensas:
 *  1. Extensión validada contra una lista blanca (sólo imágenes, sin SVG).
 *  2. Contenido validado por su firma (magic number): un .html renombrado a
 *     .png se rechaza, y la firma tiene que coincidir con la extensión.
 *  3. Tamaño máximo (TAMANO_MAX) controlado antes de escribir en disco.
 *  4. El nombre lo genera el servidor (UUID + extensión del tipo detectado):
 *     el nombre del cliente nunca llega al sistema de archivos, así que no
 *     hay path traversal ni sobrescritura de archivos existentes.
 *  5. Al servir /uploads (app.ts) sólo se entregan imágenes, con una CSP
 *     "sandbox" que impide ejecutar contenido activo.
 */
router.post('/subir-archivo', (req, res, next) => {
  try {
    const { nombre, contenidoBase64 } = req.body || {};

    if (typeof nombre !== 'string' || typeof contenidoBase64 !== 'string' || !nombre || !contenidoBase64) {
      return res.status(400).json({ error: 'Falta el archivo.' });
    }
    if (nombre.length > LONGITUD_MAX_NOMBRE) {
      return res.status(400).json({ error: 'El nombre del archivo es demasiado largo.' });
    }

    const tipoPorExtension = EXTENSIONES_PERMITIDAS[path.extname(nombre).toLowerCase()];
    if (!tipoPorExtension) {
      return res.status(400).json({ error: 'Tipo de archivo no permitido. Sólo se aceptan imágenes PNG, JPG o WEBP.' });
    }

    if (contenidoBase64.length > TAMANO_MAX_BASE64) {
      return res.status(413).json({ error: 'El archivo supera el tamaño máximo de 512 KB.' });
    }
    if (contenidoBase64.length % 4 !== 0 || !FORMATO_BASE64.test(contenidoBase64)) {
      return res.status(400).json({ error: 'El contenido del archivo no es válido.' });
    }

    const buffer = Buffer.from(contenidoBase64, 'base64');
    if (buffer.length === 0 || buffer.length > TAMANO_MAX) {
      return res.status(413).json({ error: 'El archivo supera el tamaño máximo de 512 KB.' });
    }

    const tipoReal = detectarTipoImagen(buffer);
    if (!tipoReal || tipoReal !== tipoPorExtension) {
      return res.status(400).json({ error: 'El contenido del archivo no corresponde a una imagen permitida.' });
    }

    // Nombre generado por el servidor; se comprueba igual que quede dentro
    // de la carpeta de subidas (defensa en profundidad).
    const carpeta = path.resolve(config.uploadsDir);
    const nombreSeguro = `${crypto.randomUUID()}${EXTENSION_DE_TIPO[tipoReal]}`;
    const destino = path.resolve(carpeta, nombreSeguro);
    if (path.dirname(destino) !== carpeta) {
      return res.status(400).json({ error: 'Destino de archivo no válido.' });
    }

    fs.mkdirSync(carpeta, { recursive: true });
    fs.writeFileSync(destino, buffer, { flag: 'wx', mode: 0o644 });

    res.status(201).json({
      mensaje: 'Archivo subido.',
      url: `/uploads/${nombreSeguro}`,
      tipo: MIME_DE_TIPO[tipoReal],
      bytes: buffer.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
