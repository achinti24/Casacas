const { ipcRenderer } = require('electron')

// ── ICONOS SVG (stroke, estilo lineal minimalista) ──
const ICONOS = {
  inicio: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
  inventario: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
  insumos: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7" y2="7"></line></svg>`,
  codigos: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
  ventas: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`,
  apartados: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`,
  egresos: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`,
  metas: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>`,
  historial: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
  reportes: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`,
  configuracion: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
  usuarios: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`
}

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

  const inicial = (sesion.nombre || '?').trim().charAt(0).toUpperCase()
  document.getElementById('info-usuario').innerHTML = `
    <div class="usuario-card">
      <div class="usuario-avatar">${inicial}</div>
      <div class="usuario-datos">
        <strong>${sesion.nombre}</strong>
        <span>${sesion.rol === 'admin' ? 'Administrador' : 'Empleado'}</span>
      </div>
    </div>
  `

  // ── LOGO con imagen ──
  const logoEl = document.querySelector('.sidebar-logo')
  if (logoEl) {
    logoEl.innerHTML = `
      <img src="assets/casacas.jpg"
           alt="Casacas Colegial"
           style="width:36px; height:36px; border-radius:9px; object-fit:cover; flex-shrink:0; box-shadow:0 4px 10px rgba(0,0,0,0.3);">
      <div>
        <h2 style="font-size:15px; font-weight:800; color:#ffffff; letter-spacing:-0.3px; line-height:1.1;">Casacas Colegial</h2>
        <small style="display:block; color:#4b4f5e; font-size:9px; letter-spacing:1.5px; text-transform:uppercase; margin-top:1px;">San Gil</small>
      </div>
    `
  }

  const menuAdmin = [
    { href: 'index.html',         label: 'Inicio',        icon: 'inicio' },
    { href: 'inventario.html',    label: 'Inventario',    icon: 'inventario' },
    { href: 'insumos.html',       label: 'Insumos',       icon: 'insumos' },
    { href: 'codigos.html',       label: 'Codigos',       icon: 'codigos' },
    { href: 'ventas.html',        label: 'Ventas',        icon: 'ventas' },
    { href: 'apartados.html',     label: 'Apartados',     icon: 'apartados' },
    { href: 'egresos.html',       label: 'Egresos',       icon: 'egresos' },
    { href: 'metas.html',         label: 'Metas',         icon: 'metas' },
    { href: 'historial.html',     label: 'Historial',     icon: 'historial' },
    { href: 'reportes.html',      label: 'Reportes',      icon: 'reportes' },
    { href: 'configuracion.html', label: 'Configuracion', icon: 'configuracion' },
    { href: 'usuarios.html',      label: 'Usuarios',      icon: 'usuarios' },
  ]

  const menuEmpleado = [
    { href: 'index.html',      label: 'Inicio',     icon: 'inicio' },
    { href: 'inventario.html', label: 'Inventario', icon: 'inventario' },
    { href: 'codigos.html',    label: 'Codigos',    icon: 'codigos' },
    { href: 'ventas.html',     label: 'Ventas',     icon: 'ventas' },
    { href: 'apartados.html',  label: 'Apartados',  icon: 'apartados' },
  ]

  const menu = sesion.rol === 'admin' ? menuAdmin : menuEmpleado

  document.getElementById('nav-menu').innerHTML = menu.map(item => `
    <a onclick="navegar('${item.href}')"
       class="${item.href === paginaActiva ? 'active' : ''}"
       style="cursor:pointer;">
      <span class="nav-icon">${ICONOS[item.icon] || ''}</span>
      <span class="nav-label">${item.label}</span>
    </a>
  `).join('')

  // ── BREADCRUMB AUTOMATICO ──
  const itemActivo  = menu.find(item => item.href === paginaActiva)
  const breadcrumbEl = document.getElementById('breadcrumb')
  if (breadcrumbEl && itemActivo) {
    breadcrumbEl.innerHTML = `
      <span class="breadcrumb-root">Casacas</span>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-actual">${itemActivo.label}</span>
    `
  }

  return sesion
}

function navegar(pagina) {
  ipcRenderer.send('navegar', pagina)
}

function toggleModo() {
  const oscuro = document.body.classList.toggle('dark')
  localStorage.setItem('modo', oscuro ? 'dark' : 'light')
  actualizarBotonModo(oscuro)
}

function actualizarBotonModo(oscuro) {
  const btns = document.querySelectorAll('.btn-modo')
  btns.forEach(btn => {
    btn.innerHTML = oscuro
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg><span>Modo claro</span>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg><span>Modo oscuro</span>`
  })
}

function aplicarModoGuardado() {
  const modo   = localStorage.getItem('modo')
  const oscuro = modo === 'dark'
  if (oscuro) document.body.classList.add('dark')
  actualizarBotonModo(oscuro)
}

document.addEventListener('DOMContentLoaded', aplicarModoGuardado)