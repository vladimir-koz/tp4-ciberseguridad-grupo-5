import express from 'express';
import { requiereSesion, requiereRol } from '../middleware/auth';

const router = express.Router();

/** Diagnóstico mínimo, disponible únicamente para administradores autenticados. */
router.get('/', requiereSesion, requiereRol('admin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    mensaje: 'Diagnóstico del servidor',
    ok: true,
  });
});

export default router;
