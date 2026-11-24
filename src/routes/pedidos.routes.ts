import express from 'express';
import * as pedidos from '../services/pedidos.service';

const router = express.Router();

/**
 * POST /api/pedidos
 * Crea un pedido y devuelve su total calculado.
 *
 * CSRF: exige token anti-CSRF y Origin propio (middleware/csrf.ts, aplicado
 * a toda la API en app.ts).
 *
 * FALLA: no requiere autenticación ni rol.
 */
router.post('/', async (req, res, next) => {
  try {
    const pedido = await pedidos.crear(req.body);
    res.status(201).json(pedido);
  } catch (err) {
    if (err instanceof pedidos.ErrorValidacionPedido) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/pedidos?mesa=
 * Lista los pedidos de todas las mesas.
 *
 * FALLA — Autorización: cualquier visitante puede ver los pedidos de TODAS
 * las mesas (los datos de los clientes de los demás).
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({ pedidos: await pedidos.listar(req.query.mesa) });
  } catch (err) {
    if (err instanceof pedidos.ErrorValidacionPedido) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

/**
 * GET /api/pedidos/:id
 * FALLA — IDOR: no se verifica que el pedido pertenezca al usuario que pregunta.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const pedido = await pedidos.obtenerConItems(req.params.id);
    if (!pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }
    res.json(pedido);
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/pedidos/:id/estado */
router.patch('/:id/estado', async (req, res, next) => {
  try {
    const { estado } = req.body || {};
    // FALLA: no se valida el valor de `estado` (cualquier texto se acepta)
    // ni se comprueba el rol del que modifica el pedido.
    const pedido = await pedidos.cambiarEstado(req.params.id, estado);
    if (!pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }
    res.json(pedido);
  } catch (err) {
    next(err);
  }
});

export default router;
