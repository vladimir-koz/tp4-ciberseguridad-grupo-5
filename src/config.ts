import path from 'path';

/**
 * Configuración de la aplicación.
 *
 * -----------------------------------------------------------------------------
 * FALLA 1 — Cifrado de datos y gestión de secretos (Ajustes de configuración)
 * -----------------------------------------------------------------------------
 * El secreto de sesión está escrito a mano en el código fuente.
 * Cualquiera que clone el repositorio lo conoce.
 *
 * Corrección: leer todo desde variables de entorno (ver .env.example) o desde
 * un gestor de secretos, y no versionar ningún secreto.
 * -----------------------------------------------------------------------------
 */
const dbPassword = process.env.DB_PASSWORD;
if (!dbPassword) {
  throw new Error('Falta configurar DB_PASSWORD.');
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

  // FALLA: secreto fijo y predecible, escrito en el código.
  // Se necesita para firmar el token anti-CSRF (corrección del CSRF).
  sessionSecret: 'origen-cafe-2024',

  // FALLA: credenciales por defecto que nunca se cambian.
  credencialesPorDefecto: {
    username: 'admin',
    password: 'admin',
  },

  uploadsDir: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
};
