import path from 'path';
import express from 'express';
import helmet from 'helmet';

import config from './config';
import { rutaNoEncontrada, manejadorErrores } from './middleware/errores';
import authRoutes from './routes/auth.routes';
import productosRoutes from './routes/productos.routes';
import pedidosRoutes from './routes/pedidos.routes';
import reportesRoutes from './routes/reportes.routes';
import comentariosRoutes from './routes/comentarios.routes';
import adminRoutes from './routes/admin.routes';
import debugRoutes from './routes/debug.routes';

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'"],
      styleSrcAttr: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null,
    },
  },
  hsts: config.nodeEnv === 'production' ? { maxAge: 31536000, includeSubDomains: false } : false,
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
}));

/**
 * FALLA — Ajustes de configuración (OWASP A05:2021)
 *
 * Faltan:
 *  - límite de tamaño del cuerpo más estricto por ruta
 *  - rate limiting global
 *  - política de CORS restringida al propio origen
 */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Archivos subidos por el panel de administración.
app.use('/uploads', express.static(config.uploadsDir));

// Sitio web estático
app.use(express.static(path.join(__dirname, 'public')));

// --- API --------------------------------------------------------------------
app.get('/api/salud', (req, res) => {
  res.json({ ok: true, servicio: 'cafeteria-origen', hora: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/comentarios', comentariosRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/_diagnostico', debugRoutes);

app.use('/api', rutaNoEncontrada);

app.use(manejadorErrores);

export default app;
