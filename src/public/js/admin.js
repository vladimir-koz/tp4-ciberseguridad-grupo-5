/* =============================================================================
   Cafetería Origen — lógica del panel de administración
   ============================================================================= */
(function () {
  'use strict';

  var API = '/api';
  var usuario = null;
  var productosCache = {};

  /** Pestañas válidas del panel (lista blanca para el parámetro ?vista=). */
  var VISTAS_PERMITIDAS = ['resumen', 'pedidos', 'productos', 'reportes', 'usuarios', 'herramientas'];
  var ESTADOS_PEDIDO = ['abierto', 'preparando', 'listo', 'entregado'];
  var ROLES = ['cliente', 'mozo', 'barista', 'admin'];

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function money(valor) {
    return Number(valor || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });
  }

  /*
   * Renderizado seguro del DOM.
   *
   * Todo dato que viene del servidor o de la URL se inserta como TEXTO
   * (textContent / nodos de texto), nunca como marcado HTML.
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
   * (on*) y `style` se ignoran.
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

  /** Arma el <thead> de una tabla a partir de los encabezados. */
  function encabezado(columnas) {
    return h('thead', null, h('tr', null, columnas.map(function (c) {
      return typeof c === 'string' ? h('th', { text: c }) : h('th', { class: c.class, text: c.text });
    })));
  }

  /** Fila de tabla vacía con un mensaje (ocupa todas las columnas). */
  function filaVacia(mensaje, columnas) {
    return h('tbody', null, h('tr', null, h('td', { class: 'empty', colspan: columnas, text: mensaje })));
  }

  /** <select> con las opciones indicadas y la actual marcada. */
  function selector(props, opciones, actual) {
    return h('select', props, opciones.map(function (valor) {
      var opcion = h('option', { value: valor, text: valor });
      if (valor === actual) opcion.selected = true;
      return opcion;
    }));
  }

  function api(url, opciones) {
    return fetch(API + url, opciones).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function postJSON(url, cuerpo) {
    return api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function putJSON(url, cuerpo) {
    return api(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  function patchJSON(url, cuerpo) {
    return api(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {}),
    });
  }

  /** Muestra un mensaje (que puede incluir texto del servidor) como texto. */
  function feedback(el, mensaje, ok) {
    el.className = 'form-feedback ' + (ok ? 'is-ok' : 'is-error');
    el.textContent = mensaje;
  }

  /* ------------------------------------------------------------------ login */
  function iniciarSesion(evento) {
    evento.preventDefault();
    var caja = $('#login-feedback');
    caja.className = 'form-feedback';

    postJSON('/auth/login', {
      username: $('#login-usuario').value,
      password: $('#login-password').value,
    }).then(function (resp) {
      if (!resp.ok) {
        // El mensaje del servidor se pinta como texto, nunca como HTML.
        feedback(caja, 'No pudimos iniciar sesión: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      usuario = resp.data.usuario;
      mostrarPanel();
    });
  }

  function cerrarSesion() {
    postJSON('/auth/logout', {}).then(function () {
      usuario = null;
      $('#vista-login').hidden = false;
      $('#vista-panel').hidden = true;
      reemplazar($('#admin-user'), null);
    });
  }

  function mostrarPanel() {
    $('#vista-login').hidden = true;
    $('#vista-panel').hidden = false;
    reemplazar($('#admin-user'), [
      'Sesión de ',
      h('strong', { text: usuario.nombre }),
      ' · rol: ',
      h('strong', { text: usuario.rol }),
    ]);
    $('#panel-bienvenida').textContent = 'Hola, ' + usuario.nombre;
    cargarTodo();
  }

  function cargarTodo() {
    cargarResumen();
    cargarPedidos();
    cargarProductos();
    cargarReportes();
    cargarUsuarios();
  }

  /* ---------------------------------------------------------------- resumen */
  /** Pinta una grilla de KPIs ({ label, value }) como texto. */
  function renderKpis(contenedor, kpis) {
    reemplazar(contenedor, kpis.map(function (k) {
      return h('div', { class: 'kpi' }, [
        h('div', { class: 'kpi-label', text: k.label }),
        h('div', { class: 'kpi-value', text: k.value }),
      ]);
    }));
  }

  function cargarResumen() {
    api('/reportes/facturacion').then(function (f) {
      api('/reportes/mas-vendido').then(function (m) {
        api('/reportes/cantidad-vendida').then(function (c) {
          var mas = m.data.producto;
          var kpis = [
            { label: 'Facturación total', value: money(f.data.facturado) },
            { label: 'Pedidos registrados', value: f.data.pedidos },
            {
              label: 'Producto más vendido',
              value: mas ? mas.nombre : '—',
            },
            {
              label: 'Unidades por tipo',
              value: Object.keys(c.data.cantidadVendida || {})
                .map(function (k) { return k + ': ' + c.data.cantidadVendida[k]; })
                .join(' · ') || '—',
            },
          ];

          renderKpis($('#kpis'), kpis);
        });
      });
    });
  }

  /* --------------------------------------------------------------- pedidos */
  /** Devuelve los nodos (thead + tbody) de la tabla de pedidos. */
  function tablaPedidos(filas, conAcciones) {
    var columnas = ['#', 'Mesa', 'Cliente', 'Estado', { class: 'num', text: 'Total' }, 'Fecha'];
    if (conAcciones) columnas.push('Acciones');

    if (!filas || filas.length === 0) return [filaVacia('No hay pedidos.', columnas.length)];

    var cuerpo = h('tbody', null, filas.map(function (p) {
      var celdas = [
        h('td', { text: p.id }),
        h('td', { text: p.mesa }),
        h('td', { text: p.cliente }),
        h('td', null, h('span', { class: 'badge badge-' + p.estado, text: p.estado })),
        h('td', { class: 'num', text: money(p.total) }),
        h('td', { text: new Date(p.creado_en).toLocaleString('es-AR') }),
      ];
      if (conAcciones) {
        celdas.push(h('td', null, selector(
          { 'data-pedido': p.id, class: 'sel-estado' }, ESTADOS_PEDIDO, p.estado
        )));
      }
      return h('tr', null, celdas);
    }));

    return [encabezado(columnas), cuerpo];
  }

  function cargarPedidos() {
    api('/pedidos').then(function (resp) {
      var pedidos = resp.data.pedidos || [];
      reemplazar($('#tabla-pedidos'), tablaPedidos(pedidos, true));
      reemplazar($('#tabla-ultimos'), tablaPedidos(pedidos.slice(0, 5), false));
    });
  }

  function cambiarEstado(evento) {
    var select = evento.target.closest('.sel-estado');
    if (!select) return;
    var id = select.getAttribute('data-pedido');
    patchJSON('/pedidos/' + encodeURIComponent(id) + '/estado', { estado: select.value }).then(function (resp) {
      if (!resp.ok) {
        alert('No se pudo cambiar el estado: ' + (resp.data.error || 'error'));
      }
      cargarPedidos();
    });
  }

  /* ------------------------------------------------------------- productos */
  function cargarProductos() {
    api('/productos').then(function (resp) {
      var productos = resp.data.productos || [];
      productosCache = {};

      var cuerpo = h('tbody', null, productos.map(function (p) {
        productosCache[p.id] = p;
        return h('tr', null, [
          h('td', { text: p.id }),
          h('td', { text: p.nombre }),
          h('td', { text: p.tipo }),
          h('td', { text: p.variedad || '—' }),
          h('td', { class: 'num', text: money(p.precio) }),
          h('td', null, h('button', { class: 'link-danger', 'data-borrar': p.id, text: 'Borrar' })),
        ]);
      }));

      reemplazar($('#tabla-productos'), [
        encabezado(['#', 'Nombre', 'Tipo', 'Origen', { class: 'num', text: 'Precio' }, 'Acciones']),
        cuerpo,
      ]);
    });
  }

  function guardarProducto(evento) {
    evento.preventDefault();
    var caja = $('#producto-feedback');
    var id = $('#producto-id').value;

    var cuerpo = {
      nombre: $('#p-nombre').value,
      tipo: $('#p-tipo').value,
      variedad: $('#p-variedad').value || null,
      tamano: $('#p-tamano').value || null,
      gramos: $('#p-gramos').value ? Number($('#p-gramos').value) : null,
      precio_base: Number($('#p-precio-base').value || 0),
      precio_por_gramo: Number($('#p-precio-gramo').value || 0),
      descripcion: $('#p-descripcion').value,
    };

    var peticion = id
      ? putJSON('/admin/productos/' + encodeURIComponent(id), cuerpo)
      : postJSON('/admin/productos', cuerpo);

    peticion.then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'No se pudo guardar: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      feedback(caja, 'Producto guardado correctamente.', true);
      $('#form-producto').reset();
      $('#producto-id').value = '';
      cargarProductos();
    });
  }

  function borrarProducto(evento) {
    var btn = evento.target.closest('[data-borrar]');
    if (!btn) return;
    var id = btn.getAttribute('data-borrar');
    if (!confirm('¿Borrar el producto #' + id + '?')) return;

    api('/admin/productos/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (resp) {
      if (!resp.ok) alert('No se pudo borrar: ' + (resp.data.error || 'error'));
      cargarProductos();
    });
  }

  function limpiarFormularioProducto() {
    $('#form-producto').reset();
    $('#producto-id').value = '';
  }

  /* ---------------------------------------------------------------- upload */
  function subirArchivo(evento) {
    evento.preventDefault();
    var caja = $('#upload-feedback');
    var input = $('#archivo-subida');
    if (!input.files || !input.files[0]) {
      feedback(caja, 'Elegí un archivo primero.', false);
      return;
    }

    var archivo = input.files[0];
    var lector = new FileReader();

    lector.onload = function () {
      var base64 = String(lector.result).split(',')[1] || '';
      postJSON('/admin/subir-archivo', {
        nombre: archivo.name,
        contenidoBase64: base64,
      }).then(function (resp) {
        if (!resp.ok) {
          feedback(caja, 'No se pudo subir: ' + (resp.data.error || 'error desconocido'), false);
          return;
        }
        feedback(caja, 'Archivo subido a ' + resp.data.url, true);
      });
    };

    lector.readAsDataURL(archivo);
  }

  /* -------------------------------------------------------------- reportes */
  function cargarReportes() {
    api('/reportes/facturacion').then(function (f) {
      api('/reportes/ticket-promedio').then(function (t) {
        api('/reportes/mas-vendido').then(function (m) {
          var mas = m.data.producto;
          var kpis = [
            { label: 'Facturación', value: money(f.data.facturado) },
            { label: 'Pedidos', value: f.data.pedidos },
            { label: 'Ticket promedio', value: money(t.data.promedio) },
            { label: 'Más vendido', value: mas ? mas.nombre + ' (' + mas.unidades + ')' : '—' },
          ];
          renderKpis($('#kpis-reportes'), kpis);
        });
      });
    });
  }

  function consultarVentas() {
    var caja = $('#reporte-feedback');
    var variedad = $('#reporte-variedad').value;

    api('/reportes/ventas-por-variedad?variedad=' + encodeURIComponent(variedad)).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'Error: ' + (resp.data.error || 'desconocido'), false);
        reemplazar($('#tabla-ventas'), null);
        return;
      }
      var ventas = resp.data.ventas || [];
      var cuerpo = h('tbody', null, ventas.map(function (v) {
        return h('tr', null, [
          h('td', { text: v.variedad }),
          h('td', { text: v.nombre }),
          h('td', { class: 'num', text: v.unidades }),
          h('td', { class: 'num', text: money(v.total) }),
        ]);
      }));
      reemplazar($('#tabla-ventas'), [
        encabezado(['Origen', 'Producto', { class: 'num', text: 'Unidades' }, { class: 'num', text: 'Total' }]),
        cuerpo,
      ]);
      feedback(caja, 'Consulta realizada.', true);
    });
  }

  /* -------------------------------------------------------------- usuarios */
  function cargarUsuarios() {
    api('/admin/usuarios').then(function (resp) {
      var usuarios = resp.data.usuarios || [];
      var cuerpo = h('tbody', null, usuarios.map(function (u) {
        return h('tr', null, [
          h('td', { text: u.id }),
          h('td', { text: u.username }),
          h('td', { text: u.nombre }),
          h('td', null, h('span', { class: 'badge' + (u.rol === 'admin' ? ' badge-admin' : ''), text: u.rol })),
          h('td', null, selector({ 'data-usuario': u.id, class: 'sel-rol' }, ROLES, u.rol)),
        ]);
      }));
      reemplazar($('#tabla-usuarios'), [
        encabezado(['#', 'Usuario', 'Nombre', 'Rol', 'Acciones']),
        cuerpo,
      ]);
    });
  }

  function cambiarRol(evento) {
    var select = evento.target.closest('.sel-rol');
    if (!select) return;
    var id = select.getAttribute('data-usuario');

    putJSON('/admin/usuarios/' + encodeURIComponent(id), { rol: select.value }).then(function (resp) {
      if (!resp.ok) alert('No se pudo actualizar: ' + (resp.data.error || 'error'));
      cargarUsuarios();
    });
  }

  function cambiarPassword(evento) {
    evento.preventDefault();
    var caja = $('#password-feedback');
    postJSON('/admin/cambiar-contrasena', { nueva: $('#nueva-password').value }).then(function (resp) {
      if (!resp.ok) {
        feedback(caja, 'No se pudo cambiar: ' + (resp.data.error || 'error desconocido'), false);
        return;
      }
      feedback(caja, 'Contraseña actualizada.', true);
      $('#nueva-password').value = '';
    });
  }

  /* ----------------------------------------------------------- herramientas */
  function probarConexion(evento) {
    evento.preventDefault();
    var salida = $('#salida-conexion');
    salida.textContent = 'Probando…';

    postJSON('/admin/probar-conexion', { host: $('#conexion-host').value }).then(function (resp) {
      if (!resp.ok) {
        salida.textContent = 'Error: ' + (resp.data.error || 'desconocido');
        return;
      }
      salida.textContent =
        '$ ' + resp.data.comando + '\n\n' +
        (resp.data.salida || '') +
        (resp.data.error ? '\n[stderr]\n' + resp.data.error : '');
    });
  }

  function verDiagnostico() {
    var salida = $('#salida-diagnostico');
    salida.textContent = 'Cargando…';
    api('/_diagnostico').then(function (resp) {
      salida.textContent = JSON.stringify(resp.data, null, 2);
    });
  }

  /* ------------------------------------------------------------------ tabs */
  /** Activa una pestaña del panel. Sólo acepta los nombres de la lista blanca. */
  function mostrarVista(vista) {
    if (VISTAS_PERMITIDAS.indexOf(vista) === -1) return;
    $$('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.getAttribute('data-vista') === vista);
    });
    $$('.tab-panel').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-panel') === vista);
    });
  }

  function activarTab(evento) {
    var tab = evento.target.closest('.tab');
    if (!tab) return;
    mostrarVista(tab.getAttribute('data-vista'));
  }

  /* ------------------------------------------------------------------ init */
  function init() {
    // El parámetro ?vista= de la URL es entrada no confiable: sólo se usa
    // para elegir una pestaña de la lista blanca y nunca se pinta en la página.
    var params = new URLSearchParams(window.location.search);
    var objetivo = params.get('vista');
    if (objetivo) mostrarVista(objetivo);

    $('#form-login').addEventListener('submit', iniciarSesion);
    $('#btn-logout').addEventListener('click', cerrarSesion);
    $('#btn-refrescar').addEventListener('click', cargarTodo);
    $('#tabs').addEventListener('click', activarTab);
    $('#tabla-pedidos').addEventListener('change', cambiarEstado);
    $('#tabla-productos').addEventListener('click', borrarProducto);
    $('#form-producto').addEventListener('submit', guardarProducto);
    $('#btn-limpiar-producto').addEventListener('click', limpiarFormularioProducto);
    $('#form-upload').addEventListener('submit', subirArchivo);
    $('#form-password').addEventListener('submit', cambiarPassword);
    $('#btn-reporte-variedad').addEventListener('click', consultarVentas);
    $('#tabla-usuarios').addEventListener('change', cambiarRol);
    $('#form-conexion').addEventListener('submit', probarConexion);
    $('#btn-diagnostico').addEventListener('click', verDiagnostico);

    // ¿Ya hay sesión?
    api('/auth/yo').then(function (resp) {
      if (resp.ok) {
        usuario = resp.data.usuario;
        mostrarPanel();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
