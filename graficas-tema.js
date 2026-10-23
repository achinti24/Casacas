// Apariencia comun de las graficas (Chart.js): la fuente de la app, ejes
// discretos y leyendas de punto. Solo presentacion; cada grafica pone sus datos.
(function aplicarTemaGraficas() {
  if (typeof Chart === 'undefined') return
  const oscuro = localStorage.getItem('modo') === 'dark'
  const tinta  = oscuro ? '#a3a3a3' : '#64625e'
  const reja   = oscuro ? '#262626' : '#ecebe8'

  Chart.defaults.font.family = "'Geist', 'Segoe UI', system-ui, sans-serif"
  Chart.defaults.font.size   = 12
  Chart.defaults.color       = tinta
  Chart.defaults.borderColor = reja
  Chart.defaults.scale.grid.color = reja
  Chart.defaults.scale.border.display = false
  Chart.defaults.plugins.legend.labels.usePointStyle = true
  Chart.defaults.plugins.legend.labels.pointStyle   = 'circle'
  Chart.defaults.plugins.legend.labels.boxWidth     = 8
  Chart.defaults.plugins.legend.labels.boxHeight    = 8
  Chart.defaults.plugins.legend.labels.padding      = 14
  Chart.defaults.plugins.tooltip.backgroundColor = oscuro ? '#f2f2f2' : '#141414'
  Chart.defaults.plugins.tooltip.titleColor      = oscuro ? '#0a0a0a' : '#ffffff'
  Chart.defaults.plugins.tooltip.bodyColor       = oscuro ? '#0a0a0a' : '#ffffff'
  Chart.defaults.plugins.tooltip.cornerRadius    = 6
  Chart.defaults.plugins.tooltip.displayColors   = false
  Chart.defaults.elements.line.borderWidth = 2
  Chart.defaults.elements.line.tension     = 0
  Chart.defaults.elements.point.radius     = 0
  Chart.defaults.elements.point.hoverRadius = 4
  Chart.defaults.elements.arc.borderColor  = oscuro ? '#191919' : '#ffffff'
  Chart.overrides.doughnut.cutout = '74%'
  Chart.overrides.doughnut.aspectRatio = 2
  Chart.overrides.doughnut.plugins.legend.position = 'right'
})()
