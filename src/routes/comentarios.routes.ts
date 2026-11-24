import express from 'express';
import * as comentarios from '../services/comentarios.service';

const router = express.Router();

/** Límites de las reseñas (coinciden con los del formulario de index.html). */
const LONGITUD_AUTOR = { min: 2, max: 40 };
const LONGITUD_TEXTO = { min: 3, max: 280 };
const CALIFICACION = { min: 1, max: 5 };

/**
 * Valida un texto: tiene que ser string y, sin espacios en los extremos,
 * medir entre `min` y `max` caracteres. Devuelve el texto recortado o null.
 */
function validarTexto(valor: unknown, { min, max }: { min: number; max: number }): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  if (limpio.length < min || limpio.length > max) return null;
  return limpio;
}

/** Valida la calificación: entero entre 1 y 5 (acepta "4" o 4). */
function validarCalificacion(valor: unknown): number | null {
  if (typeof valor !== 'number' && typeof valor !== 'string') return null;
  if (typeof valor === 'string' && !/^\s*\d+\s*$/.test(valor)) return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < CALIFICACION.min || numero > CALIFICACION.max) return null;
  return numero;
}

/**
 * GET /api/comentarios — reseñas públicas de la cafetería.
 * El texto lo escribe cualquier visitante: el sitio lo muestra como texto
 * (textContent), nunca como HTML, para evitar el XSS almacenado.
 */
router.get('/', async (req, res, next) => {
  try {
    res.json({ comentarios: await comentarios.listar() });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/comentarios
 *
 * Validación en el servidor (la del HTML se saltea con el devtools): tipo,
 * longitud del autor y del texto, y rango de la calificación. Los mensajes
 * de error son fijos y no reflejan la entrada.
 *
 * CSRF: exige token anti-CSRF (middleware/csrf.ts, aplicado en app.ts).
 */
router.post('/', async (req, res, next) => {
  try {
    const cuerpo = req.body || {};

    const autor = validarTexto(cuerpo.autor, LONGITUD_AUTOR);
    if (autor === null) {
      return res.status(400).json({ error: 'El nombre debe tener entre 2 y 40 caracteres.' });
    }

    const texto = validarTexto(cuerpo.texto, LONGITUD_TEXTO);
    if (texto === null) {
      return res.status(400).json({ error: 'La reseña debe tener entre 3 y 280 caracteres.' });
    }

    const calificacion = validarCalificacion(cuerpo.calificacion);
    if (calificacion === null) {
      return res.status(400).json({ error: 'La calificación debe ser un número entero entre 1 y 5.' });
    }

    const comentario = await comentarios.crear({
      autor,
      texto,
      calificacion,
    });
    res.status(201).json(comentario);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/comentarios/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    // FALLA: sin verificación de rol — cualquiera puede borrar reseñas.
    const comentario = await comentarios.eliminar(req.params.id);
    if (!comentario) {
      return res.status(404).json({ error: 'Comentario no encontrado.' });
    }
    res.json(comentario);
  } catch (err) {
    next(err);
  }
});

export default router;
