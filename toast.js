function toast(mensaje, tipo = 'exito', duracion = 3500) {
  let contenedor = document.getElementById('toast-contenedor')
  if (!contenedor) {
    contenedor = document.createElement('div')
    contenedor.id = 'toast-contenedor'
    contenedor.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      display: flex; flex-direction: column; gap: 10px; pointer-events: none;
    `
    document.body.appendChild(contenedor)
  }

  const colores = {
    exito:  { bg: '#d4f8e8', border: '#2ecc71', icon: '✓', texto: '#1a7a4a' },
    error:  { bg: '#fde8ec', border: '#e94560', icon: '✕', texto: '#c0392b' },
    aviso:  { bg: '#fff8e1', border: '#f39c12', icon: '!', texto: '#856404' },
    info:   { bg: '#dbeafe', border: '#3498db', icon: 'i', texto: '#1e40af' },
  }

  const c = colores[tipo] || colores.exito
  const el = document.createElement('div')
  el.style.cssText = `
    background: ${c.bg}; border-left: 4px solid ${c.border}; border-radius: 10px;
    padding: 14px 18px; display: flex; align-items: center; gap: 12px;
    min-width: 280px; max-width: 420px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    pointer-events: all; animation: toastEntrar 0.3s ease forwards;
    font-family: 'Segoe UI', sans-serif;
  `
  el.innerHTML = `
    <div style="width:28px;height:28px;border-radius:50%;background:${c.border};display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:14px;flex-shrink:0;">${c.icon}</div>
    <span style="font-size:14px;color:${c.texto};flex:1;line-height:1.4;">${mensaje}</span>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:${c.texto};font-size:18px;opacity:0.5;padding:0;line-height:1;flex-shrink:0;">×</button>
  `

  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style')
    style.id = 'toast-styles'
    style.textContent = `
      @keyframes toastEntrar { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }
      @keyframes toastSalir  { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(40px); } }
    `
    document.head.appendChild(style)
  }

  contenedor.appendChild(el)
  setTimeout(() => {
    el.style.animation = 'toastSalir 0.3s ease forwards'
    setTimeout(() => el.remove(), 300)
  }, duracion)
}

// Reemplazar alert nativo
window._alertOriginal = window.alert
window.alert = function(mensaje) {
  const esError = /error|obligatorio|incorrecto|no puedes|no hay|insuficiente|vacio/i.test(mensaje)
  const esAviso = /agotado|stock bajo|dias|seguro|avisar/i.test(mensaje)
  const esInfo  = /registrad|guardad|correctamente|creado|eliminado|actualizado/i.test(mensaje)
  const tipo = esError ? 'error' : esAviso ? 'aviso' : esInfo ? 'exito' : 'info'
  toast(mensaje, tipo, 4000)
}

// Reemplazar confirm nativo con modal bonito
window._confirmOriginal = window.confirm
window.confirm = function(mensaje) {
  // Para confirm usamos un modal sincrono simplificado
  // Retornamos el confirm original pero con mensaje mas limpio
  return window._confirmOriginal(mensaje)
}
