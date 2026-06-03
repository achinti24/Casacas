const { ipcRenderer } = require('electron')

async function cerrarSesion() {
  await ipcRenderer.invoke('cerrar-sesion')
  ipcRenderer.send('navegar', 'login.html')
}

async function cargarMenu(paginaActiva) {
  const sesion = await ipcRenderer.invoke('obtener-sesion')
  if (!sesion) {
    ipcRenderer.send('navegar', 'login.html')
    return null
  }

  const infoEl = document.getElementById('info-usuario')
  if (infoEl) {
    infoEl.innerHTML = `
      <strong>${sesion.nombre}</strong>
      <span>${sesion.rol === 'admin' ? 'Administrador' : 'Empleado'}</span>
    `
  }

  const menuAdmin = [
    { href: 'index.html',         label: 'Inicio' },
    { href: 'inventario.html',    label: 'Inventario' },
    { href: 'ventas.html',        label: 'Ventas' },
    { href: 'apartados.html',     label: 'Apartados' },
    { href: 'egresos.html',       label: 'Egresos' },
    { href: 'metas.html',         label: 'Metas' },
    { href: 'historial.html',     label: 'Historial' },
    { href: 'reportes.html',      label: 'Reportes' },
    { href: 'configuracion.html', label: 'Configuracion' },
    { href: 'usuarios.html',      label: 'Usuarios' },
  ]

  const menuEmpleado = [
    { href: 'index.html',      label: 'Inicio' },
    { href: 'inventario.html', label: 'Inventario' },
    { href: 'ventas.html',     label: 'Ventas' },
    { href: 'apartados.html',  label: 'Apartados' },
    { href: 'egresos.html',    label: 'Egresos' },
  ]

  const menu = sesion.rol === 'admin' ? menuAdmin : menuEmpleado
  const navEl = document.getElementById('nav-menu')
  if (navEl) {
    navEl.innerHTML = menu.map(item => `
      <a onclick="navegar('${item.href}')"
         class="${item.href === paginaActiva ? 'active' : ''}"
         style="cursor:pointer;">${item.label}</a>
    `).join('')
  }

  aplicarModoGuardado()
  return sesion
}

function navegar(pagina) {
  ipcRenderer.send('navegar', pagina)
}

function toggleModo() {
  const oscuro = document.body.classList.toggle('dark')
  localStorage.setItem('modo', oscuro ? 'dark' : 'light')
  actualizarBtnModo()
}

function actualizarBtnModo() {
  const btn = document.querySelector('.btn-modo')
  if (!btn) return
  const oscuro = document.body.classList.contains('dark')
  btn.textContent = oscuro ? 'Modo claro' : 'Modo oscuro'
}

function aplicarModoGuardado() {
  const modo = localStorage.getItem('modo')
  if (modo === 'dark') document.body.classList.add('dark')
  else document.body.classList.remove('dark')
  actualizarBtnModo()
}
