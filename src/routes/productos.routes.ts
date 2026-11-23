import express from 'express';
import * as catalogo from '../services/catalogo.service';
import type { FiltrosCatalogo } from '../services/catalogo.service';

const router = express.Router();

/**
 * GET /api/productos?tipo=&variedad=&q=
 * Lista el catálogo con filtros opcionales.
 *
 * La respuesta incluye el eco de los filtros (`filtros.q`). Es dato no
 * confiable: el sitio web lo muestra como texto (textContent), nunca como
 * HTML, así que un `<script>` en la búsqueda no se ejecuta.
 */
router.get('/', async (req, res, next) => {
  try {
    const productos = await catalogo.listar(req.query as FiltrosCatalogo);
    res.json({
      productos,
      // Eco de los filtros: el cliente lo pinta como texto.
      filtros: {
        tipo: req.query.tipo || '',
        variedad: req.query.variedad || '',
        q: req.query.q || '',
      },
      total: productos.length,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/productos/variedades */
router.get('/variedades', async (req, res, next) => {
  try {
    res.json({ variedades: await catalogo.variedades() });
  } catch (err) {
    next(err);
  }
});

/** Máximo valor de una columna INTEGER / SERIAL de PostgreSQL. */
const ID_MAXIMO = 2147483647;

/**
 * GET /api/productos/:id
 * Devuelve un producto.
 *
 * El id se valida como entero positivo antes de consultar la base, y los
 * mensajes de error son genéricos: nunca reflejan lo que mandó el cliente
 * (evita el XSS reflejado a través de la respuesta).
 */
router.get('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!/^\d+$/.test(req.params.id) || !Number.isInteger(id) || id <= 0 || id > ID_MAXIMO) {
      return res.status(400).json({ error: 'El identificador de producto no es válido.' });
    }

    const producto = await catalogo.obtener(id);
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado.' });
    }
    res.json(producto);
  } catch (err) {
    next(err);
  }
});

export default router;
