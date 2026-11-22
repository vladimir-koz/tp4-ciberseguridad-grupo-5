import * as db from '../db';
import { calcularPrecio } from '../catalogo';
import type { Pedido, PedidoConItems, PedidoItem, Producto } from '../tipos';

/** Un renglón del pedido, tal como llega en el cuerpo de la petición. */
export interface ItemPedido {
  productoId: number;
  cantidad: number;
}

/** Pedido nuevo, tal como llega en el cuerpo de la petición. */
export interface NuevoPedido {
  mesa: string;
  cliente: string;
  items: ItemPedido[];
}

/** Id tal como llega en la URL (texto) o ya convertido. */
type Id = number | string;

const MAX_ITEMS = 50;
const MAX_CANTIDAD = 100;
const MAX_ID = 2147483647;

export class ErrorValidacionPedido extends Error {}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function validarPedido(datos: unknown): asserts datos is NuevoPedido {
  if (!esObjeto(datos)) {
    throw new ErrorValidacionPedido('El pedido debe ser un objeto.');
  }
  if (typeof datos.mesa !== 'string' || datos.mesa.trim().length < 1 || datos.mesa.length > 10) {
    throw new ErrorValidacionPedido('La mesa debe ser un texto de 1 a 10 caracteres.');
  }
  if (typeof datos.cliente !== 'string' || datos.cliente.trim().length < 2 || datos.cliente.length > 40) {
    throw new ErrorValidacionPedido('El cliente debe ser un texto de 2 a 40 caracteres.');
  }
  if (!Array.isArray(datos.items) || datos.items.length < 1 || datos.items.length > MAX_ITEMS) {
    throw new ErrorValidacionPedido(`El pedido debe contener entre 1 y ${MAX_ITEMS} items.`);
  }
  for (const item of datos.items) {
    if (!esObjeto(item) || typeof item.productoId !== 'number' ||
        !Number.isInteger(item.productoId) || item.productoId < 1 || item.productoId > MAX_ID) {
      throw new ErrorValidacionPedido('Cada productoId debe ser un entero positivo válido.');
    }
    if (typeof item.cantidad !== 'number' || !Number.isInteger(item.cantidad) ||
        item.cantidad < 1 || item.cantidad > MAX_CANTIDAD) {
      throw new ErrorValidacionPedido(`La cantidad debe ser un entero entre 1 y ${MAX_CANTIDAD}.`);
    }
  }
}

/**
 * Crea un pedido a partir de una lista de items { productoId, cantidad }.
 * Total = suma de calcularPrecio(producto) x cantidad
 */
export async function crear(datos: unknown): Promise<PedidoConItems | null> {
  validarPedido(datos);
  const { mesa, cliente, items } = datos;
  const filas: { productoId: number; cantidad: number; precioUnitario: number }[] = [];

  for (const item of items) {
    const producto = await buscarProducto(item.productoId);
    if (!producto) {
      throw new ErrorValidacionPedido('Uno de los productos del pedido no existe.');
    }
    const precioUnitario = calcularPrecio(producto);
    if (!Number.isFinite(precioUnitario) || precioUnitario < 0 || precioUnitario > 99999999.99) {
      throw new ErrorValidacionPedido('Uno de los productos tiene un precio no válido para el pedido.');
    }
    filas.push({
      productoId: producto.id,
      cantidad: item.cantidad,
      precioUnitario,
    });
  }

  const total = filas.reduce(
    (acc, f) => acc + f.precioUnitario * f.cantidad,
    0
  );
  if (!Number.isFinite(total) || total > 9999999999.99) {
    throw new ErrorValidacionPedido('El total del pedido supera el importe admitido.');
  }

  const { rows } = await db.query<Pedido>(
    `INSERT INTO pedidos (mesa, cliente, estado, total)
     VALUES ($1, $2, 'abierto', $3)
     RETURNING *`,
    [mesa, cliente, total]
  );
  const pedido = rows[0];

  for (const fila of filas) {
    await db.query(
      `INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio_unitario)
       VALUES ($1, $2, $3, $4)`,
      [pedido.id, fila.productoId, fila.cantidad, fila.precioUnitario]
    );
  }

  return obtenerConItems(pedido.id);
}

/** Busca un producto por id (helper interno). */
async function buscarProducto(productoId: number): Promise<Producto | null> {
  const { rows } = await db.query<Producto>('SELECT * FROM productos WHERE id = $1', [productoId]);
  return rows[0] || null;
}

/** Lista pedidos (con filtro opcional por mesa). */
export async function listar(mesa?: unknown): Promise<Pedido[]> {
  if (mesa !== undefined && (typeof mesa !== 'string' || mesa.length > 10)) {
    throw new ErrorValidacionPedido('El filtro de mesa debe ser un texto de hasta 10 caracteres.');
  }
  let sql = 'SELECT * FROM pedidos';
  const valores: unknown[] = [];
  if (mesa) {
    sql += ' WHERE mesa = $1';
    valores.push(mesa);
  }
  sql += ' ORDER BY id DESC';

  const { rows } = await db.query<Pedido>(sql, valores);
  return rows;
}

/** Devuelve un pedido con sus items. */
export async function obtenerConItems(id: Id): Promise<PedidoConItems | null> {
  const { rows: pedidos } = await db.query<Pedido>(
    'SELECT * FROM pedidos WHERE id = $1',
    [id]
  );
  const pedido = pedidos[0];
  if (!pedido) return null;

  const { rows: items } = await db.query<PedidoItem>(
    `SELECT pi.*, pr.nombre AS producto_nombre
       FROM pedido_items pi
       JOIN productos pr ON pr.id = pi.producto_id
      WHERE pi.pedido_id = $1`,
    [id]
  );

  return { ...pedido, items };
}

/** Cambia el estado de un pedido. */
export async function cambiarEstado(id: Id, estado: string): Promise<Pedido | null> {
  const { rows } = await db.query<Pedido>(
    'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
    [estado, id]
  );
  return rows[0] || null;
}
