# Informe TP4 — Cafetería Origen

**Programación IV · Redes y Seguridad — Grupo 5**
**Integrantes:** 
1. Vladimir Kozik
2. Luca Aversano
3. Jano Rodriguez
4. Conrado Lanusse

**Repositorio:** https://github.com/vladimir-koz/tp4-ciberseguridad-grupo-5

Trabajo práctico: encontrar, explicar y corregir las fallas de seguridad de la web de la Cafetería Origen sin romper su funcionamiento.

## Índice

1. [Resumen](#1-resumen)
2. [Metodología](#2-metodología)
3. [Las 24 fallas de un vistazo](#3-las-24-fallas-de-un-vistazo)
4. [Práctica 1 — Inyección SQL](#4-práctica-1--inyección-sql) (#1 a #4)
5. [Práctica 2 — Cross-Site Scripting](#5-práctica-2--cross-site-scripting) (#5 a #7)
6. [Práctica 3 — CSRF](#6-práctica-3--csrf) (#8)
7. [Práctica 4 — Validación de entrada](#7-práctica-4--validación-de-entrada) (#9 y #10)
8. [Práctica 5 — Autenticación y sesiones](#8-práctica-5--autenticación-y-sesiones) (#11 a #19)
9. [Práctica 6 — Comandos, configuración y exposición](#9-práctica-6--comandos-configuración-y-exposición) (#20 a #24)
10. [Correcciones adicionales](#10-correcciones-adicionales)
11. [Decisiones de diseño y límites conocidos](#11-decisiones-de-diseño-y-límites-conocidos)
12. [Verificación final](#12-verificación-final)
13. [Reflexión final](#13-reflexión-final)

---

## 1. Resumen

La aplicación tenía **24 fallas de seguridad** (OWASP Top 10) en el backend (Node.js + TypeScript + Express), en el frontend (JavaScript del navegador) y en la infraestructura (PostgreSQL en Docker). Se corrigieron todas, más algunas fallas relacionadas que encontramos en el camino, en **16 pull requests** revisados e integrados en la rama `dev` (#1 a #17).

El trabajo se considera terminado cuando los tres comandos de la consigna quedan en verde a la vez:

| Comando | Qué mide | Al empezar | Al terminar |
|---|---|---|---|
| `npm test` | Funcional: el negocio (catálogo, pedidos, login, reportes) | 28/28 ✔ | **28/28 ✔** |
| `npm run test:seguridad` | Que las fallas estén corregidas (comportamiento) | 1/29 ✘ | **29/29 ✔** |
| `npm run check:security` | Checklist estático del código | 3/37 críticos ✘ | **37/37 ✔** |

Los tests funcionales quedaron en verde en todo momento: ninguna corrección se hizo quitando funcionalidad, y ningún test de la cátedra se modificó.

**Distribución del trabajo**

| Integrante | Fallas | Área |
|---|---|---|
| Vladimir | #2, #3, #4, #9, #21, #22, #23, #24 | Inyección SQL, validación de pedidos, errores, cabeceras y base de datos |
| Luca | #1, #11, #12, #17 | Login y almacenamiento de contraseñas |
| Jano | #13, #14, #15, #16 | Cookies y ciclo de vida de las sesiones |
| Conrado | #5, #6, #7, #8, #10, #18, #19, #20 | XSS, CSRF y seguridad del panel de administración |

---

## 2. Metodología

- **Una rama por bloque, desde `dev` actualizado**, y un pull request revisado por cada una. Nadie hizo push directo a `dev` ni a `master`. Los bloques que tocaban el mismo archivo se integraron en orden, para evitar conflictos (por ejemplo, login → sesiones → logout en `auth.routes.ts`).
- **Reproducción contra `localhost`**, sin scripts que automaticen ataques. Cada falla incluye los pasos para observarla a mano en una **copia aislada del commit vulnerable** (`195dde3`), sin reintroducirla nunca en la rama de integración:

  ```bash
  docker compose stop                       # frena el stack corregido (conserva datos)
  git worktree add ../tp4-vulnerable 195dde3
  cd ../tp4-vulnerable && docker compose up -d --build   # http://localhost:8080
  # ... observación manual ...
  docker compose down -v                    # borra sólo el volumen de esta copia
  cd ../tp4-ciberseguridad-grupo-5 && git worktree remove ../tp4-vulnerable
  docker compose start
  ```

  El `docker-compose.yml` vulnerable usa nombres de contenedor fijos, así que no puede correr al mismo tiempo que el corregido. Usuarios de prueba: `admin/admin` (admin), `valentina/origen2024` (admin), `barista/cafe123`, `mozo/mozo123` y `cliente/cliente`.

- **Verificación en tres niveles:** la batería de seguridad (comportamiento), el checklist (código) y peticiones a la API (curl) que comprueban que la operación legítima sigue funcionando y que la maliciosa se rechaza. Un test en verde no se tomó como prueba suficiente por sí solo.

---

## 3. Las 24 fallas de un vistazo

La numeración es la del PDF de la consigna. La columna VUL es la de `VULNERABILIDADES.md`, que usa otra numeración.

| # | Falla | VUL | Responsable | PR | Archivo principal | Test(s) de seguridad | Controles |
|---|---|---|---|---|---|---|---|
| 1 | Inyección SQL en el login | 01 | Luca | #13 | `services/usuarios.service.ts` | 2 en `seguridad-login` | SQLI-01/02, AUTH-03 |
| 2 | Inyección SQL en el catálogo | 02 | Vladimir | #1, #17 | `services/catalogo.service.ts` | 2 (búsqueda y origen) | SQLI-01/02 |
| 3 | Inyección SQL en el filtro por mesa | 03 | Vladimir | #3 | `services/pedidos.service.ts` | 1 | SQLI-01/02 |
| 4 | Inyección SQL en el reporte por origen | 04 | Vladimir | #2 | `services/reportes.service.ts` | 1 (UNION) | SQLI-01/02 |
| 5 | XSS reflejado (buscador y mensajes) | 05, 06 | Conrado | #8 | `public/js/app.js`, `routes/` | 2 | XSS-01/02 |
| 6 | XSS almacenado en reseñas | 07 | Conrado | #8 | `public/js/app.js` | 1 | XSS-01 |
| 7 | XSS de DOM en el panel | 08 | Conrado | #8 | `public/js/admin.js` | 1 | XSS-01 |
| 8 | CSRF | 09 | Conrado | #15 | `middleware/csrf.ts` (nuevo) | 1 | CSRF-01/03 |
| 9 | Validación débil en pedidos | 10 | Vladimir | #3 | `services/pedidos.service.ts` | 2 | VAL-02/03 |
| 10 | Subida de archivos sin restricciones | 12 | Conrado | #11 | `routes/admin.routes.ts` | 1 | VAL-04/05 |
| 11 | Contraseñas en texto plano | 13 | Luca | #13 | `services/usuarios.service.ts`, `inicializar.ts` | 1 | AUTH-01/02/03 |
| 12 | Sin protección contra fuerza bruta | 14 | Luca | #13 | `routes/auth.routes.ts` | 2 en `seguridad-fuerza-bruta` | AUTH-04 |
| 13 | Cookie sin HttpOnly/Secure/SameSite | 15 | Jano | #14 | `middleware/sesion.ts` | 1 | AUTH-05/06, CSRF-02 |
| 14 | ID de sesión predecible | 16 | Jano | #14 | `middleware/sesion.ts` | 1 | AUTH-07/08 |
| 15 | Sesiones que nunca expiran | 17 | Jano | #14 | `middleware/sesion.ts` | — (sólo checklist) | AUTH-09/10 |
| 16 | Logout que no invalida la sesión | 18 | Jano | #16 | `routes/auth.routes.ts` | 1 | AUTH-11 |
| 17 | Enumeración de usuarios | 19 | Luca | #13 | `routes/auth.routes.ts` | 1 en `seguridad-login` | AUTH-12 |
| 18 | Autorización ausente en el panel | 20 | Conrado | #9 | `routes/admin.routes.ts` | 1 | AUTH-14 |
| 19 | Escalada de privilegios | 21 | Conrado | #9 | `routes/admin.routes.ts` | 1 | AUTH-15 |
| 20 | Inyección de comandos | 22 | Conrado | #10 | `routes/admin.routes.ts` | 2 | CMD-01/02/03 |
| 21 | Secretos en `/api/_diagnostico` | 23 | Vladimir | #5 | `routes/debug.routes.ts` | 1 | CFG-03/04 |
| 22 | Stack traces al cliente | 24 | Vladimir | #4 | `middleware/errores.ts` | 1 | VAL-06 |
| 23 | Sin cabeceras de seguridad | 25 | Vladimir | #6 | `app.ts` | 1 | XSS-03, CFG-01 |
| 24 | Base sin contraseña y con superusuario | 26 | Vladimir | #7 | `docker-compose.yml` | 1 | SQLI-03/05 |

---

## 4. Práctica 1 — Inyección SQL

> **OWASP A03:2021.** Si la entrada del usuario se concatena al texto de la consulta, PostgreSQL interpreta sus comillas y operadores como parte del SQL. La defensa es separar código y datos: **consultas parametrizadas** (`$1`, `$2`, …), con los valores en un array aparte.

### #1 · Inyección SQL en el login — *Luca*

**Qué es.** Con un usuario como `' OR 1=1 --` se entra como administrador sin conocer ninguna contraseña.

**Dónde estaba.** `src/services/usuarios.service.ts:42`

```ts
const sql = `SELECT * FROM usuarios WHERE username = '${username}' AND password = '${password}'`;
```

**Cómo se observa.** En el login del panel: usuario `' OR 1=1 --` y cualquier contraseña. Se entra como `admin`. La variante `admin'--` entra sin contraseña.

**Por qué ocurre.** La `'` del atacante cierra el string del código, `OR 1=1` vuelve verdadera la condición y `--` comenta el resto, incluido el control de la contraseña.

**Corrección** (PR #13). Se busca al usuario con una consulta parametrizada y la contraseña se compara contra el hash con `bcrypt.compare` (ver #11):

```ts
export async function autenticar(username: string, password: string) {
  const usuario = await buscarPorUsername(username);   // 'SELECT * FROM usuarios WHERE username = $1'
  if (!usuario) return null;
  const coincide = await bcrypt.compare(password, usuario.password);
  return coincide ? usuario : null;
}
```

**Verificación.** Tests "el login NO acepta el bypass con payload SQL" y "el login NO acepta el payload que comenta la contraseña". Controles SQLI-01, SQLI-02 y AUTH-03. El login legítimo sigue funcionando.

### #2 · Inyección SQL en los filtros del catálogo — *Vladimir*

**Dónde estaba.** `src/services/catalogo.service.ts:40-43` (tipo, variedad y búsqueda) y la consulta por id.

```ts
if (tipo) sql += ` AND tipo = '${tipo}'`;
if (variedad) sql += ` AND variedad = '${variedad}'`;
sql += ` AND (nombre ILIKE '%${q}%' OR descripcion ILIKE '%${q}%')`;
```

**Cómo se observa.** En el buscador del menú, `' OR '1'='1` devuelve **los 20 productos** en lugar de los que coinciden.

**Corrección** (PR #1). Las condiciones se arman en una lista y los valores van por separado. El texto de búsqueda (con sus `%`) también viaja como valor:

```ts
const condiciones = ['activo = true'];
const valores: unknown[] = [];
if (tipo) { valores.push(tipo); condiciones.push(`tipo = $${valores.length}`); }
if (variedad) { valores.push(variedad); condiciones.push(`variedad = $${valores.length}`); }
if (q) {
  valores.push(`%${q}%`);
  condiciones.push(`(nombre ILIKE $${valores.length} OR descripcion ILIKE $${valores.length})`);
}
const sql = `SELECT * FROM productos WHERE ${condiciones.join(' AND ')} ORDER BY tipo, variedad NULLS FIRST, id`;
await db.query(sql, valores);
```

> La primera versión guardaba el marcador en una variable (`${parametro}`). Era segura, pero el checklist estático la marcaba como interpolación (falso positivo en SQLI-01). En el PR #17 se escribió el marcador directo, sin cambiar el SQL.

**Verificación.** Tests "la búsqueda del catálogo NO se puede ampliar con SQL" y "el filtro por origen NO se puede ampliar con SQL". Controles SQLI-01 y SQLI-02. La búsqueda legítima (`avellana`) sigue funcionando.

### #3 · Inyección SQL en el filtro por mesa — *Vladimir*

**Dónde estaba.** `src/services/pedidos.service.ts:95`: `` if (mesa) sql += ` WHERE mesa = '${mesa}'`; ``

**Cómo se observa.** `GET /api/pedidos?mesa=' OR '1'='1` devuelve los pedidos de **todas** las mesas.

**Corrección** (PR #3). `WHERE mesa = $1` con el valor en el array, y validación previa del filtro (texto de hasta 10 caracteres):

```ts
if (mesa !== undefined && (typeof mesa !== 'string' || mesa.length > 10)) {
  throw new ErrorValidacionPedido('El filtro de mesa debe ser un texto de hasta 10 caracteres.');
}
if (mesa) { sql += ' WHERE mesa = $1'; valores.push(mesa); }
```

**Verificación.** Test "el filtro por mesa NO se puede ampliar con SQL". Controles SQLI-01 y SQLI-02.

### #4 · Inyección SQL en el reporte por origen — *Vladimir*

**Qué es.** Es la demostración más clara del riesgo: con `UNION` se **leen otras tablas**.

**Dónde estaba.** `src/services/reportes.service.ts:88`: `` HAVING pr.variedad = '${variedad}' ``

**Cómo se observa.** Panel → Reportes → "Ventas por origen" con `Brasil' UNION SELECT username, password, 1, 1 FROM usuarios--`. El reporte devuelve **los usuarios y sus contraseñas**.

**Corrección** (PR #2): `HAVING pr.variedad = $1` y `db.query(sql, [variedad])`.

**Verificación.** Test "el reporte por origen NO filtra otras tablas con UNION". Controles SQLI-01 y SQLI-02.

### Reflexión — Inyección SQL

El código ya tenía consultas parametrizadas en otros lugares: el problema era la inconsistencia. En un proyecto real, todo el acceso a la base debería pasar por consultas parametrizadas o por un query builder u ORM, nunca por concatenación. Un linter o el análisis estático en la integración continua detecta la concatenación antes del merge. Y **mínimos privilegios** en la base (#24) limita el daño si algo se escapa.

---

## 5. Práctica 2 — Cross-Site Scripting

> **OWASP A03:2021.** El navegador no distingue el script del programador del que trae el atacante: si llega al DOM como HTML, se ejecuta. La defensa principal es **tratar todo dato como texto** (`textContent`); la CSP (#23) es una capa extra, no un reemplazo.

### #5 · XSS reflejado en el buscador y en los mensajes de error — *Conrado*

**Dónde estaba**

- `src/public/js/app.js:130`: el texto buscado (eco del servidor en `filtros.q`) se insertaba con `innerHTML`. También los mensajes de error (`:233`, `:288`) y el login del panel (`admin.js:63`).
- `src/routes/productos.routes.ts:58`: `` error: `No existe el producto "${req.params.id}".` ``
- `src/middleware/errores.ts:18`: el 404 de la API reflejaba la URL. `src/routes/auth.routes.ts:39` reflejaba el usuario (lo corrigió Luca en la #17).

**Cómo se observa.**
1. En el buscador, `<img src=x onerror=alert('XSS')>` hace saltar el `alert`.
2. `GET /api/productos/<script>alert(1)</script>` devuelve el `<script>` tal cual en el JSON.

**Por qué ocurre.** `innerHTML` le pide al navegador que **interprete** el texto como marcado, así que los atributos de evento del payload se ejecutan.

**Corrección** (PR #8)

- **Cliente.** No queda ninguna asignación a `innerHTML` en `app.js` ni en `admin.js`; también se eliminó el helper `escaparHtml()`, que lo usaba. El DOM se arma con un helper que crea nodos, asigna el texto con `textContent` e ignora los atributos `on*` y `style`:

  ```js
  function h(tag, props, hijos) {
    var el = document.createElement(tag);
    Object.keys(props || {}).forEach(function (clave) {
      var valor = props[clave];
      if (valor == null || valor === false) return;
      if (/^on/i.test(clave) || clave === 'style') return;
      if (clave === 'text') el.textContent = String(valor);
      else if (clave === 'class') el.className = String(valor);
      else el.setAttribute(clave, String(valor));
    });
    agregarHijos(el, hijos);
    return el;
  }
  reemplazar(el, ['Resultados para ', h('strong', { text: filtros.q }), ' — ' + total + ' producto(s)']);
  ```

- **Servidor.** Los mensajes de error son fijos (`Producto no encontrado.`, `Ruta no encontrada.`) y el id del producto se valida como entero antes de consultar la base (400 si no es válido).

**Verificación.** Tests "el servidor NO devuelve HTML sin escapar en los errores", "el login NO devuelve HTML sin escapar en el mensaje de error" y "el cliente NO inserta datos con innerHTML". Controles XSS-01 y XSS-02.

### #6 · XSS almacenado en las reseñas — *Conrado*

**Qué es.** El payload queda **guardado en la base** y se ejecuta en el navegador de cada visitante, incluidos los administradores: es el "cartel que nadie había programado" de la consigna.

**Dónde estaba.** `src/public/js/app.js:259`: cada reseña se insertaba con `innerHTML`, y el servidor no validaba el texto.

**Cómo se observa.**
1. Publicar una reseña con `<img src=x onerror=alert('XSS almacenado')>`.
2. Recargar: el `alert` salta solo. Desde otro navegador también.

> Un `<script>…</script>` **no** se ejecuta cuando se inserta con `innerHTML`, aunque así lo sugiera la guía. Por eso la demostración usa un atributo de evento.

**Corrección** (PR #8). Cada reseña se arma con nodos y `textContent`, y la cantidad de estrellas se acota entre 0 y 5. En el servidor se agregó la validación de longitud (ver [Correcciones adicionales](#10-correcciones-adicionales)).

**Verificación.** Tests "el cliente NO inserta datos con innerHTML" y "no se aceptan reseñas sin límite de longitud". Controles XSS-01 y XSS-04.

### #7 · XSS de DOM en el panel — *Conrado*

**Dónde estaba.** `src/public/js/admin.js:425-427`

```js
var objetivo = params.get('vista');
if (objetivo) { $('#panel-bienvenida').innerHTML = 'Panel ' + objetivo; }
```

**Cómo se observa.** Abrir `http://localhost:8080/admin.html?vista=<img src=x onerror=alert('DOM')>`.

**Por qué ocurre.** El dato sale de la URL, que controla quien arma el enlace, y nunca pasa por el servidor.

**Corrección** (PR #8). El parámetro sólo elige una pestaña de una **lista blanca** y nunca se pinta en la página. El resto del panel (KPIs, tablas y mensajes) también se reescribió con nodos.

```js
var VISTAS_PERMITIDAS = ['resumen', 'pedidos', 'productos', 'reportes', 'usuarios', 'herramientas'];
function mostrarVista(vista) {
  if (VISTAS_PERMITIDAS.indexOf(vista) === -1) return;
  /* activa la pestaña */
}
if (objetivo) mostrarVista(objetivo);
```

**Verificación.** Test "el cliente NO inserta datos con innerHTML" y control XSS-01.

### Reflexión — XSS

La regla tiene que ser "todo dato es texto salvo que se demuestre lo contrario". Los frameworks modernos escapan por defecto; si hace falta insertar HTML, se usa un sanitizador (DOMPurify). Una regla de linter que prohíba `innerHTML` lo frena en la revisión, y la CSP estricta que agregó Vladimir (#23) limita el daño si algo se cuela, pero no reemplaza la corrección.

---

## 6. Práctica 3 — CSRF

### #8 · CSRF en los formularios que cambian estado — *Conrado*

**Qué es.** El navegador manda las cookies del sitio aunque la petición la dispare otra página. Si la app sólo mira la cookie, una página ajena puede crear pedidos o cambiar la contraseña del admin en nombre de la víctima.

**Dónde estaba.** Ninguna operación que cambia estado pedía token: `POST /api/pedidos`, `POST /api/comentarios` y las operaciones del panel (productos, usuarios, cambio de contraseña, subida de archivos). Además, la cookie de sesión no tenía `SameSite` (lo corrigió Jano en la #13).

**Cómo se observa.** Crear un `ataque.html` local y abrirlo en el navegador:

```html
<form method="POST" action="http://localhost:8080/api/pedidos">
  <input name="mesa" value="99">
  <input name="cliente" value="Atacante">
  <input name="items[0][productoId]" value="4">
  <input name="items[0][cantidad]" value="1">
</form>
<script>document.forms[0].submit();</script>
```

1. Aparece en el panel un pedido de la mesa 99 que nadie pidió.
2. Con la sesión de admin abierta, un formulario similar contra `/api/admin/cambiar-contrasena` (`<input name="nueva" value="hackeada">`) cambia la contraseña.
   - En Chrome, las cookies sin `SameSite` se tratan como `Lax`: el envío cruzado sólo funciona en los 2 minutos posteriores al login, o hay que usar Firefox.

> La versión de `GUIA-PRACTICA.md` manda `items` como texto JSON. Con un formulario eso no llega como lista y el pedido falla con un error 500. Con `items[0][...]`, Express arma el array y el pedido se crea.

**Por qué ocurre.** La app confiaba en que la petición llegara con la cookie (en pedidos y reseñas, ni siquiera eso), sin comprobar que viniera de su propia interfaz.

**Corrección** (PR #15, `src/middleware/csrf.ts`, montado en `src/app.ts` antes de todas las rutas de la API)

- **Token firmado y ligado a la sesión.** `GET /api/csrf-token` entrega el token y asigna una semilla aleatoria de 32 bytes en una cookie `csrf` (`HttpOnly`, `SameSite=Strict`).
  - token = `HMAC-SHA256(secreto, semilla + id de sesión)`.
  - Cambia al iniciar o cerrar sesión, no se puede fabricar sin el secreto y funciona sin sesión, porque pedidos y reseñas son públicos.
- **Verificación.** Todo `POST`, `PUT`, `PATCH` y `DELETE` a `/api` tiene que traer el token en `X-CSRF-Token` (o `_csrf` en el cuerpo; en `DELETE` también `?_csrf=`). Se compara en **tiempo constante**; sin token válido responde 403.
- **Control de `Origin`** como capa adicional: si viene y no es el propio sitio (incluido `Origin: null`), responde 403. No se usa `Referer`, porque la app envía `Referrer-Policy: no-referrer`.
- **Frontend.** Pide el token, lo manda en la cabecera, lo descarta al hacer login o logout y reintenta una vez si el servidor lo rechaza.
- **El secreto de firma** dejó de estar escrito en el código (ver CFG-02 en [Correcciones adicionales](#10-correcciones-adicionales)).

```ts
// Versión simplificada; el código completo está en src/middleware/csrf.ts
export function verificarCsrf(req, res, next) {
  if (METODOS_SEGUROS.has(req.method)) return next();
  if (!origenPermitido(req)) return res.status(403).json(ERROR_ORIGEN);
  if (RUTAS_SIN_TOKEN.has(req.baseUrl + req.path)) return next();   // sólo el login
  const cookies = leerCookies(req);
  const token = tokenRecibido(req);
  if (!cookies.csrf || !token || !tokensIguales(token, firmar(cookies.csrf, cookies.sid || ''))) {
    return res.status(403).json(ERROR_CSRF);
  }
  next();
}
```

**Verificación.** Test "existe un token anti-CSRF y las peticiones sin token se rechazan". Controles CSRF-01, CSRF-02 (la cookie con `SameSite`, #13), CSRF-03 y CSRF-04.

| Caso | Resultado |
|---|---|
| `ataque.html` contra la versión corregida | 403 `origen_invalido`, no se crea el pedido |
| `POST` sin token, token inventado o token sin su cookie | 403 `csrf_invalido` |
| Token obtenido antes del login y usado después | 403 (está ligado a la sesión) |
| Uso normal desde la web y el panel | Funciona |

### Reflexión — CSRF

Toda operación que cambia estado necesita una prueba de intención además de la cookie. `SameSite` ayuda, pero no alcanza por sí solo. Conviene usar el mecanismo del framework desde el principio: agregarlo al final obliga a tocar cliente y servidor a la vez. Y las operaciones destructivas nunca deben hacerse con `GET` (CSRF-04).

---

## 7. Práctica 4 — Validación de entrada

> **OWASP A04:2021.** "No confíes en el usuario": la validación del HTML se saltea con DevTools, así que **todo** se valida en el servidor (tipo, longitud, rango y formato) con listas blancas.

### #9 · Validación débil en pedidos — *Vladimir*

**Qué es.** Es el "pedido con total negativo" de la consigna: la cafetería le debía plata a la mesa 4.

**Dónde estaba.** `src/services/pedidos.service.ts:41-64`: no se validaban el tipo, el rango ni la longitud de `cantidad`, `mesa`, `cliente` ni de la lista de items.

**Cómo se observa.**
- `POST /api/pedidos` con `{"items":[{"productoId":4,"cantidad":-5}], ...}` da un **total negativo**.
- Con `cantidad: "abc"` el total queda `NaN` y envenena la facturación.
- Con DevTools, cambiar el `type="number"` del formulario permite mandar texto.

**Corrección** (PR #3). Validación completa en el servidor antes de calcular nada:

- mesa: texto de 1 a 10 caracteres; cliente: texto de 2 a 40.
- items: de 1 a 50; `productoId`: entero positivo; `cantidad`: entero de 1 a 100.
- Producto inexistente o total fuera de rango: error de validación (400), no un 500.

```ts
if (typeof item.cantidad !== 'number' || !Number.isInteger(item.cantidad) ||
    item.cantidad < 1 || item.cantidad > MAX_CANTIDAD) {
  throw new ErrorValidacionPedido(`La cantidad debe ser un entero entre 1 y ${MAX_CANTIDAD}.`);
}
```

**Verificación.** Tests "no se aceptan cantidades negativas" y "no se aceptan cantidades no numéricas". Controles VAL-02 y VAL-03.

> Esta validación es estricta con los tipos (exige números JSON). La web mandaba el `productoId` como texto, porque lo leía de un atributo `data-id`, y a partir de este PR **dejó de poder crear pedidos**. Los tests no lo detectaban porque mandan números. Se corrigió en el cliente: ver [Correcciones adicionales](#10-correcciones-adicionales).

### #10 · Subida de archivos sin restricciones — *Conrado*

**Qué es.** Se aceptaba cualquier archivo, con el nombre que elegía el cliente, y se servía desde el mismo origen. Un `.html` subido es XSS servido por el propio sitio, y con `../` se podía escribir fuera de la carpeta. Son las "cosas que Valentina no había subido".

**Dónde estaba.** `src/routes/admin.routes.ts:180-198` y `src/app.ts:30`

```ts
const destino = path.join(config.uploadsDir, nombre);   // nombre del cliente, sin validar
fs.writeFileSync(destino, buffer);                      // sin tipo ni tamaño
```

**Cómo se observa.** Panel → Productos → Subir imagen → un `.html` con `<script>alert(document.domain)</script>`. Al abrir la URL devuelta, el script corre en el dominio de la cafetería.

**Corrección** (PR #11)

1. **Extensión** en lista blanca (`.png`, `.jpg`, `.jpeg`, `.webp`). Se excluyen SVG (puede llevar `<script>`) y HTML.
2. **Contenido real:** se comprueba la firma del archivo (*magic number*), que tiene que coincidir con la extensión.
3. **Tamaño máximo** de 512 KB y formato base64 validado.
4. **Nombre generado por el servidor** (`randomUUID()` más la extensión detectada). No hay path traversal y no se puede pisar un archivo existente (flag `wx`).
5. **Al servir `/uploads`** sólo se entregan imágenes, con `Content-Security-Policy: … sandbox`.

```ts
const tipoReal = detectarTipoImagen(buffer);   // PNG 89 50 4E 47…, JPEG FF D8 FF, WEBP RIFF…WEBP
if (!tipoReal || tipoReal !== tipoPorExtension) return res.status(400).json({ /* ... */ });
const nombreSeguro = `${crypto.randomUUID()}${EXTENSION_DE_TIPO[tipoReal]}`;
fs.writeFileSync(destino, buffer, { flag: 'wx', mode: 0o644 });
```

**Verificación.** Test "no se aceptan archivos ejecutables ni se escribe fuera de uploads". Controles VAL-04 y VAL-05.

| Caso | Resultado |
|---|---|
| Imagen real | 201, se guarda como `<uuid>.png` |
| `.html`, `.svg` o HTML renombrado a `.png` | 400 |
| Nombre `../../x.png` | Se guarda como `<uuid>.png` dentro de `uploads/` |
| Más de 512 KB | 413 |
| `GET /uploads/<algo>.html` | 404 |

### Reflexión — Validación

La validación del navegador es comodidad para el usuario, no seguridad. En un proyecto real conviene un esquema declarativo (Zod, Joi) aplicado en todas las entradas, y probarlo también con los datos que manda el cliente real, no sólo con los de los tests: así se habría detectado la rotura del carrito. Los archivos se validan por contenido, no por nombre, y se sirven idealmente desde otro dominio.

---

## 8. Práctica 5 — Autenticación y sesiones

> **OWASP A02 / A07 / A01.** Autenticación es *quién sos*; autorización es *qué podés hacer*. Las dos tienen que estar separadas y aplicarse en el servidor.

### #11 · Contraseñas en texto plano — *Luca*

**Dónde estaba.** `src/inicializar.ts:59-62` guardaba `usuario.password` tal cual, y `usuarios.service.ts` comparaba en texto plano (`:42`) y guardaba la contraseña nueva igual (`:79`).

**Cómo se observa.** `docker compose exec db psql -U postgres -d origen -c "SELECT username, password FROM usuarios;"` muestra `admin|admin`, `valentina|origen2024`, etc. Cualquier filtración (la inyección del #4, un backup) expone todas las cuentas.

**Corrección** (PR #13). Hash `bcrypt` con salt (costo 10) en la carga inicial y en el cambio de contraseña, y comparación con `bcrypt.compare` (ver #1):

```ts
const hash = await bcrypt.hash(usuario.password, 10);
await db.query('INSERT INTO usuarios (username, password, rol, nombre) VALUES ($1, $2, $3, $4) ...',
  [usuario.username, hash, usuario.rol, usuario.nombre]);
```

**Verificación.** Test "las contraseñas NO se guardan en texto plano". Controles AUTH-01, AUTH-02 y AUTH-03. La misma consulta ahora muestra hashes `$2a$10$…`.

> **Límite:** la carga inicial usa `ON CONFLICT DO NOTHING`, así que **no migra** una base creada antes del cambio. En esa base los usuarios quedan en texto plano y no pueden iniciar sesión. Ver [Decisiones de diseño y límites conocidos](#11-decisiones-de-diseño-y-límites-conocidos).

### #12 · Sin protección contra fuerza bruta — *Luca*

**Dónde estaba.** `src/routes/auth.routes.ts:18`: el login no tenía ningún límite.

**Cómo se observa.** Probar a mano varias contraseñas para `admin`: no hay bloqueo, ni retardo, ni aviso.

**Corrección** (PR #13). `express-rate-limit` sobre el login: 5 intentos fallidos por IP cada 15 minutos. Los logins correctos no cuentan. Al superarlo responde **429** con un mensaje genérico.

```ts
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.' },
});
router.post('/login', limitadorLogin, /* ... */);
```

**Verificación.** Tests "el login bloquea o limita los intentos repetidos" y "el login correcto sigue funcionando después de un bloqueo". Control AUTH-04.

### #13 · Cookie de sesión sin HttpOnly, Secure ni SameSite — *Jano*

**Dónde estaba.** `src/middleware/sesion.ts:62`: `res.cookie('sid', id, { path: '/' });`

**Cómo se observa.** DevTools → Application → Cookies: `sid` aparece sin `HttpOnly`, sin `Secure` y sin `SameSite`. Sin `HttpOnly`, cualquier XSS roba la sesión con `document.cookie`.

**Corrección** (PR #14):

```ts
const COOKIE_BASE: CookieOptions = {
  path: '/', httpOnly: true, sameSite: 'lax',
  secure: config.nodeEnv === 'production',   // en desarrollo (HTTP localhost) el navegador la descartaría
};
res.cookie('sid', id, { ...COOKIE_BASE, maxAge: TTL_MAXIMO_MS });
```

**Verificación.** Test "la cookie de sesión lleva HttpOnly, Secure y SameSite". Controles AUTH-05, AUTH-06 y CSRF-02.

### #14 · Identificador de sesión predecible — *Jano*

**Dónde estaba.** `src/middleware/sesion.ts:30` y `:52`: un contador (`sesion_1`, `sesion_2`, …).

**Cómo se observa.** Iniciar sesión dos veces y comparar las cookies: el valor es secuencial. Se adivina al instante y permite fijar la sesión de otra persona.

**Corrección** (PR #14). 32 bytes aleatorios criptográficamente seguros, y **regeneración del id al iniciar sesión**: la sesión previa de la petición se descarta, para que un id fijado de antemano no sobreviva al login.

```ts
const idPrevio = leerCookies(req).sid;
if (idPrevio) sesiones.delete(idPrevio);
const id = crypto.randomBytes(32).toString('hex');
```

**Verificación.** Test "el identificador de sesión es aleatorio y no predecible". Controles AUTH-07 y AUTH-08.

### #15 · Sesiones que nunca expiran — *Jano*

**Dónde estaba.** `src/middleware/sesion.ts:58`: `expiraEn: null`. Una cookie copiada servía para siempre.

**Cómo se observa.** Leyendo el código: la sesión se crea sin vencimiento y el servidor nunca la descarta.

**Corrección** (PR #14). Expiración por inactividad (30 minutos, renovable con el uso) y máxima absoluta (8 horas), **validadas en el servidor** en cada petición. Las sesiones vencidas se borran del almacén.

```ts
function estaVencida(sesion: Sesion, ahora: number): boolean {
  if (typeof sesion.expiraEn !== 'number') return true;
  return ahora >= sesion.expiraEn || ahora >= sesion.creadaEn + TTL_MAXIMO_MS;
}
```

**Verificación.** Controles AUTH-09 y AUTH-10 (la batería no tiene un test de comportamiento para esta falla).

### #16 · Logout que no invalida la sesión en el servidor — *Jano*

**Dónde estaba.** `src/routes/auth.routes.ts:69-72`: sólo se borraba la cookie del navegador.

**Cómo se observa.** Copiar el valor de `sid` desde DevTools, cerrar sesión y volver a crear la cookie con ese valor: se sigue dentro del panel.

**Corrección** (PR #16). La sesión se borra **del almacén del servidor** y además se limpia la cookie con los mismos atributos con que se creó:

```ts
router.post('/logout', (req, res) => {
  destruirSesion(req);
  limpiarCookieSesion(res);
  res.json({ mensaje: 'Sesión cerrada.' });
});
```

**Verificación.** Test "el logout invalida la sesión en el servidor". Control AUTH-11.

### #17 · Enumeración de usuarios — *Luca*

**Dónde estaba.** `src/routes/auth.routes.ts:35` y `:39`: dos mensajes distintos ("La contraseña es incorrecta." y `El usuario "<x>" no existe en el sistema.`). El segundo además reflejaba la entrada (XSS).

**Cómo se observa.** Probar `fantasma` (no existe) y `valentina` con una contraseña errónea: los mensajes son distintos.

**Corrección** (PR #13). Mismo estado (401) y mismo mensaje en los dos casos: `Usuario o contraseña incorrectos.`

**Verificación.** Test "los mensajes de login son genéricos (sin enumeración de usuarios)". Controles AUTH-12 y XSS-02.

### #18 · Autorización ausente en el panel — *Conrado*

**Dónde estaba.** `src/routes/admin.routes.ts:31`: `requiereRol` estaba importado pero no se aplicaba; sólo se exigía estar autenticado.

**Cómo se observa.** Entrar al panel con `cliente/cliente`: todas las pestañas cargan datos, incluida la lista de usuarios.

**Corrección** (PR #9). El control se aplica a **nivel de router**, antes de buscar la ruta, y cubre todos los endpoints del panel, también los futuros. Además, las respuestas dejaron de incluir la contraseña (`usuarioPublico`), que antes salía del `SELECT *`.

```ts
router.use(requiereSesion, requiereRol('admin'));
```

**Verificación.** Test "un usuario sin rol admin NO puede entrar al panel" y control AUTH-14. Con `cliente`, `GET /api/admin/usuarios` responde 403.

### #19 · Escalada de privilegios — *Conrado*

**Qué es.** Es el "cliente que amaneció con rol de administrador" de la consigna.

**Dónde estaba.** `src/routes/admin.routes.ts:49-56`: asignación masiva del cuerpo, incluido `rol` (y `password`, sin hashear).

**Cómo se observa.** Con `cliente`, en la pestaña Usuarios, cambiarse el rol a `admin` y recargar.

**Corrección** (PR #9)

- Sólo se aceptan `username`, `nombre` y `rol`, cada uno validado.
- El rol sólo lo cambia un admin (verificación explícita), tiene que estar en la lista blanca `ROLES_PERMITIDOS`, y nadie puede cambiar **su propio** rol.
- La contraseña no se cambia por esta ruta.

```ts
if (!req.usuario || req.usuario.rol !== 'admin') return res.status(403).json({ /* ... */ });
if (!ROLES_PERMITIDOS.includes(rol)) return res.status(400).json({ /* ... */ });
if (req.usuario.id === id && rol !== req.usuario.rol) {
  return res.status(403).json({ error: 'No podés cambiar tu propio rol.' });
}
```

**Verificación.** Test "un usuario NO puede cambiar su propio rol a admin" y control AUTH-15. Se verificó antes de integrar CSRF, para que el test no pasara sólo porque faltaba el token.

### Reflexión — Autenticación y sesiones

Nada de esto hay que inventarlo: hay librerías probadas para hashear (bcrypt, Argon2), para sesiones (`express-session` con un almacén persistente) y para limitar intentos. El error típico es implementar "a mano" y olvidar un detalle (el id, la expiración, el logout). En autorización la regla es **denegar por defecto**: el permiso se aplica al grupo de rutas completo, nunca se copia `req.body` al modelo, y hay tests que prueban cada endpoint con un rol insuficiente.

---

## 9. Práctica 6 — Comandos, configuración y exposición

### #20 · Inyección de comandos en "probar conexión" — *Conrado*

**Dónde estaba.** `src/routes/admin.routes.ts:149-160`

```ts
const comando = `ping -c 3 ${host}`;
exec(comando, (error, stdout, stderr) => { /* devuelve stdout */ });
```

**Cómo se observa.** Panel → Herramientas, escribir `127.0.0.1; cat /etc/hostname`: después del ping aparece el contenido de `/etc/hostname`. El comando se ejecuta como root dentro del contenedor.

**Por qué ocurre.** `exec` lanza `/bin/sh -c`, y el shell interpreta `;`, `&&`, `|` y `$()`.

**Corrección** (PR #10)

1. **Lista blanca** de destinos propios del entorno (`db`, `localhost`, `127.0.0.1`); cualquier otro valor da 400.
2. **`execFile` sin shell** y con argumentos separados: el host es siempre **un** argumento de `ping`.
3. Tiempo y salida acotados. En el panel, el campo pasó a ser un `<select>`.

```ts
if (!HOSTS_PERMITIDOS.includes(destino)) return res.status(400).json({ /* ... */ });
execFile('ping', ['-c', '3', '-W', '2', destino],
  { shell: false, timeout: PING_TIMEOUT_MS, maxBuffer: PING_SALIDA_MAX }, /* ... */);
```

**Verificación.** Tests "el endpoint de conexión NO ejecuta el comando inyectado" y "… NO ejecuta un segundo comando encadenado". Controles CMD-01, CMD-02 y CMD-03.

### #21 · Exposición de secretos por `/api/_diagnostico` — *Vladimir*

**Dónde estaba.** `src/routes/debug.routes.ts:17-28`: devolvía `process.env` completo y `DB_PASSWORD`, sin autenticación.

**Cómo se observa.** Abrir `http://localhost:8080/api/_diagnostico` **sin iniciar sesión**: aparecen la contraseña de la base, el usuario, la versión de Node y el PID.

**Corrección** (PR #5). Exige sesión y rol admin, y devuelve sólo un estado mínimo, sin datos del entorno:

```ts
router.get('/', requiereSesion, requiereRol('admin'), (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ mensaje: 'Diagnóstico del servidor', ok: true });
});
```

**Verificación.** Test "el endpoint de diagnóstico NO expone secretos". Controles CFG-03 y CFG-04.

### #22 · Stack traces enviados al cliente — *Vladimir*

**Dónde estaba.** `src/middleware/errores.ts:30`: la respuesta de error incluía `stack: err.stack`.

**Cómo se observa.** Provocar un error (por ejemplo, un pedido con un `productoId` inexistente): la respuesta trae rutas del servidor, nombres de tablas y fragmentos de SQL.

**Corrección** (PR #4). El detalle queda en el log del servidor; al cliente sólo le llega un mensaje genérico según el código de estado:

```ts
console.error('[error]', err.stack || err.message);
res.status(status).json({
  error: status >= 500 ? 'Error interno del servidor.' : 'No se pudo procesar la solicitud.',
});
```

**Verificación.** Test "la API NO devuelve stack traces al cliente". Control VAL-06.

### #23 · Sin cabeceras de seguridad (helmet y CSP) — *Vladimir*

**Dónde estaba.** `src/app.ts:26-27`: no había `helmet` ni CSP.

**Cómo se observa.** DevTools → Network → cabeceras de la respuesta de `/`: no hay `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options` ni `Referrer-Policy`.

**Corrección** (PR #6). `helmet` con una CSP restrictiva y otras protecciones:
- `script-src 'self'`, sin `unsafe-inline` ni `unsafe-eval`; `object-src 'none'` y `frame-ancestors 'none'`.
- `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, y HSTS en producción.

El frontend se adaptó a la CSP en lugar de relajarla: no hay scripts inline ni atributos `style`.

**Verificación.** Test "el sitio envía cabeceras de seguridad". Controles XSS-03 y CFG-01.

### #24 · Base de datos sin contraseña y con superusuario — *Vladimir*

**Dónde estaba.** `docker-compose.yml:25`, `:29`, `:60` y `:61`: `POSTGRES_HOST_AUTH_METHOD: trust`, contraseña `postgres`, y la app conectada como el superusuario `postgres`.

**Cómo se observa.** `docker compose exec db psql -U postgres -d origen` entra sin contraseña. Y desde cualquiera de las inyecciones SQL se podía borrar o crear cualquier cosa, porque la app era superusuario.

**Corrección** (PR #7)
- Autenticación `scram-sha-256`.
- Contraseñas desde variables de entorno (`.env`, fuera de Git), obligatorias para arrancar.
- La app usa `origen_app`: sin superusuario, sin crear bases ni roles, y sólo con `SELECT/INSERT/UPDATE/DELETE` sobre las tablas de la app. Se revocaron `CREATE` y `TEMPORARY` a `PUBLIC`.

```yaml
POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:?Defini POSTGRES_PASSWORD fuera del repositorio}"
POSTGRES_HOST_AUTH_METHOD: scram-sha-256
DB_USER: origen_app
```

**Verificación.** Test "la aplicación NO se conecta con un superusuario de la base". Controles SQLI-03 y SQLI-05 (SQLI-04, el puerto no publicado, ya cumplía).

### Reflexión — Comandos y configuración

Evitar el shell siempre que se pueda (APIs nativas o argumentos separados con lista blanca). La configuración es parte del código de seguridad: secretos fuera del repositorio, mínimos privilegios en la base y en el contenedor, endpoints de diagnóstico inexistentes en producción, y errores genéricos hacia afuera con el detalle en el log.

---

## 10. Correcciones adicionales

Fallas que aparecen en los tests, en el checklist o en el uso real, pero no en la lista de 24.

| Falla | Dónde | Corrección | Verificación |
|---|---|---|---|
| Reseñas sin límite (VUL-11) | `routes/comentarios.routes.ts` | Autor de 2 a 40 caracteres, texto de 3 a 280 y calificación entera de 1 a 5, validados en el servidor con mensajes fijos (PR #8). | Test "no se aceptan reseñas sin límite de longitud", XSS-04 |
| 404 que refleja la URL | `middleware/errores.ts` | Mensaje fijo `Ruta no encontrada.` (PR #8). | XSS-02 |
| Secreto de firma en el código (CFG-02) | `config.ts` (`'origen-cafe-2024'`) | Se lee de `SESSION_SECRET` (mínimo 32 caracteres); si no está definido, se genera uno aleatorio en cada arranque (PR #15). | CFG-02 |
| Ids de ruta sin validar (VAL-01) | rutas de productos y del panel | Entero positivo dentro del rango de PostgreSQL (PR #8 y #9). | VAL-01 |
| Contraseñas en las respuestas del panel | `routes/admin.routes.ts` | Las respuestas de usuarios no incluyen el campo `password` (PR #9). | Petición a la API |
| Falso positivo de SQLI-01 | `services/catalogo.service.ts` | El marcador posicional se escribe directo; el SQL no cambia (PR #17). | SQLI-01 |
| **La web no podía crear pedidos** | `public/js/app.js` | El carrito tomaba el id de un atributo `data-id` (texto) y la validación del #9 exige números. Ahora se convierte con `Number()` al agregar al carrito y al enviar (rama `fix/pedido-web-productoid`). | API: id como texto → 400; como número → 201 |

---

## 11. Decisiones de diseño y límites conocidos

**Decisiones**

- **Las imágenes subidas se sirven desde el mismo origen**, porque el panel las necesita. En lugar de moverlas "fuera del árbol web", se sirven sólo con nombres de imagen y con CSP `sandbox`.
- **El login no exige token CSRF.** Todavía no hay sesión que proteger, y lo cubren `SameSite`, el control de `Origin` y el límite de intentos. Los tests de la cátedra también inician sesión sin token.
- **La cookie `Secure` se activa sólo en producción.** Sobre `http://localhost` el navegador descartaría una cookie `Secure` y no se podría iniciar sesión en la demo.
- **"Cambiar contraseña" queda sólo para administradores**, porque la ruta está bajo `/api/admin`.

**Límites conocidos y mejoras propuestas**

| Tema | Situación | Mejora propuesta |
|---|---|---|
| Migración de contraseñas | Una base creada antes del #11 conserva las contraseñas en texto plano y esos usuarios no pueden entrar. Hay que recrearla con `docker compose down -v`. | En `inicializar.ts`, rehashear las que no tengan formato bcrypt (`ON CONFLICT … DO UPDATE … WHERE password NOT LIKE '$2%'`). |
| Credenciales de fábrica (AUTH-13, recomendado) | `admin/admin` y similares siguen siendo las cuentas de prueba del TP. | Contraseñas generadas y cambio obligatorio en el primer ingreso. |
| Contenedor como root (CFG-05, recomendado) | La app corre como root; `ping` lo necesita. | Usuario sin privilegios en el Dockerfile y volver a probar "probar conexión". |
| Rol copiado en la sesión | Si se le quita el rol admin a alguien, conserva el rol hasta cerrar sesión o vencer. | Invalidar las sesiones del usuario al cambiarle el rol. |
| Enumeración por tiempo | Para un usuario inexistente no se ejecuta `bcrypt.compare`, así que la respuesta es más rápida. | Comparar contra un hash ficticio. |
| Sesiones y límite de intentos en memoria | Se pierden al reiniciar y no se comparten entre instancias. | Almacén compartido (Redis o base de datos). |
| IDOR en pedidos (VUL-28) | `GET /api/pedidos` es público; los tests funcionales lo usan sin sesión. | Asociar los pedidos al usuario o exigir rol de personal. |

---

## 12. Verificación final

Sobre `dev` (commit `21ebb77`, PR #17), con base de datos recién creada, el 24/11/2026:

```bash
docker compose exec app npm test                # 28/28 ✔
docker compose exec app npm run test:seguridad  # 29/29 ✔
docker compose exec app npm run check:security  # 37/37 controles críticos ✔ (2 recomendados pendientes)
docker compose exec app npm run typecheck       # sin errores
```

| Batería | Resultado | Recomendados pendientes |
|---|---|---|
| Funcional | **28/28** | — |
| Seguridad | **29/29** | — |
| Checklist | **37/37** críticos | AUTH-13, CFG-05 (ver sección 11) |

**Uso legítimo comprobado con peticiones a la API**, además de los tests funcionales: catálogo y búsqueda, pedidos y reseñas con token CSRF, login, panel con rol admin y con rol cliente, cambio de roles, subida de imagen y probar conexión.

---

## 13. Reflexión final

*¿Qué cambió en nuestra forma de pensar respecto de cómo se escribe una web app?*

- **"Funciona" no es lo mismo que "es seguro".** La app pasaba todos sus tests de negocio y tenía 24 fallas. Hay que preguntarse qué pasa si alguien la usa de una forma no prevista, y no sólo si hace lo que esperamos.
- **La entrada del usuario nunca es confiable**, venga del cuerpo, de la URL, de una cookie o del `localStorage`. Se valida en el servidor y se trata como texto al mostrarla.
- **Las defensas van en capas.** La CSP no reemplaza escapar la salida, `SameSite` no reemplaza el token CSRF, y los permisos del panel no reemplazan validar los archivos. Cada capa cubre lo que la otra puede dejar pasar.
- **Seguridad sin romper el negocio.** Una corrección puede romper un flujo real que los tests no cubren (nos pasó con el carrito). Por eso hace falta probar con el cliente real, no sólo con la batería.
- **Revisar lo que se pega.** La consigna cuenta que la web se armó pegando código generado sin leerlo. Toda herramienta que genera código acelera el trabajo, pero alguien tiene que entender y revisar lo que se integra.
- **El proceso importa.** Las ramas por bloque, los PR revisados, el orden de integración por archivos compartidos y las tres baterías como criterio de terminado evitaron conflictos y regresiones en un equipo de cuatro.
