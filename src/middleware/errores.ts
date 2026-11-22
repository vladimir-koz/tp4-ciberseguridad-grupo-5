/** Manejo de errores: detalles en el servidor y respuestas genéricas al cliente. */

import type { NextFunction, Request, Response } from 'express';

import type { ErrorHttp } from '../tipos';

export function rutaNoEncontrada(req: Request, res: Response): void {
  res.status(404).json({ error: `Ruta no encontrada: ${req.originalUrl}` });
}

// Express reconoce al manejador de errores por sus CUATRO parámetros: `next`
// tiene que estar aunque no se use.
export function manejadorErrores(
  err: ErrorHttp & { statusCode?: number }, req: Request, res: Response, next: NextFunction
): void {
  console.error('[error]', err.stack || err.message);

  if (res.headersSent) {
    next(err);
    return;
  }

  const codigo = err.status ?? err.statusCode;
  const status = typeof codigo === 'number' && Number.isInteger(codigo) && codigo >= 400 && codigo <= 599
    ? codigo
    : 500;

  res.status(status).json({
    error: status >= 500 ? 'Error interno del servidor.' : 'No se pudo procesar la solicitud.',
  });
}
