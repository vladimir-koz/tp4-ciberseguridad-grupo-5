import * as db from '../db';
import { calcularPrecio } from '../catalogo';
import type { DatosProducto, Producto, ProductoConPrecio } from '../tipos';

/** Filtros del menú, tal como llegan en la query string. */
export interface FiltrosCatalogo {
  tipo?: string;
  variedad?: string;
  q?: string;
}

/** Datos que manda el panel de administración al crear o editar. */
export type DatosProductoEntrada = Partial<DatosProducto> & { activo?: boolean };

/** Id tal como llega en la URL (texto) o ya convertido. */
type Id = number | string;

/**
 * Servicio de catálogo.
 *
 * -----------------------------------------------------------------------------
 * FALLA — Inyección SQL (OWASP A03:2021)
 * -----------------------------------------------------------------------------
 * Los filtros del catálogo (tipo, variedad, búsqueda) se concatenan en el
 * texto SQL. Un valor con comillas rompe la consulta y permite modificar su
 * lógica: ampliar el conjunto de resultados, leer otras tablas mediante UNION
 * o incluso borrar datos.
 *
 * Corrección: consultas parametrizadas con $1, $2, ... y listas blancas
 * (validar que `tipo` sea uno de los valores conocidos antes de usarlo).
 * -----------------------------------------------------------------------------
 */

/** Lista productos aplicando los filtros del menú. */
export async function listar(filtros: FiltrosCatalogo = {}): Promise<ProductoConPrecio[]> {
  const { tipo, variedad, q } = filtros;

  const condiciones = ['activo = true'];
  const valores: unknown[] = [];

  if (tipo) {
    valores.push(tipo);
    condiciones.push(`tipo = $${valores.length}`);
  }

  if (variedad) {
    valores.push(variedad);
    condiciones.push(`variedad = $${valores.length}`);
  }

  if (q) {
    // El texto buscado viaja como valor; en el SQL sólo va el marcador
    // posicional, que se reutiliza para las dos columnas.
    valores.push(`%${q}%`);
    condiciones.push(`(nombre ILIKE $${valores.length} OR descripcion ILIKE $${valores.length})`);
  }

  const sql = `SELECT * FROM productos WHERE ${condiciones.join(' AND ')} ORDER BY tipo, variedad NULLS FIRST, id`;

  const { rows } = await db.query<Producto>(sql, valores);

  return rows.map((p) => ({ ...p, precio: calcularPrecio(p) }));
}

/** Obtiene un producto por id. */
export async function obtener(id: Id): Promise<ProductoConPrecio | null> {
  const { rows } = await db.query<Producto>('SELECT * FROM productos WHERE id = $1', [id]);
  if (!rows[0]) return null;
  return { ...rows[0], precio: calcularPrecio(rows[0]) };
}

/** Crea un producto nuevo. */
export async function crear(datos: DatosProductoEntrada): Promise<Producto> {
  const { rows } = await db.query<Producto>(
    `INSERT INTO productos (nombre, tipo, variedad, tamano, gramos, precio_base, precio_por_gramo, descripcion)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      datos.nombre,
      datos.tipo,
      datos.variedad || null,
      datos.tamano || null,
      datos.gramos ?? null,
      datos.precio_base ?? 0,
      datos.precio_por_gramo ?? 0,
      datos.descripcion || '',
    ]
  );
  return rows[0];
}

/** Actualiza un producto. */
export async function actualizar(id: Id, datos: DatosProductoEntrada): Promise<Producto | null> {
  const { rows } = await db.query<Producto>(
    `UPDATE productos
        SET nombre = $1, tipo = $2, variedad = $3, tamano = $4, gramos = $5,
            precio_base = $6, precio_por_gramo = $7, descripcion = $8, activo = $9
      WHERE id = $10
      RETURNING *`,
    [
      datos.nombre,
      datos.tipo,
      datos.variedad || null,
      datos.tamano || null,
      datos.gramos ?? null,
      datos.precio_base ?? 0,
      datos.precio_por_gramo ?? 0,
      datos.descripcion || '',
      datos.activo !== false,
      id,
    ]
  );
  return rows[0] || null;
}

/** Elimina (desactiva) un producto. */
export async function eliminar(id: Id): Promise<Producto | null> {
  const { rows } = await db.query<Producto>(
    'UPDATE productos SET activo = false WHERE id = $1 RETURNING *',
    [id]
  );
  return rows[0] || null;
}

/** Lista las variedades disponibles en el catálogo. */
export async function variedades(): Promise<string[]> {
  const { rows } = await db.query<{ variedad: string }>(
    "SELECT DISTINCT variedad FROM productos WHERE variedad IS NOT NULL ORDER BY variedad"
  );
  return rows.map((r) => r.variedad);
}
