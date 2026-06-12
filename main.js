const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs   = require('fs')
const XLSX = require('xlsx')

let win
let sesionActual = null

// ── EAN-13 ────────────────────────────────────────
function calcularDigitoEAN13(doce) {
  let suma = 0
  for (let i = 0; i < 12; i++) {
    suma += parseInt(doce[i]) * (i % 2 === 0 ? 1 : 3)
  }
  const resto = suma % 10
  return resto === 0 ? 0 : 10 - resto
}

function generarEAN13(productoId, varianteId) {
  const pPart  = String(productoId).padStart(5, '0').slice(-5)
  const vPart  = String(varianteId).padStart(5, '0').slice(-5)
  const doce   = '10' + pPart + vPart   // 2 + 5 + 5 = 12 digitos
  const digito = calcularDigitoEAN13(doce)
  return doce + digito                  // 13 digitos
}

// ── EXCEL ─────────────────────────────────────────
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
    const ws = XLSX.utils.json_to_sheet(ventas.map(v => ({
      ID: v.id, Fecha: v.fecha, Vendedor: v.vendedor || '',
      Cliente: v.cliente || 'Sin cliente',
      'Abono aplicado': v.abono_aplicado || 0,
      'Total cobrado': v.total, Estado: v.estado
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Ventas')
    XLSX.writeFile(wb, path.join(getRutaExcel(), 'ventas.xlsx'))
  } catch (err) { console.error('Error Excel ventas:', err) }
}

function actualizarExcelInventario(db) {
  try {
    const variantes = db.prepare(`
      SELECT p.nombre, p.categoria, p.colegio, p.genero,
             v.talla, v.precio, v.cantidad, v.stock_minimo, v.codigo_barras
      FROM producto_variantes v
      JOIN productos p ON v.producto_id = p.id
      ORDER BY p.nombre, v.talla
    `).all()
    const ws = XLSX.utils.json_to_sheet(variantes.map(v => ({
      Nombre: v.nombre, Categoria: v.categoria, Colegio: v.colegio,
      Genero: v.genero, Talla: v.talla, Precio: v.precio,
      Cantidad: v.cantidad, 'Stock minimo': v.stock_minimo,
      'Codigo de barras': v.codigo_barras
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
    XLSX.writeFile(wb, path.join(getRutaExcel(), 'inventario.xlsx'))
  } catch (err) { console.error('Error Excel inventario:', err) }
}

function actualizarExcelMovimientos(db) {
  try {
    const movimientos = db.prepare(`
      SELECT m.id, m.fecha, m.tipo,
             p.nombre as producto, v.talla,
             m.cantidad, u.nombre as usuario, m.nota
      FROM movimientos m
      LEFT JOIN producto_variantes v ON m.variante_id = v.id
      LEFT JOIN productos p ON v.producto_id = p.id
      LEFT JOIN usuarios u ON m.usuario_id = u.id
      ORDER BY m.fecha DESC
    `).all()
    const ws = XLSX.utils.json_to_sheet(movimientos.map(m => ({
      ID: m.id, Fecha: m.fecha, Tipo: m.tipo,
      Producto: m.producto, Talla: m.talla,
      Cantidad: m.cantidad, Usuario: m.usuario, Nota: m.nota || ''
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Movimientos')
    XLSX.writeFile(wb, path.join(getRutaExcel(), 'movimientos.xlsx'))
  } catch (err) { console.error('Error Excel movimientos:', err) }
}

function actualizarExcelEgresos(db) {
  try {
    const egresos = db.prepare(`
      SELECT e.id, e.fecha, e.categoria, e.descripcion, e.monto, u.nombre as usuario
      FROM egresos e LEFT JOIN usuarios u ON e.usuario_id = u.id
      ORDER BY e.fecha DESC
    `).all()
    const ws = XLSX.utils.json_to_sheet(egresos.map(e => ({
      ID: e.id, Fecha: e.fecha, Categoria: e.categoria,
      Descripcion: e.descripcion || '', Monto: e.monto, Usuario: e.usuario
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Egresos')
    XLSX.writeFile(wb, path.join(getRutaExcel(), 'egresos.xlsx'))
  } catch (err) { console.error('Error Excel egresos:', err) }
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    title: 'Casacas - Inventario',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })

  win.loadFile('splash.html')

  setTimeout(() => {
    win.loadFile('login.html')
  }, 2800)

  const db = require('./database.js')

  // ── FIX: CORREGIR VARIANTES CON CODIGO 'TEMP' ────
  try {
    const variantes_temp = db.prepare(
      "SELECT id, producto_id FROM producto_variantes WHERE codigo_barras = 'TEMP'"
    ).all()
    if (variantes_temp.length > 0) {
      const updateCodigo = db.prepare('UPDATE producto_variantes SET codigo_barras = ? WHERE id = ?')
      for (const v of variantes_temp) {
        const codigo = generarEAN13(v.producto_id, v.id)
        updateCodigo.run(codigo, v.id)
      }
      console.log(`Codigos TEMP corregidos: ${variantes_temp.length}`)
    }
  } catch (err) {
    console.error('Error corrigiendo codigos TEMP:', err)
  }

  // ── FIX: CORREGIR VARIANTES CON CODIGO QUE CONTIENE NaN ──
  try {
    const variantes_nan = db.prepare(
      "SELECT id, producto_id FROM producto_variantes WHERE codigo_barras LIKE '%NaN%'"
    ).all()
    if (variantes_nan.length > 0) {
      const updateCodigo = db.prepare('UPDATE producto_variantes SET codigo_barras = ? WHERE id = ?')
      for (const v of variantes_nan) {
        const codigo = generarEAN13(v.producto_id, v.id)
        updateCodigo.run(codigo, v.id)
      }
      console.log(`Codigos NaN corregidos: ${variantes_nan.length}`)
    }
  } catch (err) {
    console.error('Error corrigiendo codigos NaN:', err)
  }
  // ─────────────────────────────────────────────────

  function hacerBackup() {
    try {
      const origen   = path.join(app.getPath('userData'), 'casacas.db')
      const carpeta  = path.join(app.getPath('documents'), 'Casacas', 'backups')
      if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true })

      const fecha   = new Date().toISOString().slice(0, 10)
      const destino = path.join(carpeta, `casacas_backup_${fecha}.db`)

      if (!fs.existsSync(destino)) {
        fs.copyFileSync(origen, destino)
        console.log('Backup creado:', destino)
      }

      const archivos = fs.readdirSync(carpeta)
      archivos.forEach(archivo => {
        const rutaArchivo = path.join(carpeta, archivo)
        const stats       = fs.statSync(rutaArchivo)
        const diasDiff    = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24)
        if (diasDiff > 30) fs.unlinkSync(rutaArchivo)
      })
    } catch (err) {
      console.error('Error en backup:', err)
    }
  }

  hacerBackup()

  // ── SESION ────────────────────────────────────────
  ipcMain.handle('guardar-sesion', (e, d) => { sesionActual = d; return true })
  ipcMain.handle('obtener-sesion', () => sesionActual)
  ipcMain.handle('cerrar-sesion', () => { sesionActual = null; return true })

  // ── NAVEGACION ────────────────────────────────────
  ipcMain.on('navegar', (e, pagina) => win.loadFile(pagina))

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
    db.prepare('INSERT INTO usuarios (nombre, usuario, contrasena, rol) VALUES (@nombre, @usuario, @contrasena, @rol)').run(u)
    return { ok: true }
  })
  ipcMain.handle('editar-usuario', (e, u) => {
    db.prepare('UPDATE usuarios SET nombre=@nombre, usuario=@usuario, contrasena=@contrasena, rol=@rol WHERE id=@id').run(u)
    return { ok: true }
  })
  ipcMain.handle('eliminar-usuario', (e, id) => {
    db.prepare('DELETE FROM usuarios WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── CONFIGURACION ─────────────────────────────────
  ipcMain.handle('obtener-categorias-producto', () => db.prepare('SELECT * FROM categorias_producto ORDER BY orden, nombre').all())
  ipcMain.handle('agregar-categoria-producto', (e, nombre) => {
    const existe = db.prepare('SELECT id FROM categorias_producto WHERE nombre = ?').get(nombre)
    if (existe) return { error: 'Ya existe esa categoria' }
    db.prepare('INSERT INTO categorias_producto (nombre) VALUES (?)').run(nombre)
    return { ok: true }
  })
  ipcMain.handle('editar-categoria-producto', (e, { id, nombre }) => {
    db.prepare('UPDATE categorias_producto SET nombre = ? WHERE id = ?').run(nombre, id)
    return { ok: true }
  })
  ipcMain.handle('eliminar-categoria-producto', (e, id) => {
    db.prepare('DELETE FROM categorias_producto WHERE id = ?').run(id)
    return { ok: true }
  })

  ipcMain.handle('obtener-colegios', () => db.prepare('SELECT * FROM colegios ORDER BY orden, nombre').all())
  ipcMain.handle('agregar-colegio', (e, nombre) => {
    const existe = db.prepare('SELECT id FROM colegios WHERE nombre = ?').get(nombre)
    if (existe) return { error: 'Ya existe ese colegio' }
    db.prepare('INSERT INTO colegios (nombre) VALUES (?)').run(nombre)
    return { ok: true }
  })
  ipcMain.handle('editar-colegio', (e, { id, nombre }) => {
    db.prepare('UPDATE colegios SET nombre = ? WHERE id = ?').run(nombre, id)
    return { ok: true }
  })
  ipcMain.handle('eliminar-colegio', (e, id) => {
    db.prepare('DELETE FROM colegios WHERE id = ?').run(id)
    return { ok: true }
  })

  ipcMain.handle('obtener-categorias-egreso', () => db.prepare('SELECT * FROM categorias_egreso ORDER BY orden, nombre').all())
  ipcMain.handle('agregar-categoria-egreso', (e, nombre) => {
    const existe = db.prepare('SELECT id FROM categorias_egreso WHERE nombre = ?').get(nombre)
    if (existe) return { error: 'Ya existe esa categoria' }
    db.prepare('INSERT INTO categorias_egreso (nombre) VALUES (?)').run(nombre)
    return { ok: true }
  })
  ipcMain.handle('editar-categoria-egreso', (e, { id, nombre }) => {
    db.prepare('UPDATE categorias_egreso SET nombre = ? WHERE id = ?').run(nombre, id)
    return { ok: true }
  })
  ipcMain.handle('eliminar-categoria-egreso', (e, id) => {
    db.prepare('DELETE FROM categorias_egreso WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── PRODUCTOS ─────────────────────────────────────
  ipcMain.handle('obtener-productos', () => {
    const productos = db.prepare('SELECT * FROM productos ORDER BY nombre').all()
    return productos.map(p => ({
      ...p,
      variantes: db.prepare('SELECT * FROM producto_variantes WHERE producto_id = ? ORDER BY talla').all(p.id)
    }))
  })

  ipcMain.handle('agregar-producto', (e, { producto, variantes }) => {
    const result = db.prepare(`
      INSERT INTO productos (nombre, categoria, colegio, genero)
      VALUES (@nombre, @categoria, @colegio, @genero)
    `).run(producto)

    const productoId = result.lastInsertRowid
    const insertVar  = db.prepare(`
      INSERT INTO producto_variantes (producto_id, talla, precio, cantidad, stock_minimo, codigo_barras)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const v of variantes) {
      const varResult  = insertVar.run(productoId, v.talla, v.precio, v.cantidad, v.stock_minimo, 'TEMP')
      const varianteId = varResult.lastInsertRowid
      const codigo     = generarEAN13(productoId, varianteId)
      db.prepare('UPDATE producto_variantes SET codigo_barras = ? WHERE id = ?').run(codigo, varianteId)
    }

    actualizarExcelInventario(db)
    return { ok: true, productoId }
  })

  ipcMain.handle('editar-producto', (e, { producto }) => {
    db.prepare(`
      UPDATE productos SET nombre=@nombre, categoria=@categoria, colegio=@colegio, genero=@genero WHERE id=@id
    `).run(producto)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  ipcMain.handle('agregar-variante', (e, { productoId, variante }) => {
    const result = db.prepare(`
      INSERT INTO producto_variantes (producto_id, talla, precio, cantidad, stock_minimo, codigo_barras)
      VALUES (?, ?, ?, ?, ?, 'TEMP')
    `).run(productoId, variante.talla, variante.precio, variante.cantidad, variante.stock_minimo)
    const varianteId = result.lastInsertRowid
    const codigo     = generarEAN13(productoId, varianteId)
    db.prepare('UPDATE producto_variantes SET codigo_barras = ? WHERE id = ?').run(codigo, varianteId)
    actualizarExcelInventario(db)
    return { ok: true, varianteId, codigo }
  })

  ipcMain.handle('editar-variante', (e, variante) => {
    db.prepare(`
      UPDATE producto_variantes SET talla=@talla, precio=@precio, cantidad=@cantidad, stock_minimo=@stock_minimo WHERE id=@id
    `).run(variante)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  ipcMain.handle('eliminar-variante', (e, id) => {
    db.prepare('DELETE FROM apartado_items WHERE variante_id = ?').run(id)
    db.prepare('DELETE FROM venta_items    WHERE variante_id = ?').run(id)
    db.prepare('DELETE FROM movimientos    WHERE variante_id = ?').run(id)
    db.prepare('DELETE FROM producto_variantes WHERE id = ?').run(id)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  ipcMain.handle('eliminar-producto', (e, id) => {
    const variantes = db.prepare('SELECT id FROM producto_variantes WHERE producto_id = ?').all(id)
    const ids = variantes.map(v => v.id)

    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',')
      db.prepare(`DELETE FROM apartado_items WHERE variante_id IN (${placeholders})`).run(...ids)
      db.prepare(`DELETE FROM venta_items    WHERE variante_id IN (${placeholders})`).run(...ids)
      db.prepare(`DELETE FROM movimientos    WHERE variante_id IN (${placeholders})`).run(...ids)
    }

    db.prepare('DELETE FROM producto_variantes WHERE producto_id = ?').run(id)
    db.prepare('DELETE FROM productos WHERE id = ?').run(id)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  ipcMain.handle('buscar-por-codigo', (e, codigo) => {
    return db.prepare(`
      SELECT v.*, p.nombre, p.categoria, p.colegio, p.genero
      FROM producto_variantes v
      JOIN productos p ON v.producto_id = p.id
      WHERE v.codigo_barras = ?
    `).get(codigo) || null
  })

  // ── APARTADOS ─────────────────────────────────────
  ipcMain.handle('obtener-apartados', () => {
    return db.prepare(`
      SELECT a.*, u.nombre as vendedor FROM apartados a
      LEFT JOIN usuarios u ON a.usuario_id = u.id
      ORDER BY a.fecha_creacion DESC
    `).all()
  })

  ipcMain.handle('obtener-apartado-detalle', (e, apartadoId) => {
    return db.prepare(`
      SELECT ai.*, v.talla, v.codigo_barras,
             p.nombre as producto, p.colegio, p.categoria
      FROM apartado_items ai
      JOIN producto_variantes v ON ai.variante_id = v.id
      JOIN productos p ON v.producto_id = p.id
      WHERE ai.apartado_id = ?
    `).all(apartadoId)
  })

  ipcMain.handle('agregar-apartado', (e, { apartado, items }) => {
    const total  = items.reduce((acc, i) => acc + (i.cantidad * i.precio_unitario), 0)
    const result = db.prepare(`
      INSERT INTO apartados (nombre, telefono, colegio, notas, abono, total, estado, usuario_id)
      VALUES (@nombre, @telefono, @colegio, @notas, @abono, @total, 'pendiente', @usuario_id)
    `).run({ ...apartado, total })

    const insertItem = db.prepare(`
      INSERT INTO apartado_items (apartado_id, variante_id, cantidad, precio_unitario)
      VALUES (?, ?, ?, ?)
    `)
    for (const item of items) {
      insertItem.run(result.lastInsertRowid, item.variante_id, item.cantidad, item.precio_unitario)
    }
    return { ok: true }
  })

  ipcMain.handle('editar-apartado', (e, apartado) => {
    db.prepare(`
      UPDATE apartados SET nombre=@nombre, telefono=@telefono, colegio=@colegio, notas=@notas, abono=@abono WHERE id=@id
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

    const insertItem = db.prepare(`INSERT INTO venta_items (venta_id, variante_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)`)
    const descontar  = db.prepare(`UPDATE producto_variantes SET cantidad = cantidad - ? WHERE id = ?`)
    const insertMov  = db.prepare(`INSERT INTO movimientos (variante_id, usuario_id, tipo, cantidad, nota) VALUES (?, ?, 'venta', ?, 'Venta registrada')`)

    for (const item of items) {
      insertItem.run(venta.lastInsertRowid, item.variante_id, item.cantidad, item.precio_unitario)
      descontar.run(item.cantidad, item.variante_id)
      insertMov.run(item.variante_id, usuarioId, item.cantidad)
    }

    if (apartadoId) {
      db.prepare("UPDATE apartados SET estado='entregado', fecha_entrega=datetime('now','localtime') WHERE id=?").run(apartadoId)
    }

    actualizarExcelVentas(db)
    actualizarExcelInventario(db)
    actualizarExcelMovimientos(db)

    const alertasStockBajo = db.prepare(`
      SELECT p.nombre, v.talla, v.cantidad, v.stock_minimo, p.colegio
      FROM producto_variantes v JOIN productos p ON v.producto_id = p.id
      WHERE v.cantidad > 0 AND v.cantidad <= v.stock_minimo
    `).all()

    const alertasAgotados = db.prepare(`
      SELECT p.nombre, v.talla, p.colegio
      FROM producto_variantes v JOIN productos p ON v.producto_id = p.id
      WHERE v.cantidad <= 0
    `).all()

    return { ok: true, ventaId: venta.lastInsertRowid, alertasStockBajo, alertasAgotados }
  })

  ipcMain.handle('obtener-ventas', () => {
    return db.prepare(`
      SELECT v.id, v.total, v.fecha, v.estado, v.abono_aplicado,
             u.nombre as vendedor, a.nombre as cliente
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN apartados a ON v.apartado_id = a.id
      ORDER BY v.fecha DESC
    `).all()
  })

  ipcMain.handle('obtener-venta-detalle', (e, ventaId) => {
    return db.prepare(`
      SELECT vi.cantidad, vi.precio_unitario,
             p.nombre as producto, pv.talla, p.colegio, p.categoria
      FROM venta_items vi
      JOIN producto_variantes pv ON vi.variante_id = pv.id
      JOIN productos p ON pv.producto_id = p.id
      WHERE vi.venta_id = ?
    `).all(ventaId)
  })

  // ── MOVIMIENTOS ───────────────────────────────────
  ipcMain.handle('obtener-movimientos', () => {
    return db.prepare(`
      SELECT m.id, m.tipo, m.cantidad, m.nota, m.fecha,
             p.nombre as producto, pv.talla,
             u.nombre as usuario
      FROM movimientos m
      LEFT JOIN producto_variantes pv ON m.variante_id = pv.id
      LEFT JOIN productos p ON pv.producto_id = p.id
      LEFT JOIN usuarios u ON m.usuario_id = u.id
      ORDER BY m.fecha DESC
    `).all()
  })

  ipcMain.handle('agregar-movimiento', (e, m) => {
    db.prepare(`
      INSERT INTO movimientos (variante_id, usuario_id, tipo, cantidad, nota)
      VALUES (@variante_id, @usuario_id, @tipo, @cantidad, @nota)
    `).run(m)
    if (m.tipo === 'entrada') {
      db.prepare('UPDATE producto_variantes SET cantidad = cantidad + ? WHERE id = ?').run(m.cantidad, m.variante_id)
    }
    actualizarExcelMovimientos(db)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  // ── EGRESOS ───────────────────────────────────────
  ipcMain.handle('obtener-egresos', () => {
    return db.prepare(`
      SELECT e.*, u.nombre as usuario FROM egresos e
      LEFT JOIN usuarios u ON e.usuario_id = u.id
      ORDER BY e.fecha DESC
    `).all()
  })
  ipcMain.handle('agregar-egreso', (e, egreso) => {
    db.prepare('INSERT INTO egresos (categoria, descripcion, monto, usuario_id) VALUES (@categoria, @descripcion, @monto, @usuario_id)').run(egreso)
    actualizarExcelEgresos(db)
    return { ok: true }
  })
  ipcMain.handle('editar-egreso', (e, egreso) => {
    db.prepare('UPDATE egresos SET categoria=@categoria, descripcion=@descripcion, monto=@monto WHERE id=@id').run(egreso)
    actualizarExcelEgresos(db)
    return { ok: true }
  })
  ipcMain.handle('eliminar-egreso', (e, id) => {
    db.prepare('DELETE FROM egresos WHERE id = ?').run(id)
    actualizarExcelEgresos(db)
    return { ok: true }
  })

  // ── METAS ─────────────────────────────────────────
  ipcMain.handle('obtener-metas', () => db.prepare('SELECT * FROM metas').all())
  ipcMain.handle('guardar-meta', (e, { tipo, monto }) => {
    db.prepare("UPDATE metas SET monto = ?, fecha_actualizacion = datetime('now','localtime') WHERE tipo = ?").run(monto, tipo)
    return { ok: true }
  })

  // ── ESTADISTICAS ──────────────────────────────────
  ipcMain.handle('obtener-estadisticas', () => {
    const ventasPorDia = db.prepare(`
      SELECT date(fecha) as dia, COUNT(*) as cantidad, SUM(total) as total
      FROM ventas WHERE date(fecha) >= date('now', '-7 days', 'localtime')
      GROUP BY date(fecha) ORDER BY dia ASC
    `).all()

    const ventasPorSemana = db.prepare(`
      SELECT strftime('%W', fecha) as semana, strftime('%Y', fecha) as anio,
             COUNT(*) as cantidad, SUM(total) as total
      FROM ventas WHERE date(fecha) >= date('now', '-28 days', 'localtime')
      GROUP BY strftime('%W', fecha) ORDER BY anio ASC, semana ASC
    `).all()

    const ventasPorMes = db.prepare(`
      SELECT strftime('%m', fecha) as mes, strftime('%Y', fecha) as anio,
             COUNT(*) as cantidad, SUM(total) as total
      FROM ventas WHERE date(fecha) >= date('now', '-180 days', 'localtime')
      GROUP BY strftime('%Y-%m', fecha) ORDER BY anio ASC, mes ASC
    `).all()

    const topProductos = db.prepare(`
      SELECT p.nombre, pv.talla, p.categoria, SUM(vi.cantidad) as total_vendido
      FROM venta_items vi
      JOIN producto_variantes pv ON vi.variante_id = pv.id
      JOIN productos p ON pv.producto_id = p.id
      GROUP BY pv.id ORDER BY total_vendido DESC LIMIT 5
    `).all()

    const porColegio = db.prepare(`
      SELECT a.colegio, COUNT(*) as ventas, SUM(v.total) as total
      FROM ventas v JOIN apartados a ON v.apartado_id = a.id
      WHERE a.colegio IS NOT NULL AND a.colegio != ''
      GROUP BY a.colegio ORDER BY ventas DESC
    `).all()

    const apartadosVencidos = db.prepare(`
      SELECT id, nombre, telefono, colegio, total, abono,
             CAST((julianday('now','localtime') - julianday(fecha_creacion)) AS INTEGER) as dias
      FROM apartados WHERE estado = 'pendiente' ORDER BY dias DESC
    `).all()

    const resumenMeses = db.prepare(`
      SELECT strftime('%Y-%m', fecha) as periodo,
             strftime('%m', fecha) as mes, strftime('%Y', fecha) as anio,
             SUM(total) as ingresos, COUNT(*) as ventas
      FROM ventas WHERE date(fecha) >= date('now', '-180 days', 'localtime')
      GROUP BY strftime('%Y-%m', fecha) ORDER BY periodo ASC
    `).all()

    const egresosPorMes = db.prepare(`
      SELECT strftime('%Y-%m', fecha) as periodo, SUM(monto) as egresos
      FROM egresos WHERE date(fecha) >= date('now', '-180 days', 'localtime')
      GROUP BY strftime('%Y-%m', fecha)
    `).all()

    return {
      ventasPorDia, ventasPorSemana, ventasPorMes,
      topProductos, porColegio, apartadosVencidos,
      resumenMeses, egresosPorMes
    }
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
      SELECT p.nombre, p.colegio, pv.talla, p.categoria,
             SUM(vi.cantidad) as total_vendido,
             SUM(vi.cantidad * vi.precio_unitario) as total_pesos
      FROM venta_items vi
      JOIN producto_variantes pv ON vi.variante_id = pv.id
      JOIN productos p ON pv.producto_id = p.id
      JOIN ventas v ON vi.venta_id = v.id
      WHERE date(v.fecha) BETWEEN date(?) AND date(?)
      GROUP BY pv.id ORDER BY total_vendido DESC LIMIT 10
    `).all(fechaInicio, fechaFin)

    const entradas = db.prepare(`
      SELECT COALESCE(SUM(cantidad), 0) as total FROM movimientos
      WHERE tipo = 'entrada' AND date(fecha) BETWEEN date(?) AND date(?)
    `).get(fechaInicio, fechaFin)

    const salidas = db.prepare(`
      SELECT COALESCE(SUM(cantidad), 0) as total FROM movimientos
      WHERE tipo = 'venta' AND date(fecha) BETWEEN date(?) AND date(?)
    `).get(fechaInicio, fechaFin)

    const porDia = db.prepare(`
      SELECT date(v.fecha) as dia, COUNT(*) as cantidad_ventas, SUM(v.total) as total
      FROM ventas v WHERE date(v.fecha) BETWEEN date(?) AND date(?)
      GROUP BY date(v.fecha) ORDER BY dia DESC
    `).all(fechaInicio, fechaFin)

    const totalEgresos = db.prepare(`
      SELECT COALESCE(SUM(monto), 0) as total FROM egresos
      WHERE date(fecha) BETWEEN date(?) AND date(?)
    `).get(fechaInicio, fechaFin)

    return {
      ventas, totalVendido, cantidadVentas: ventas.length,
      masVendidos, entradas: entradas.total || 0,
      salidas: salidas.total || 0, porDia,
      totalEgresos: totalEgresos.total || 0
    }
  })

  ipcMain.handle('obtener-ruta-excel', () => getRutaExcel())

  // ── IMPRESORA TERMICA ─────────────────────────────
  ipcMain.handle('imprimir-recibo', async (e, { items, subtotal, abonoAplicado, totalCobrar, dado, vueltos, vendedor, cliente }) => {
    try {
      const fs = require('fs')

      const ESC    = '\x1B'
      const INIT   = ESC + '@'
      const BOLD   = ESC + 'E\x01'
      const UNBOLD = ESC + 'E\x00'
      const CENTER = ESC + 'a\x01'
      const LEFT   = ESC + 'a\x00'
      const RIGHT  = ESC + 'a\x02'
      const CUT    = '\x1D' + 'V\x41\x00'
      const LF     = '\n'

      const linea   = '--------------------------------'
      const fecha   = new Date().toLocaleString('es-CO')
      const ventaId = Date.now().toString().slice(-6)

      const limpiar = (str) => str
        .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
        .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u')
        .replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I')
        .replace(/Ó/g, 'O').replace(/Ú/g, 'U').replace(/ñ/g, 'n')
        .replace(/Ñ/g, 'N')

      let recibo = INIT
      recibo += CENTER + BOLD + 'Casacas Colegial' + LF + UNBOLD
      recibo += CENTER + 'San Gil - Calle 11 No. 10-66' + LF
      recibo += CENTER + 'Piso 2, Local 201' + LF
      recibo += CENTER + 'Tel: 313 849 5210' + LF
      recibo += CENTER + 'colegialcasacas@gmail.com' + LF
      recibo += CENTER + linea + LF
      recibo += CENTER + 'Factura No. ' + ventaId + LF
      recibo += CENTER + fecha + LF
      recibo += CENTER + 'Vendedor: ' + vendedor + LF
      if (cliente) recibo += CENTER + 'Cliente: ' + cliente + LF
      recibo += LEFT + linea + LF

      items.forEach(i => {
        const sub = (i.precio_unitario * i.cantidad).toLocaleString('es-CO')
        recibo += LEFT + i.nombre + ' T' + i.talla + LF
        recibo += LEFT + '  ' + i.cantidad + ' x $' + parseFloat(i.precio_unitario).toLocaleString('es-CO') + ' = $' + sub + LF
      })

      recibo += LEFT + linea + LF
      recibo += RIGHT + 'Subtotal:  $' + subtotal.toLocaleString('es-CO') + LF
      if (abonoAplicado > 0) {
        recibo += RIGHT + 'Abono:    -$' + abonoAplicado.toLocaleString('es-CO') + LF
      }
      recibo += RIGHT + BOLD + 'TOTAL:     $' + totalCobrar.toLocaleString('es-CO') + LF + UNBOLD
      recibo += RIGHT + 'Recibido:  $' + dado.toLocaleString('es-CO') + LF
      recibo += RIGHT + 'Vueltos:   $' + vueltos.toLocaleString('es-CO') + LF
      recibo += LEFT + linea + LF
      recibo += CENTER + 'Gracias por su compra!' + LF
      recibo += CENTER + 'Vuelve pronto :)' + LF
      recibo += LF + LF + LF
      recibo += CUT

      fs.writeFileSync('/dev/usb/lp0', Buffer.from(limpiar(recibo), 'latin1'))
      return { ok: true }
    } catch (err) {
      console.error('Error impresora:', err)
      return { error: err.message }
    }
  })
  // ─────────────────────────────────────────────────

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      win = new BrowserWindow({ width: 1200, height: 800, webPreferences: { nodeIntegration: true, contextIsolation: false } })
      win.loadFile('login.html')
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})