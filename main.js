const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs   = require('fs')
const XLSX = require('xlsx')

let win
let sesionActual = null

// Carpeta donde se guardan los Excel
function getRutaExcel() {
  const carpeta = path.join(app.getPath('documents'), 'Casacas', 'reportes')
  if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true })
  return carpeta
}

function actualizarExcelVentas(db) {
  try {
    const ventas = db.prepare(`
      SELECT v.id, v.fecha, u.nombre as vendedor, a.nombre as cliente,
             v.abono_aplicado, v.total, v.estado
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN apartados a ON v.apartado_id = a.id
      ORDER BY v.fecha DESC
    `).all()

    const datos = ventas.map(v => ({
      ID:            v.id,
      Fecha:         v.fecha,
      Vendedor:      v.vendedor || '',
      Cliente:       v.cliente  || 'Sin cliente',
      'Abono aplicado': v.abono_aplicado || 0,
      'Total cobrado':  v.total,
      Estado:        v.estado
    }))

    const ws = XLSX.utils.json_to_sheet(datos)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ventas')
    XLSX.writeFile(wb, path.join(getRutaExcel(), 'ventas.xlsx'))
  } catch (err) {
    console.error('Error actualizando Excel ventas:', err)
  }
}

function actualizarExcelInventario(db) {
  try {
    const productos = db.prepare('SELECT * FROM productos ORDER BY nombre').all()

    const datos = productos.map(p => ({
      ID:          p.id,
      Nombre:      p.nombre,
      Categoria:   p.categoria,
      Colegio:     p.colegio,
      Genero:      p.genero,
      Talla:       p.talla,
      Cantidad:    p.cantidad,
      Precio:      p.precio,
      'Stock minimo': p.stock_minimo,
      'Fecha creacion': p.fecha_creacion
    }))

    const ws = XLSX.utils.json_to_sheet(datos)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
    XLSX.writeFile(wb, path.join(getRutaExcel(), 'inventario.xlsx'))
  } catch (err) {
    console.error('Error actualizando Excel inventario:', err)
  }
}

function actualizarExcelMovimientos(db) {
  try {
    const movimientos = db.prepare(`
      SELECT m.id, m.fecha, m.tipo, p.nombre as producto,
             m.cantidad, u.nombre as usuario, m.nota
      FROM movimientos m
      LEFT JOIN productos p ON m.producto_id = p.id
      LEFT JOIN usuarios u ON m.usuario_id = u.id
      ORDER BY m.fecha DESC
    `).all()

    const datos = movimientos.map(m => ({
      ID:       m.id,
      Fecha:    m.fecha,
      Tipo:     m.tipo,
      Producto: m.producto,
      Cantidad: m.cantidad,
      Usuario:  m.usuario,
      Nota:     m.nota || ''
    }))

    const ws = XLSX.utils.json_to_sheet(datos)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Movimientos')
    XLSX.writeFile(wb, path.join(getRutaExcel(), 'movimientos.xlsx'))
  } catch (err) {
    console.error('Error actualizando Excel movimientos:', err)
  }
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Casacas - Inventario',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  win.loadFile('login.html')

  const db = require('./database.js')

  // ── SESION ────────────────────────────────────────
  ipcMain.handle('guardar-sesion', (e, datos) => {
    sesionActual = datos
    return true
  })

  ipcMain.handle('obtener-sesion', () => {
    return sesionActual
  })

  ipcMain.handle('cerrar-sesion', () => {
    sesionActual = null
    return true
  })

  // ── NAVEGACION ────────────────────────────────────
  ipcMain.on('navegar', (e, pagina) => {
    win.loadFile(pagina)
  })

  // ── AUTH ──────────────────────────────────────────
  ipcMain.handle('login', (e, { usuario, contrasena }) => {
    return db.prepare('SELECT id, nombre, rol FROM usuarios WHERE usuario = ? AND contrasena = ?').get(usuario, contrasena) || null
  })

  // ── USUARIOS ──────────────────────────────────────
  ipcMain.handle('obtener-usuarios', () => {
    return db.prepare('SELECT id, nombre, usuario, rol, fecha_creacion FROM usuarios ORDER BY nombre').all()
  })

  ipcMain.handle('agregar-usuario', (e, u) => {
    const existe = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(u.usuario)
    if (existe) return { error: 'El nombre de usuario ya existe' }
    db.prepare(`
      INSERT INTO usuarios (nombre, usuario, contrasena, rol)
      VALUES (@nombre, @usuario, @contrasena, @rol)
    `).run(u)
    return { ok: true }
  })

  ipcMain.handle('editar-usuario', (e, u) => {
    db.prepare(`
      UPDATE usuarios SET nombre=@nombre, usuario=@usuario, contrasena=@contrasena, rol=@rol WHERE id=@id
    `).run(u)
    return { ok: true }
  })

  ipcMain.handle('eliminar-usuario', (e, id) => {
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── PRODUCTOS ─────────────────────────────────────
  ipcMain.handle('obtener-productos', () => {
    return db.prepare('SELECT * FROM productos ORDER BY nombre').all()
  })

  ipcMain.handle('agregar-producto', (e, p) => {
    db.prepare(`
      INSERT INTO productos (nombre, categoria, colegio, genero, talla, cantidad, precio, stock_minimo)
      VALUES (@nombre, @categoria, @colegio, @genero, @talla, @cantidad, @precio, @stock_minimo)
    `).run(p)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  ipcMain.handle('editar-producto', (e, p) => {
    db.prepare(`
      UPDATE productos SET nombre=@nombre, categoria=@categoria, colegio=@colegio,
      genero=@genero, talla=@talla, cantidad=@cantidad, precio=@precio, stock_minimo=@stock_minimo
      WHERE id=@id
    `).run(p)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  ipcMain.handle('eliminar-producto', (e, id) => {
    db.prepare('DELETE FROM productos WHERE id = ?').run(id)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  // ── APARTADOS ─────────────────────────────────────
  ipcMain.handle('obtener-apartados', () => {
    return db.prepare(`
      SELECT a.*, u.nombre as vendedor
      FROM apartados a
      LEFT JOIN usuarios u ON a.usuario_id = u.id
      ORDER BY a.fecha_creacion DESC
    `).all()
  })

  ipcMain.handle('obtener-apartado-detalle', (e, apartadoId) => {
    return db.prepare(`
      SELECT ai.*, p.nombre as producto, p.talla, p.colegio, p.categoria
      FROM apartado_items ai
      JOIN productos p ON ai.producto_id = p.id
      WHERE ai.apartado_id = ?
    `).all(apartadoId)
  })

  ipcMain.handle('agregar-apartado', (e, { apartado, items }) => {
    const total = items.reduce((acc, i) => acc + (i.cantidad * i.precio_unitario), 0)
    const result = db.prepare(`
      INSERT INTO apartados (nombre, telefono, colegio, notas, abono, total, estado, usuario_id)
      VALUES (@nombre, @telefono, @colegio, @notas, @abono, @total, 'pendiente', @usuario_id)
    `).run({ ...apartado, total })

    const insertItem = db.prepare(`
      INSERT INTO apartado_items (apartado_id, producto_id, cantidad, precio_unitario)
      VALUES (?, ?, ?, ?)
    `)
    for (const item of items) {
      insertItem.run(result.lastInsertRowid, item.producto_id, item.cantidad, item.precio_unitario)
    }
    return { ok: true, apartadoId: result.lastInsertRowid }
  })

  ipcMain.handle('editar-apartado', (e, apartado) => {
    db.prepare(`
      UPDATE apartados SET nombre=@nombre, telefono=@telefono, colegio=@colegio,
      notas=@notas, abono=@abono WHERE id=@id
    `).run(apartado)
    return { ok: true }
  })

  ipcMain.handle('eliminar-apartado', (e, id) => {
    db.prepare('DELETE FROM apartado_items WHERE apartado_id = ?').run(id)
    db.prepare('DELETE FROM apartados WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── VENTAS ────────────────────────────────────────
  ipcMain.handle('registrar-venta', (e, { usuarioId, apartadoId, items, abonoAplicado }) => {
    const totalItems = items.reduce((acc, i) => acc + (i.cantidad * i.precio_unitario), 0)
    const total      = Math.max(0, totalItems - (abonoAplicado || 0))

    const venta = db.prepare(`
      INSERT INTO ventas (usuario_id, apartado_id, total, abono_aplicado, estado)
      VALUES (?, ?, ?, ?, 'entregado')
    `).run(usuarioId, apartadoId || null, total, abonoAplicado || 0)

    const insertItem = db.prepare(`
      INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unitario)
      VALUES (?, ?, ?, ?)
    `)
    const descontar = db.prepare(`
      UPDATE productos SET cantidad = cantidad - ? WHERE id = ?
    `)
    const insertMov = db.prepare(`
      INSERT INTO movimientos (producto_id, usuario_id, tipo, cantidad, nota)
      VALUES (?, ?, 'venta', ?, 'Venta registrada')
    `)

    for (const item of items) {
      insertItem.run(venta.lastInsertRowid, item.producto_id, item.cantidad, item.precio_unitario)
      descontar.run(item.cantidad, item.producto_id)
      insertMov.run(item.producto_id, usuarioId, item.cantidad)
    }

    if (apartadoId) {
      db.prepare(`
        UPDATE apartados SET estado='entregado', fecha_entrega=datetime('now','localtime') WHERE id=?
      `).run(apartadoId)
    }

    actualizarExcelVentas(db)
    actualizarExcelInventario(db)
    actualizarExcelMovimientos(db)

    // Verificar stock bajo despues de la venta
    const productosStockBajo = db.prepare(`
      SELECT nombre, cantidad, stock_minimo, talla, colegio
      FROM productos
      WHERE cantidad > 0 AND cantidad <= stock_minimo
    `).all()

    const productosAgotados = db.prepare(`
      SELECT nombre, talla, colegio
      FROM productos
      WHERE cantidad <= 0
    `).all()

    return {
      ok: true,
      ventaId: venta.lastInsertRowid,
      alertasStockBajo: productosStockBajo,
      alertasAgotados:  productosAgotados
    }
  })

  ipcMain.handle('obtener-ventas', () => {
    return db.prepare(`
      SELECT v.id, v.total, v.fecha, v.estado, v.abono_aplicado,
             u.nombre as vendedor,
             a.nombre as cliente
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN apartados a ON v.apartado_id = a.id
      ORDER BY v.fecha DESC
    `).all()
  })

  ipcMain.handle('obtener-venta-detalle', (e, ventaId) => {
    return db.prepare(`
      SELECT vi.cantidad, vi.precio_unitario,
             p.nombre as producto, p.talla, p.colegio, p.categoria
      FROM venta_items vi
      JOIN productos p ON vi.producto_id = p.id
      WHERE vi.venta_id = ?
    `).all(ventaId)
  })

  // ── MOVIMIENTOS ───────────────────────────────────
  ipcMain.handle('obtener-movimientos', () => {
    return db.prepare(`
      SELECT m.id, m.tipo, m.cantidad, m.nota, m.fecha,
             p.nombre as producto,
             u.nombre as usuario
      FROM movimientos m
      LEFT JOIN productos p ON m.producto_id = p.id
      LEFT JOIN usuarios u ON m.usuario_id = u.id
      ORDER BY m.fecha DESC
    `).all()
  })

  ipcMain.handle('agregar-movimiento', (e, m) => {
    db.prepare(`
      INSERT INTO movimientos (producto_id, usuario_id, tipo, cantidad, nota)
      VALUES (@producto_id, @usuario_id, @tipo, @cantidad, @nota)
    `).run(m)
    if (m.tipo === 'entrada') {
      db.prepare('UPDATE productos SET cantidad = cantidad + ? WHERE id = ?').run(m.cantidad, m.producto_id)
    }
    actualizarExcelMovimientos(db)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  // ── REPORTES ──────────────────────────────────────
  ipcMain.handle('obtener-reporte', (e, { fechaInicio, fechaFin }) => {
    const ventas = db.prepare(`
      SELECT v.id, v.total, v.fecha, v.estado, v.abono_aplicado,
             u.nombre as vendedor, a.nombre as cliente
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN apartados a ON v.apartado_id = a.id
      WHERE date(v.fecha) BETWEEN date(?) AND date(?)
      ORDER BY v.fecha DESC
    `).all(fechaInicio, fechaFin)

    const totalVendido = ventas.reduce((acc, v) => acc + v.total, 0)

    const masVendidos = db.prepare(`
      SELECT p.nombre, p.colegio, p.talla, p.categoria,
             SUM(vi.cantidad) as total_vendido,
             SUM(vi.cantidad * vi.precio_unitario) as total_pesos
      FROM venta_items vi
      JOIN productos p ON vi.producto_id = p.id
      JOIN ventas v ON vi.venta_id = v.id
      WHERE date(v.fecha) BETWEEN date(?) AND date(?)
      GROUP BY p.id
      ORDER BY total_vendido DESC
      LIMIT 10
    `).all(fechaInicio, fechaFin)

    const entradas = db.prepare(`
      SELECT COALESCE(SUM(cantidad), 0) as total
      FROM movimientos
      WHERE tipo = 'entrada' AND date(fecha) BETWEEN date(?) AND date(?)
    `).get(fechaInicio, fechaFin)

    const salidas = db.prepare(`
      SELECT COALESCE(SUM(cantidad), 0) as total
      FROM movimientos
      WHERE tipo = 'venta' AND date(fecha) BETWEEN date(?) AND date(?)
    `).get(fechaInicio, fechaFin)

    const porDia = db.prepare(`
      SELECT date(v.fecha) as dia, COUNT(*) as cantidad_ventas,
             SUM(v.total) as total
      FROM ventas v
      WHERE date(v.fecha) BETWEEN date(?) AND date(?)
      GROUP BY date(v.fecha)
      ORDER BY dia DESC
    `).all(fechaInicio, fechaFin)

    return {
      ventas,
      totalVendido,
      cantidadVentas: ventas.length,
      masVendidos,
      entradas: entradas.total || 0,
      salidas:  salidas.total  || 0,
      porDia
    }
  })

  ipcMain.handle('obtener-ruta-excel', () => {
    return getRutaExcel()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
      })
      win.loadFile('login.html')
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})