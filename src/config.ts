import crypto from 'crypto';
import path from 'path';

/**
 * Configuración de la aplicación.
 *
 * Gestión de secretos (Ajustes de configuración): los secretos se leen de
 * variables de entorno (ver .env.example) y no se versiona ninguno. Antes el
 * secreto de sesión estaba escrito a mano en este archivo y cualquiera que
 * clonara el repositorio lo conocía.
 */
const dbPassword = process.env.DB_PASSWORD;
if (!dbPassword) {
  throw new Error('Falta configurar DB_PASSWORD.');
}

/**
 * Secreto con el que se firman los tokens anti-CSRF.
 *
 * Se lee de SESSION_SECRET (nunca está escrito en el código). Si no se
 * configura, se genera uno aleatorio en cada arranque: alcanza para esta app,
 * porque las sesiones viven en memoria y también se pierden al reiniciar.
 * Con varias instancias detrás de un balanceador hay que definirlo en el
 * entorno, igual en todas.
 */
const SECRETO_LONGITUD_MINIMA = 32;
const secretoSesion = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (secretoSesion.length < SECRETO_LONGITUD_MINIMA) {
  throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
}

export default {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'origen',
    user: process.env.DB_USER || 'origen_app',
    password: dbPassword,
  },

  // Firma del token anti-CSRF: viene del entorno o es aleatorio por arranque.
  sessionSecret: secretoSesion,

  // FALLA: credenciales por defecto que nunca se cambian.
  credencialesPorDefecto: {
    username: 'admin',
    password: 'admin',
  },

  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
};
