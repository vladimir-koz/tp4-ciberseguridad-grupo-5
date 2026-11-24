import bcrypt from 'bcryptjs';
import * as db from '../db';
import type { Usuario } from '../tipos';

/**
 * Servicio de usuarios.
 *
 * Pendiente de otras correcciones del TP:
 *  - El mensaje de error del login distingue "usuario inexistente" de
 *    "contraseña incorrecta" (enumeración de usuarios).
 *  - No hay límite de intentos (fuerza bruta).
 *  - actualizar(): asignación masiva / escalada de privilegios.
 */

/** Busca un usuario por nombre de usuario exacto (query parametrizada). */
export async function buscarPorUsername(username: string): Promise<Usuario | null> {
  const { rows } = await db.query<Usuario>(
    'SELECT * FROM usuarios WHERE username = $1',
    [username]
  );
  return rows[0] || null;
}

/**
 * Autentica a un usuario comparando usuario y contraseña.
 * Devuelve el usuario o null.
 *
 * Consulta parametrizada: la entrada viaja como dato, nunca como SQL.
 * La contraseña se compara contra el hash bcrypt guardado.
 */
export async function autenticar(username: string, password: string): Promise<Usuario | null> {
  const usuario = await buscarPorUsername(username);
  if (!usuario) return null;

  const coincide = await bcrypt.compare(password, usuario.password);
  return coincide ? usuario : null;
}

/** Lista todos los usuarios (para el panel de administración). */
export async function listar(): Promise<Usuario[]> {
  const { rows } = await db.query<Usuario>('SELECT * FROM usuarios ORDER BY id');
  return rows;
}

/**
 * Actualiza un usuario.
 * FALLA — Asignación masiva / escalada de privilegios: se actualiza el rol
 * sin verificar que quien llama tenga permiso para hacerlo.
 */
export async function actualizar(id: number | string, cambios: Partial<Usuario>): Promise<Usuario | null> {
  const campos: string[] = [];
  const valores: unknown[] = [];
  let i = 1;
  for (const [campo, valor] of Object.entries(cambios)) {
    campos.push(`${campo} = $${i}`);
    valores.push(valor);
    i += 1;
  }
  if (campos.length === 0) return null;
  valores.push(id);
  const { rows } = await db.query<Usuario>(
    `UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${i} RETURNING *`,
    valores
  );
  return rows[0] || null;
}

/** Cambia la contraseña de un usuario (se guarda hasheada con bcrypt). */
export async function cambiarPassword(id: number, nuevaPassword: string): Promise<Usuario | null> {
  const hash = await bcrypt.hash(nuevaPassword, 10);
  const { rows } = await db.query<Usuario>(
    'UPDATE usuarios SET password = $1 WHERE id = $2 RETURNING *',
    [hash, id]
  );
  return rows[0] || null;
}