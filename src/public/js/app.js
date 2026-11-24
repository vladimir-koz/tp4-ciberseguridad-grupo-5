/* =============================================================================
   Cafetería Origen — lógica del sitio público
   ============================================================================= */
(function () {
  'use strict';

  var API = '/api';
  var CARRITO_KEY = 'origen.carrito';

  var estado = {
    tipo: '',
    variedad: '',
    q: '',
    carrito: cargarCarrito(),
  };

  /* ---------------------------------------------------------------- utils */
  function $(sel) { return document.querySelector(sel); }

  function money(valor) {
    var n = Number(valor || 0);
    return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
  }

  /*
   * Renderizado seguro del DOM.
   *
   * Todo dato que viene del servidor, de la URL o del localStorage se inserta
   * como TEXTO (textContent / nodos de texto), nunca como marcado HTML. Así,
   * un "<script>" o un "<img onerror=...>" se muestra literalmente y el
   * navegador no lo interpreta.
   */
  function agregarHijos(el, hijos) {
    if (hijos == null) return;
    (Array.isArray(hijos) ? hijos : [hijos]).forEach(function (hijo) {
      if (hijo == null || hijo === false) return;
      if (typeof hijo === 'string' || typeof hijo === 'number') {
        el.appendChild(document.createTextNode(String(hijo)));
      } else {
        el.appendChild(hijo);
      }
    });
  }

  /**
   * Crea un elemento. `props.text` se asigna con textContent y `props.class`
   * con className; el resto se setea como atributo. Los atributos de eventos
   * (on*) y `style` se ignoran: no hacen falta y abrirían una vía de XSS.
   */
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

  /** Reemplaza el contenido de un elemento por los nodos indicados. */
  function reemplazar(el, hijos) {
    while (el.firstChild) el.removeChild(el.firstChild);
    agregarHijos(el, hijos);
  }

  function api(url, opciones) {
    return fetch(API + url, opciones).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  /*
   * Token anti-CSRF: se pide a GET /api/csrf-token y se manda en la cabecera
   * X-CSRF-Token de cada petición que cambia estado. Si el servidor lo
   * rechaza (por ejemplo porque cambió la sesión), se pide uno nuevo y se
   * reintenta una sola vez.
   */
  var tokenCsrf = null;

  function obtenerTokenCsrf() {
    if (tokenCsrf) return Promise.resolve(tokenCsrf);
    return api('/csrf-token').then(function (resp) {
      tokenCsrf = (resp.ok && resp.data.token) || null;
      return tokenCsrf;
    });
  }

  function enviar(metodo, url, cuerpo, esReintento) {
    return obtenerTokenCsrf().then(function (token) {
      return api(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token || '' },
        body: JSON.stringify(cuerpo || {}),
      });
    }).then(function (resp) {
      if (resp.status === 403 && resp.data.codigo === 'csrf_invalido' && !esReintento) {
        tokenCsrf = null;
        return enviar(metodo, url, cuerpo, true);
      }
      return resp;
    });
  }

  function postJSON(url, cuerpo) {
    return enviar('POST', url, cuerpo);
  }

  function guardarCarrito() {
    try {
      localStorage.setItem(CARRITO_KEY, JSON.stringify(estado.carrito));
    } catch (e) { /* almacenamiento no disponible */ }
  }

  function cargarCarrito() {
    try {
      var guardado = JSON.parse(localStorage.getItem(CARRITO_KEY));
      return Array.isArray(guardado) ? guardado : [];
    } catch (e) {
      return [];
    }
  }

  /* ------------------------------------------------------------- catálogo */
  function urlCatalogo() {
    var params = new URLSearchParams();
    if (estado.tipo) params.set('tipo', estado.tipo);
    if (estado.variedad) params.set('variedad', estado.variedad);
    if (estado.q) params.set('q', estado.q);
    var s = params.toString();
    return '/productos' + (s ? '?' + s : '');
  }

  function cargarProductos() {
    return api(urlCatalogo()).then(function (resp) {
      if (!resp.ok) {
        renderErrorProductos(resp.data && resp.data.error);
        return;
      }
      renderProductos(resp.data.productos);
      renderResultado(resp.data.filtros, resp.data.total);
    });
  }

  function renderProductos(productos) {
    var grid = $('#productos-grid');

    if (!productos || productos.length === 0) {
      reemplazar(grid, h('p', { class: 'empty', text: 'No encontramos productos con esos filtros.' }));
      return;
    }

    // Nombres, descripciones y etiquetas vienen de la base: se insertan
    // como texto, nunca como HTML.
    reemplazar(grid, productos.map(function (p) {
      window.__productos[p.id] = p;

      var tags = [h('span', { class: 'tag', text: p.tipo })];
      if (p.variedad) tags.push(h('span', { class: 'tag tag-origen', text: p.variedad }));
      if (p.tamano) tags.push(h('span', { class: 'tag', text: p.tamano }));

      return h('article', { class: 'product-card' }, [
        h('div', { class: 'product-top' }, [
          h('h3', { class: 'product-name', text: p.nombre }),
          h('span', { class: 'product-price', text: money(p.precio) }),
        ]),
        h('div', { class: 'product-tags' }, tags),
        h('p', { class: 'product-desc', text: p.descripcion }),
        h('button', { class: 'btn btn-ghost btn-agregar', 'data-id': p.id, text: 'Agregar' }),
      ]);
    }));
  }

  function renderResultado(filtros, total) {
    var el = $('#resultado-busqueda');

    // El texto buscado vuelve del servidor (eco de `q`): se muestra como texto.
    if (filtros && filtros.q) {
      reemplazar(el, [
        'Resultados para ',
        h('strong', { text: filtros.q }),
        ' — ' + total + ' producto(s)',
      ]);
    } else {
      el.textContent = total + ' producto(s) en el menú';
    }
  }

  function renderErrorProductos(mensaje) {
    reemplazar($('#productos-grid'), h('p', {
      class: 'empty',
      text: 'No se pudo cargar el menú: ' + (mensaje || 'error desconocido'),
    }));
  }

  /* --------------------------------------------------------------- carrito */
  function agregarAlCarrito(productoId) {
    var existente = null;
    for (var i = 0; i < estado.carrito.length; i++) {
      if (String(estado.carrito[i].id) === String(productoId)) existente = estado.carrito[i];
    }
    if (existente) {
      existente.cantidad += 1;
    } else {
      estado.carrito.push({
        id: productoId,
        nombre: window.__productos[productoId] ? window.__productos[productoId].nombre : 'Producto',
        precio: window.__productos[productoId] ? window.__productos[productoId].precio : 0,
        cantidad: 1,
      });
    }
    guardarCarrito();
    renderCarrito();
  }

  function cambiarCantidad(indice, delta) {
    var item = estado.carrito[indice];
    if (!item) return;
    item.cantidad += delta;
    if (item.cantidad <= 0) estado.carrito.splice(indice, 1);
    guardarCarrito();
    renderCarrito();
  }

  function quitarDelCarrito(indice) {
    estado.carrito.splice(indice, 1);
    guardarCarrito();
    renderCarrito();
  }

  function renderCarrito() {
    var cont = $('#carrito');
    var lista = $('#resumen-carrito');
    var total = 0;

    if (estado.carrito.length === 0) {
      reemplazar(cont, h('p', { class: 'empty', text: 'El carrito está vacío.' }));
      reemplazar(lista, null);
      $('#resumen-total').textContent = money(0);
      return;
    }

    // El carrito sale del localStorage, que también es entrada no confiable.
    reemplazar(cont, estado.carrito.map(function (item, i) {
      var subtotal = item.precio * item.cantidad;
      total += subtotal;
      return h('div', { class: 'cart-item' }, [
        h('div', null, [
          h('div', { class: 'cart-item-name', text: item.nombre }),
          h('div', { class: 'cart-item-meta', text: money(item.precio) + ' c/u' }),
        ]),
        h('div', { class: 'qty-control' }, [
          h('button', { type: 'button', 'data-acc': 'menos', 'data-i': i, text: '−' }),
          h('span', { text: item.cantidad }),
          h('button', { type: 'button', 'data-acc': 'mas', 'data-i': i, text: '+' }),
        ]),
        h('div', null, [
          h('div', { class: 'cart-item-price', text: money(subtotal) }),
          h('button', { type: 'button', class: 'link-danger', 'data-acc': 'quitar', 'data-i': i, text: 'Quitar' }),
        ]),
      ]);
    }));

    reemplazar(lista, estado.carrito.map(function (item) {
      return h('li', null, [
        h('span', { text: item.nombre + ' × ' + item.cantidad }),
        h('span', { text: money(item.precio * item.cantidad) }),
      ]);
    }));

    $('#resumen-total').textContent = money(total);
  }

  /* ---------------------------------------------------------------- pedidos */
  function enviarPedido(evento) {
    evento.preventDefault();
    var feedback = $('#pedido-feedback');
    feedback.className = 'form-feedback';
    feedback.textContent = 'Enviando…';

    postJSON('/pedidos', {
      mesa: $('#pedido-mesa').value,
      cliente: $('#pedido-cliente').value,
      // El servidor exige enteros (validación de pedidos): el id sale de un
      // atributo data-id o del localStorage como texto, así que se convierte.
      items: estado.carrito.map(function (item) {
        return { productoId: Number(item.id), cantidad: Number(item.cantidad) };
      }),
    }).then(function (resp) {
      if (!resp.ok) {
        // El mensaje del servidor se muestra como texto.
        feedback.className = 'form-feedback is-error';
        feedback.textContent = 'No pudimos enviar el pedido: ' + (resp.data.error || 'error desconocido');
        return;
      }
      feedback.className = 'form-feedback is-ok';
      feedback.textContent = '¡Pedido #' + resp.data.id + ' recibido! Total ' + money(resp.data.total) +
        '. Te atendemos en la mesa ' + resp.data.mesa + '.';
      estado.carrito = [];
      guardarCarrito();
      renderCarrito();
      $('#form-pedido').reset();
    }).catch(function () {
      feedback.className = 'form-feedback is-error';
      feedback.textContent = 'Error de conexión con el servidor.';
    });
  }

  /* --------------------------------------------------------------- reseñas */
  function cargarReseñas() {
    return api('/comentarios').then(function (resp) {
      var cont = $('#lista-resenas');
      if (!resp.ok || !resp.data.comentarios || resp.data.comentarios.length === 0) {
        reemplazar(cont, h('p', { class: 'empty', text: 'Todavía no hay reseñas. ¡Sé el primero!' }));
        return;
      }
      // Las reseñas vienen de la base (las escribió cualquier visitante):
      // se muestran como texto inerte.
      reemplazar(cont, resp.data.comentarios.map(function (c) {
        var estrellas = '';
        var cantidad = Math.max(0, Math.min(5, Math.floor(Number(c.calificacion) || 0)));
        for (var i = 0; i < cantidad; i++) estrellas += '★';
        return h('article', { class: 'review' }, [
          h('div', { class: 'review-head' }, [
            h('span', { class: 'review-author', text: c.autor }),
            h('span', { class: 'review-stars', text: estrellas }),
          ]),
          h('p', { class: 'review-text', text: c.texto }),
        ]);
      }));
    });
  }

  function enviarReseña(evento) {
    evento.preventDefault();
    var feedback = $('#resena-feedback');
    feedback.className = 'form-feedback';
    feedback.textContent = 'Publicando…';

    postJSON('/comentarios', {
      autor: $('#resena-autor').value,
      texto: $('#resena-texto').value,
      calificacion: Number($('#resena-calificacion').value),
    }).then(function (resp) {
      if (!resp.ok) {
        feedback.className = 'form-feedback is-error';
        feedback.textContent = 'No se pudo publicar: ' + (resp.data.error || 'error desconocido');
        return;
      }
      feedback.className = 'form-feedback is-ok';
      feedback.textContent = '¡Gracias por tu reseña!';
      $('#form-resena').reset();
      cargarReseñas();
    });
  }

  /* ------------------------------------------------------------- listeners */
  function init() {
    window.__productos = {};

    // Filtros
    document.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('is-active'); });
        chip.classList.add('is-active');
        estado.tipo = chip.getAttribute('data-tipo');
        cargarProductos();
      });
    });

    $('#filtro-variedad').addEventListener('change', function (e) {
      estado.variedad = e.target.value;
      cargarProductos();
    });

    var temporizador = null;
    $('#filtro-busqueda').addEventListener('input', function (e) {
      estado.q = e.target.value;
      clearTimeout(temporizador);
      temporizador = setTimeout(cargarProductos, 250);
    });

    // Carrito (delegación de eventos)
    $('#productos-grid').addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-agregar');
      if (!btn) return;
      agregarAlCarrito(Number(btn.getAttribute('data-id')));
    });

    $('#carrito').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var i = Number(btn.getAttribute('data-i'));
      var accion = btn.getAttribute('data-acc');
      if (accion === 'mas') cambiarCantidad(i, 1);
      else if (accion === 'menos') cambiarCantidad(i, -1);
      else if (accion === 'quitar') quitarDelCarrito(i);
    });

    $('#form-pedido').addEventListener('submit', enviarPedido);
    $('#form-resena').addEventListener('submit', enviarReseña);

    // Carga inicial
    api(urlCatalogo()).then(function (resp) {
      if (resp.ok) {
        (resp.data.productos || []).forEach(function (p) { window.__productos[p.id] = p; });
        renderProductos(resp.data.productos);
        renderResultado(resp.data.filtros, resp.data.total);
      } else {
        renderErrorProductos(resp.data.error);
      }
    });
    cargarReseñas();
    renderCarrito();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
