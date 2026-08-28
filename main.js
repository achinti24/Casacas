const { app, BrowserWindow, ipcMain, shell, Menu, globalShortcut } = require('electron')
const path = require('path')
const fs   = require('fs')
const XLSX = require('xlsx')
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer')

let win
let sesionActual = null

// ── ORDEN INTELIGENTE DE TALLAS ───────────────────
// Soporta tallas simples ("6", "M"), combinadas ("6-8", "XS-S") y
// tallas de pantalon que saltan a numeros grandes ("28", "30"...).
// Regla: los numeros siempre van antes que las letras, y dentro de
// cada grupo se ordena ascendente/segun la secuencia de letras.
const ORDEN_LETRAS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL']

function claveTalla(talla) {
  const texto   = String(talla || '').trim()
  const primera = texto.split(/[-\/]/)[0].trim() || texto
  const numero  = parseFloat(primera.replace(',', '.'))

  if (!isNaN(numero)) return [0, numero, primera]

  const idx = ORDEN_LETRAS.indexOf(primera.toUpperCase())
  if (idx !== -1) return [1, idx, primera]

  return [2, 0, primera] // formato desconocido, al final, alfabetico
}

function compararTallas(a, b) {
  const [ba, na, pa] = claveTalla(a)
  const [bb, nb, pb] = claveTalla(b)
  if (ba !== bb) return ba - bb
  if (na !== nb) return na - nb
  return pa.localeCompare(pb)
}

// ── CONFIGURACION IMPRESORA ───────────────────────
function getRutaConfig() {
  return path.join(app.getPath('userData'), 'config.json')
}

function leerConfig() {
  try {
    const ruta = getRutaConfig()
    if (fs.existsSync(ruta)) {
      return JSON.parse(fs.readFileSync(ruta, 'utf8'))
    }
  } catch (err) {
    console.error('Error leyendo config:', err)
  }
  return {
    impresora: process.platform === 'win32' ? 'printer:POS-80' : '/dev/usb/lp0'
  }
}

function guardarConfig(config) {
  try {
    fs.writeFileSync(getRutaConfig(), JSON.stringify(config, null, 2), 'utf8')
  } catch (err) {
    console.error('Error guardando config:', err)
  }
}

function crearImpresora() {
  const config = leerConfig()
  return new ThermalPrinter({
    type:                    PrinterTypes.EPSON,
    interface:               config.impresora,
    characterSet:            CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
    lineCharacter:           '-',
    width:                   32
  })
}

// ── IMPRESION DIRECTA WINDOWS ─────────────────────
async function imprimirWindowsRaw(buffer) {
  const tmp   = path.join(app.getPath('temp'), 'casacas_print.bin')
  const tmpPs = path.join(app.getPath('temp'), 'casacas_print.ps1')
  fs.writeFileSync(tmp, buffer)

  const escaped = tmp.replace(/\\/g, '\\\\')
  const ps = `
$bytes = [IO.File]::ReadAllBytes("${escaped}")
$p = "Generic / Text Only"
$h = [IntPtr]::Zero
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class WP {
  [DllImport("winspool.drv",CharSet=CharSet.Auto)] public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Auto)] public struct DI { public string n; public string o; public string t; }
  [DllImport("winspool.drv",CharSet=CharSet.Auto)] public static extern int StartDocPrinter(IntPtr h,int l,ref DI i);
  [DllImport("winspool.drv")] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv")] public static extern bool WritePrinter(IntPtr h,byte[] b,int l,out int w);
  [DllImport("winspool.drv")] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv")] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv")] public static extern bool ClosePrinter(IntPtr h);
}
'@
[WP]::OpenPrinter($p,[ref]$h,[IntPtr]::Zero)|Out-Null
$di=New-Object WP+DI; $di.n="Casacas"; $di.t="RAW"
[WP]::StartDocPrinter($h,1,[ref]$di)|Out-Null
[WP]::StartPagePrinter($h)|Out-Null
$w=0; [WP]::WritePrinter($h,$bytes,$bytes.Length,[ref]$w)|Out-Null
[WP]::EndPagePrinter($h)|Out-Null; [WP]::EndDocPrinter($h)|Out-Null; [WP]::ClosePrinter($h)|Out-Null
`
  fs.writeFileSync(tmpPs, ps, 'utf8')
  try {
    const { execSync } = require('child_process')
    execSync(`powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -File "${tmpPs}"`, {
      shell:   'cmd.exe',
      timeout: 15000
    })
    return { ok: true }
  } catch (err) {
    escribirLog('Error impresion Windows: ' + err.message)
    return { error: err.message }
  }
}

function construirBufferEscpos({ items, subtotal, abonoAplicado, totalCobrar, dado, vueltos, vendedor, cliente, numeroFactura, metodoPago, montoEfectivo, montoTransferencia, nombreFactura, cedulaFactura }) {
  const ESC    = '\x1B'
  const INIT   = ESC + '@'
  const BOLD   = ESC + 'E\x01'
  const UNBOLD = ESC + 'E\x00'
  const CENTER = ESC + 'a\x01'
  const LEFT   = ESC + 'a\x00'
  const RIGHT  = ESC + 'a\x02'
  const CUT    = '\x1D' + 'V\x41\x00'
  const LF     = '\n'
  const linea  = '--------------------------------'
  const fecha  = new Date().toLocaleString('es-CO')
  const labelMetodo = metodoPago === 'transferencia' ? 'Transferencia' : metodoPago === 'mixto' ? 'Efectivo + Transferencia' : 'Efectivo'

  const limpiar = s => s
    .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i')
    .replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u')
    .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I')
    .replace(/Ó/g,'O').replace(/Ú/g,'U').replace(/ñ/g,'n').replace(/Ñ/g,'N')

  let r = INIT
  r += CENTER + BOLD + 'Casacas Colegial' + LF + UNBOLD
  r += CENTER + 'San Gil - Calle 11 No. 10-66' + LF
  r += CENTER + 'Piso 2, Local 201' + LF
  r += CENTER + 'Tel: 313 849 5210' + LF
  r += CENTER + 'colegialcasacas@gmail.com' + LF
  r += CENTER + linea + LF
  r += CENTER + 'Factura No. ' + (numeroFactura || Date.now().toString().slice(-6)) + LF
  r += CENTER + fecha + LF
  if (cliente) r += CENTER + 'Cliente: ' + cliente + LF
  if (nombreFactura) r += CENTER + 'Facturado a: ' + nombreFactura + LF
  if (cedulaFactura) r += CENTER + 'C.C./NIT: ' + cedulaFactura + LF
  r += LEFT + linea + LF
  items.forEach(i => {
    const sub = (i.precio_unitario * i.cantidad).toLocaleString('es-CO')
    r += LEFT + i.nombre + ' T' + i.talla + LF
    r += LEFT + '  ' + i.cantidad + ' x $' + parseFloat(i.precio_unitario).toLocaleString('es-CO') + ' = $' + sub + LF
  })
  r += LEFT + linea + LF
  r += RIGHT + 'Subtotal:  $' + subtotal.toLocaleString('es-CO') + LF
  if (abonoAplicado > 0) r += RIGHT + 'Abono:    -$' + abonoAplicado.toLocaleString('es-CO') + LF
  r += RIGHT + BOLD + 'TOTAL:     $' + totalCobrar.toLocaleString('es-CO') + LF + UNBOLD
  r += RIGHT + 'Pago:      ' + labelMetodo + LF
  if (metodoPago === 'mixto') {
    r += RIGHT + 'Efectivo:      $' + (montoEfectivo || 0).toLocaleString('es-CO') + LF
    r += RIGHT + 'Transferencia: $' + (montoTransferencia || 0).toLocaleString('es-CO') + LF
    r += RIGHT + 'Recibido:  $' + dado.toLocaleString('es-CO') + LF
    r += RIGHT + 'Vueltos:   $' + vueltos.toLocaleString('es-CO') + LF
  } else if (metodoPago !== 'transferencia') {
    r += RIGHT + 'Recibido:  $' + dado.toLocaleString('es-CO') + LF
    r += RIGHT + 'Vueltos:   $' + vueltos.toLocaleString('es-CO') + LF
  }
  r += LEFT + linea + LF
  r += CENTER + 'Gracias por su compra!' + LF
  r += CENTER + 'Vuelve pronto :)' + LF
  r += LF + LF + LF + CUT
  return Buffer.from(limpiar(r), 'latin1')
}

function construirBufferApartado({ nombre, telefono, colegio, notas, abono, items, total, vendedor }) {
  const ESC    = '\x1B'
  const INIT   = ESC + '@'
  const BOLD   = ESC + 'E\x01'
  const UNBOLD = ESC + 'E\x00'
  const CENTER = ESC + 'a\x01'
  const LEFT   = ESC + 'a\x00'
  const RIGHT  = ESC + 'a\x02'
  const CUT    = '\x1D' + 'V\x41\x00'
  const LF     = '\n'
  const linea  = '--------------------------------'
  const fecha  = new Date().toLocaleString('es-CO')
  const saldo  = Math.max(0, total - (abono || 0))

  const limpiar = s => s
    .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i')
    .replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u')
    .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I')
    .replace(/Ó/g,'O').replace(/Ú/g,'U').replace(/ñ/g,'n').replace(/Ñ/g,'N')

  let r = INIT
  r += CENTER + BOLD + 'Casacas Colegial' + LF + UNBOLD
  r += CENTER + 'San Gil - Calle 11 No. 10-66' + LF
  r += CENTER + 'Piso 2, Local 201' + LF
  r += CENTER + 'Tel: 313 849 5210' + LF
  r += CENTER + linea + LF
  r += CENTER + BOLD + 'COMPROBANTE DE APARTADO' + LF + UNBOLD
  r += CENTER + fecha + LF
  r += CENTER + linea + LF
  r += CENTER + 'Reclama con el nombre de:' + LF
  r += CENTER + nombre + LF
  if (telefono) r += CENTER + 'Tel: ' + telefono + LF
  if (colegio)  r += CENTER + 'Colegio: ' + colegio + LF
  r += LEFT + linea + LF
  items.forEach(i => {
    const sub = (i.precio_unitario * i.cantidad).toLocaleString('es-CO')
    r += LEFT + i.nombre + ' T' + i.talla + LF
    r += LEFT + '  ' + i.cantidad + ' x $' + parseFloat(i.precio_unitario).toLocaleString('es-CO') + ' = $' + sub + LF
  })
  r += LEFT + linea + LF
  r += RIGHT + 'Total apartado: $' + total.toLocaleString('es-CO') + LF
  r += RIGHT + 'Abono pagado:  -$' + (abono || 0).toLocaleString('es-CO') + LF
  r += RIGHT + BOLD + 'SALDO:          $' + saldo.toLocaleString('es-CO') + LF + UNBOLD
  r += LEFT + linea + LF
  if (notas) { r += LEFT + 'Notas: ' + notas + LF; r += LEFT + linea + LF }
  r += CENTER + 'Conserva este papel' + LF
  r += CENTER + 'para reclamar tu pedido' + LF
  r += LF + LF + LF + CUT
  return Buffer.from(limpiar(r), 'latin1')
}

function construirBufferCotizacion({ items, subtotal, cliente, vendedor }) {
  const ESC    = '\x1B'
  const INIT   = ESC + '@'
  const BOLD   = ESC + 'E\x01'
  const UNBOLD = ESC + 'E\x00'
  const CENTER = ESC + 'a\x01'
  const LEFT   = ESC + 'a\x00'
  const RIGHT  = ESC + 'a\x02'
  const CUT    = '\x1D' + 'V\x41\x00'
  const LF     = '\n'
  const linea  = '--------------------------------'
  const fecha  = new Date().toLocaleString('es-CO')

  const limpiar = s => s
    .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i')
    .replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u')
    .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I')
    .replace(/Ó/g,'O').replace(/Ú/g,'U').replace(/ñ/g,'n').replace(/Ñ/g,'N')

  let r = INIT
  r += CENTER + BOLD + 'Casacas Colegial' + LF + UNBOLD
  r += CENTER + 'San Gil - Calle 11 No. 10-66' + LF
  r += CENTER + 'Piso 2, Local 201' + LF
  r += CENTER + 'Tel: 313 849 5210' + LF
  r += CENTER + linea + LF
  r += CENTER + BOLD + 'COTIZACION' + LF + UNBOLD
  r += CENTER + '(no es factura de venta)' + LF
  r += CENTER + fecha + LF
  if (cliente) r += CENTER + 'Cliente: ' + cliente + LF
  r += LEFT + linea + LF
  items.forEach(i => {
    const sub = (i.precio_unitario * i.cantidad).toLocaleString('es-CO')
    r += LEFT + i.nombre + ' T' + i.talla + LF
    r += LEFT + '  ' + i.cantidad + ' x $' + parseFloat(i.precio_unitario).toLocaleString('es-CO') + ' = $' + sub + LF
  })
  r += LEFT + linea + LF
  r += RIGHT + BOLD + 'TOTAL:     $' + subtotal.toLocaleString('es-CO') + LF + UNBOLD
  r += LEFT + linea + LF
  r += CENTER + 'Precios sujetos a cambio sin previo aviso.' + LF
  r += CENTER + 'Este documento no reserva stock.' + LF
  r += LF + LF + LF + CUT
  return Buffer.from(limpiar(r), 'latin1')
}

// ── ARQUEO DE CAJA (ruta Windows) ─────────────────
function construirBufferArqueo({ fechaTexto, cantidadEfectivo, totalEfectivo, cantidadTransferencia, totalTransferencia, totalEgresos, cerradoPor, desglose }) {
  const ESC    = '\x1B'
  const INIT   = ESC + '@'
  const BOLD   = ESC + 'E\x01'
  const UNBOLD = ESC + 'E\x00'
  const CENTER = ESC + 'a\x01'
  const LEFT   = ESC + 'a\x00'
  const RIGHT  = ESC + 'a\x02'
  const CUT    = '\x1D' + 'V\x41\x00'
  const LF     = '\n'
  const linea  = '--------------------------------'
  const totalVentas    = (totalEfectivo || 0) + (totalTransferencia || 0)
  const efectivoEnCaja = (totalEfectivo || 0) - (totalEgresos || 0)

  const limpiar = s => s
    .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i')
    .replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u')
    .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I')
    .replace(/Ó/g,'O').replace(/Ú/g,'U').replace(/ñ/g,'n').replace(/Ñ/g,'N')

  let r = INIT
  r += CENTER + BOLD + 'Casacas Colegial' + LF + UNBOLD
  r += CENTER + 'San Gil - Calle 11 No. 10-66' + LF
  r += CENTER + 'Piso 2, Local 201' + LF
  r += CENTER + linea + LF
  r += CENTER + BOLD + 'ARQUEO DE CAJA' + LF + UNBOLD
  r += CENTER + fechaTexto + LF
  r += CENTER + linea + LF

  // Desglose por concepto: sin esto, un total que no cuadra contra el cajon no
  // dice de donde viene la diferencia. Aqui se ve cuanto fue venta de
  // mostrador, cuanto abono, cuanto saldo de apartado y cuanto devolucion.
  if (Array.isArray(desglose) && desglose.length > 0) {
    r += LEFT + BOLD + 'DETALLE DEL DIA' + LF + UNBOLD
    for (const d of desglose) {
      r += LEFT + d.concepto + ' (' + d.cantidad + ')' + LF
      r += RIGHT + (d.total < 0 ? '-$' : '$') + Math.abs(d.total).toLocaleString('es-CO') + LF
    }
    r += LEFT + linea + LF
  }

  // "Movimientos", no "ventas": el dia tambien incluye abonos y devoluciones.
  r += LEFT + 'En efectivo (' + cantidadEfectivo + ' movs.)' + LF
  r += RIGHT + '$' + (totalEfectivo || 0).toLocaleString('es-CO') + LF
  r += LEFT + 'Por transferencia (' + cantidadTransferencia + ' movs.)' + LF
  r += RIGHT + '$' + (totalTransferencia || 0).toLocaleString('es-CO') + LF
  r += LEFT + linea + LF
  r += RIGHT + BOLD + 'Total recibido:  $' + totalVentas.toLocaleString('es-CO') + LF + UNBOLD
  r += LEFT + linea + LF
  r += RIGHT + 'Egresos del dia: -$' + (totalEgresos || 0).toLocaleString('es-CO') + LF
  r += LEFT + linea + LF
  r += RIGHT + BOLD + 'Efectivo esperado' + LF
  r += RIGHT + 'en caja: $' + efectivoEnCaja.toLocaleString('es-CO') + LF + UNBOLD
  r += LEFT + linea + LF
  if (cerradoPor) r += CENTER + 'Cerrado por: ' + cerradoPor + LF
  r += LF
  r += CENTER + 'Firma: ________________________' + LF
  r += LF + LF + LF + CUT
  return Buffer.from(limpiar(r), 'latin1')
}

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
  const doce   = '10' + pPart + vPart
  const digito = calcularDigitoEAN13(doce)
  return doce + digito
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
             v.abono_aplicado, v.total, v.estado, v.metodo_pago
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN apartados a ON v.apartado_id = a.id
      ORDER BY v.fecha DESC
    `).all()
    const ws = XLSX.utils.json_to_sheet(ventas.map(v => ({
      ID: v.id, Fecha: v.fecha, Vendedor: v.vendedor || '',
      Cliente: v.cliente || 'Sin cliente',
      'Abono aplicado': v.abono_aplicado || 0,
      'Total cobrado': v.total,
      'Metodo pago': v.metodo_pago || 'efectivo',
      Estado: v.estado
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
             v.talla, v.precio, v.precio_costo, v.cantidad, v.stock_minimo, v.codigo_barras
      FROM producto_variantes v
      JOIN productos p ON v.producto_id = p.id
    `).all().sort((a, b) => {
      const porNombre = a.nombre.localeCompare(b.nombre)
      if (porNombre !== 0) return porNombre
      return compararTallas(a.talla, b.talla)
    })
    const ws = XLSX.utils.json_to_sheet(variantes.map(v => ({
      Nombre: v.nombre, Categoria: v.categoria, Colegio: v.colegio,
      Genero: v.genero, Talla: v.talla, Precio: v.precio,
      'Precio costo': v.precio_costo || 0,
      Cantidad: v.cantidad, 'Stock minimo': v.stock_minimo,
      'Codigo de barras': v.codigo_barras
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
    XLSX.writeFile(wb, path.join(getRutaExcel(), 'inventario.xlsx'))
  } catch (err) { console.error('Error Excel inventario:', err) }
}

// ── WORD - CODIGOS DE BARRAS ─────────────────────────────────────────
ipcMain.handle('generar-word-codigos', async (e, items) => {
  try {
    const {
      Document, Packer, Table, TableRow, TableCell, Paragraph, TextRun,
      ImageRun, WidthType, AlignmentType, VerticalAlign
    } = require('docx')

    if (!items || items.length === 0) return { error: 'No hay codigos para generar' }

    const POR_PAGINA = 10   // 2 columnas x 5 filas
    const COLUMNAS    = 2
    const FILAS       = POR_PAGINA / COLUMNAS

    function crearCelda(item) {
      if (!item) {
        return new TableCell({
          children:      [new Paragraph('')],
          verticalAlign: VerticalAlign.CENTER,
          width:         { size: 50, type: WidthType.PERCENTAGE },
          margins:       { top: 150, bottom: 150, left: 150, right: 150 }
        })
      }

      const hijos = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing:   { after: 40 },
          children:  [ new TextRun({ text: item.nombre, bold: true, size: 20 }) ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing:   { after: 60 },
          children:  [ new TextRun({ text: item.detalle, size: 16, color: '666666' }) ]
        })
      ]

      if (item.imagenBase64) {
        hijos.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing:   { after: 60 },
          children:  [ new ImageRun({
            data:           Buffer.from(item.imagenBase64, 'base64'),
            transformation: { width: 220, height: 90 }
          }) ]
        }))
      } else {
        hijos.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing:   { after: 60 },
          children:  [ new TextRun({ text: 'Codigo pendiente', italics: true, size: 16, color: '999999' }) ]
        }))
      }

      hijos.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children:  [ new TextRun({ text: `$${item.precio}`, bold: true, size: 18, color: 'E94560' }) ]
      }))

      return new TableCell({
        children:      hijos,
        verticalAlign: VerticalAlign.CENTER,
        width:         { size: 50, type: WidthType.PERCENTAGE },
        margins:       { top: 150, bottom: 150, left: 150, right: 150 }
      })
    }

    const bloques = []
    for (let i = 0; i < items.length; i += POR_PAGINA) {
      bloques.push(items.slice(i, i + POR_PAGINA))
    }

    const contenido = []
    bloques.forEach((bloque, idxBloque) => {
      if (idxBloque > 0) {
        contenido.push(new Paragraph({ children: [], pageBreakBefore: true }))
      }
      const filas = []
      for (let f = 0; f < FILAS; f++) {
        const celdas = []
        for (let c = 0; c < COLUMNAS; c++) {
          celdas.push(crearCelda(bloque[f * COLUMNAS + c]))
        }
        filas.push(new TableRow({ children: celdas }))
      }
      contenido.push(new Table({ rows: filas, width: { size: 100, type: WidthType.PERCENTAGE } }))
    })

    const doc = new Document({ sections: [{ properties: {}, children: contenido }] })
    const buffer = await Packer.toBuffer(doc)

    const carpeta = getRutaExcel()
    const fecha   = new Date().toISOString().slice(0, 10)
    const ruta    = path.join(carpeta, `codigos_barras_${fecha}.docx`)
    fs.writeFileSync(ruta, buffer)
    shell.openPath(ruta)

    return { ok: true, ruta, total: items.length, paginas: bloques.length }
  } catch (err) {
    console.error('Error generando Word de codigos:', err)
    return { error: 'Error al generar el documento Word. Verifica que el paquete "docx" este instalado (npm install docx).' }
  }
})

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

function actualizarExcelInsumos(db) {
  try {
    const insumos = db.prepare(`SELECT * FROM insumos ORDER BY categoria, nombre`).all()
    const ws = XLSX.utils.json_to_sheet(insumos.map(i => ({
      Nombre: i.nombre, Categoria: i.categoria,
      'Unidad de medida': i.unidad_medida,
      Cantidad: i.cantidad, 'Stock minimo': i.stock_minimo,
      'Costo unitario': i.costo_unitario || 0,
      'Valor total': (i.cantidad * (i.costo_unitario || 0))
    })))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Insumos')
    XLSX.writeFile(wb, path.join(getRutaExcel(), 'insumos.xlsx'))
  } catch (err) { console.error('Error Excel insumos:', err) }
}

// ── ESCRIBIR LOG DE ERRORES ───────────────────────
function escribirLog(mensaje) {
  try {
    const logPath = path.join(app.getPath('userData'), 'logs', 'main.log')
    const logDir  = path.dirname(logPath)
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
    const linea = `[${new Date().toISOString()}] ${mensaje}\n`
    fs.appendFileSync(logPath, linea, 'utf8')
  } catch (e) { /* silencioso */ }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  // El atajo Ctrl+Shift+I normalmente viene del menu por defecto de Electron.
  // Como el menu esta deshabilitado (linea de arriba), se registra a mano
  // para poder seguir abriendo las herramientas de desarrollador.
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    const ventanaActiva = BrowserWindow.getFocusedWindow()
    if (ventanaActiva) ventanaActiva.webContents.toggleDevTools()
  })

  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    title: 'Casacas - Inventario',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })

  win.loadFile('splash.html')

  setTimeout(() => {
    win.loadFile('login.html')
  }, 2800)

  // ── CARGAR BASE DE DATOS CON MANEJO DE ERROR ─────
  let db
  try {
    escribirLog('Iniciando carga de database.js...')
    db = require('./database.js')
    escribirLog('database.js cargado OK')
  } catch (err) {
    escribirLog('ERROR FATAL cargando database.js: ' + err.stack)
    // Mostrar el error en pantalla en lugar de fallar silenciosamente
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript(`
        document.body.style.cssText = 'background:#1a1a2e;color:#fff;font-family:monospace;padding:30px';
        document.body.innerHTML = '<h2 style="color:#ff6b6b">Error al iniciar Casacas</h2><pre style="background:#0d0d1a;padding:20px;border-radius:8px;overflow:auto;font-size:12px">' + ${JSON.stringify(err.stack)} + '</pre><p>Ruta de logs: ' + ${JSON.stringify(path.join(app.getPath('userData'), 'logs', 'main.log'))} + '</p>';
      `)
    })
    return
  }

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
      escribirLog(`Codigos TEMP corregidos: ${variantes_temp.length}`)
    }
  } catch (err) {
    escribirLog('Error corrigiendo codigos TEMP: ' + err.message)
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
      escribirLog(`Codigos NaN corregidos: ${variantes_nan.length}`)
    }
  } catch (err) {
    escribirLog('Error corrigiendo codigos NaN: ' + err.message)
  }

  // ── FIX: AGREGAR COLUMNA precio_costo SI NO EXISTE ──
  try {
    const columnas    = db.prepare("PRAGMA table_info(producto_variantes)").all()
    const tieneCosto  = columnas.some(c => c.name === 'precio_costo')
    if (!tieneCosto) {
      db.prepare('ALTER TABLE producto_variantes ADD COLUMN precio_costo REAL DEFAULT 0').run()
      escribirLog('Columna precio_costo agregada a producto_variantes')
    }
  } catch (err) {
    escribirLog('Error agregando columna precio_costo: ' + err.message)
  }

  // ── FIX: AGREGAR COLUMNA metodo_pago SI NO EXISTE ──
  try {
    const columnasVentas  = db.prepare("PRAGMA table_info(ventas)").all()
    const tieneMetodoPago = columnasVentas.some(c => c.name === 'metodo_pago')
    if (!tieneMetodoPago) {
      db.prepare("ALTER TABLE ventas ADD COLUMN metodo_pago TEXT DEFAULT 'efectivo'").run()
      escribirLog('Columna metodo_pago agregada a ventas')
    }
  } catch (err) {
    escribirLog('Error agregando columna metodo_pago: ' + err.message)
  }

  // ── FIX: COLUMNAS DE PAGO MIXTO Y DATOS DE FACTURACION ──
  try {
    const columnasVentas = db.prepare("PRAGMA table_info(ventas)").all()
    const nombresCols    = columnasVentas.map(c => c.name)
    const nuevasCols = [
      ['monto_efectivo',          "ALTER TABLE ventas ADD COLUMN monto_efectivo REAL DEFAULT 0"],
      ['monto_transferencia',     "ALTER TABLE ventas ADD COLUMN monto_transferencia REAL DEFAULT 0"],
      ['cliente_factura_nombre',  "ALTER TABLE ventas ADD COLUMN cliente_factura_nombre TEXT"],
      ['cliente_factura_cedula',  "ALTER TABLE ventas ADD COLUMN cliente_factura_cedula TEXT"],
    ]
    for (const [col, sql] of nuevasCols) {
      if (!nombresCols.includes(col)) {
        db.prepare(sql).run()
        escribirLog('Columna ' + col + ' agregada a ventas')
      }
    }
  } catch (err) {
    escribirLog('Error agregando columnas de pago mixto/facturacion: ' + err.message)
  }

  // ── FIX: CREAR grupos_talla Y MIGRAR TALLAS/PRODUCTOS ──
  // Introduce grupos de tallas (ej: General, Pantalon, Medias) para que
  // cada grupo tenga su propio rango de tallas. Todo lo existente se
  // migra automaticamente al grupo "General" sin perder datos.
  try {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS grupos_talla (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL,
        orden INTEGER DEFAULT 0
      )
    `).run()

    let general = db.prepare("SELECT id FROM grupos_talla WHERE nombre = 'General'").get()
    if (!general) {
      db.prepare("INSERT INTO grupos_talla (nombre, orden) VALUES ('General', 0)").run()
      general = db.prepare("SELECT id FROM grupos_talla WHERE nombre = 'General'").get()
      escribirLog('Grupo de tallas "General" creado')
    }

    const columnasTallas = db.prepare("PRAGMA table_info(tallas)").all()
    if (!columnasTallas.some(c => c.name === 'grupo_id')) {
      db.prepare('ALTER TABLE tallas ADD COLUMN grupo_id INTEGER').run()
      escribirLog('Columna grupo_id agregada a tallas')
    }
    db.prepare('UPDATE tallas SET grupo_id = ? WHERE grupo_id IS NULL').run(general.id)

    // ── FIX CRITICO: la tabla tallas original tenia "nombre TEXT UNIQUE",
    // es decir el nombre debia ser unico en TODA la tabla, no por grupo.
    // Eso rompe el sistema de grupos (ej: no se puede tener talla "6" en
    // Pantalon si ya existe "6" en General). SQLite no permite quitar un
    // UNIQUE con ALTER TABLE, asi que se recrea la tabla conservando datos.
    const schemaTallas = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tallas'").get()
    if (schemaTallas && /nombre\s+TEXT\s+UNIQUE/i.test(schemaTallas.sql)) {
      db.exec(`
        CREATE TABLE tallas_nueva (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL,
          grupo_id INTEGER REFERENCES grupos_talla(id),
          orden INTEGER DEFAULT 0,
          UNIQUE(nombre, grupo_id)
        )
      `)
      db.exec('INSERT INTO tallas_nueva (id, nombre, grupo_id, orden) SELECT id, nombre, grupo_id, orden FROM tallas')
      db.exec('DROP TABLE tallas')
      db.exec('ALTER TABLE tallas_nueva RENAME TO tallas')
      escribirLog('Tabla tallas migrada: nombre ahora es unico por grupo, no global')
    }

    const columnasProductos = db.prepare("PRAGMA table_info(productos)").all()
    if (!columnasProductos.some(c => c.name === 'grupo_talla_id')) {
      db.prepare('ALTER TABLE productos ADD COLUMN grupo_talla_id INTEGER').run()
      escribirLog('Columna grupo_talla_id agregada a productos')
    }
    db.prepare('UPDATE productos SET grupo_talla_id = ? WHERE grupo_talla_id IS NULL').run(general.id)
  } catch (err) {
    escribirLog('Error creando/migrando grupos_talla: ' + err.message)
  }

  // ── SEED: GRUPOS DE EJEMPLO "Pantalon" Y "Medias" ──
  // Solo se crean si no existen (no pisan nada si ya los tienes configurados).
  // El rango de Pantalon usa el mismo salto que ya reconoce claveTalla():
  // tallas de nino (4-16) y luego tallas de cintura (28-40).
  try {
    let pantalon = db.prepare("SELECT id FROM grupos_talla WHERE nombre = 'Pantalon'").get()
    if (!pantalon) {
      db.prepare("INSERT INTO grupos_talla (nombre, orden) VALUES ('Pantalon', 1)").run()
      pantalon = db.prepare("SELECT id FROM grupos_talla WHERE nombre = 'Pantalon'").get()
      const tallasPantalon = ['4','6','8','10','12','14','16','28','30','32','34','36','38','40']
      const insertTalla = db.prepare('INSERT INTO tallas (nombre, grupo_id) VALUES (?, ?)')
      tallasPantalon.forEach(t => insertTalla.run(t, pantalon.id))
      escribirLog('Grupo de tallas "Pantalon" creado con tallas de ejemplo (4-16, 28-40)')
    }

    const medias = db.prepare("SELECT id FROM grupos_talla WHERE nombre = 'Medias'").get()
    if (!medias) {
      db.prepare("INSERT INTO grupos_talla (nombre, orden) VALUES ('Medias', 2)").run()
      escribirLog('Grupo de tallas "Medias" creado (sin tallas, agregalas desde Configuracion)')
    }
  } catch (err) {
    escribirLog('Error creando grupos de tallas de ejemplo: ' + err.message)
  }

  function hacerBackup() {
    try {
      const origen   = path.join(app.getPath('userData'), 'casacas.db')
      const carpeta  = path.join(app.getPath('documents'), 'Casacas', 'backups')
      if (!fs.existsSync(carpeta)) fs.mkdirSync(carpeta, { recursive: true })

      const fecha   = new Date().toISOString().slice(0, 10)
      const destino = path.join(carpeta, `casacas_backup_${fecha}.db`)

      if (!fs.existsSync(destino)) {
        fs.copyFileSync(origen, destino)
        escribirLog('Backup creado: ' + destino)
      }

      const archivos = fs.readdirSync(carpeta)
      archivos.forEach(archivo => {
        const rutaArchivo = path.join(carpeta, archivo)
        const stats       = fs.statSync(rutaArchivo)
        const diasDiff    = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24)
        if (diasDiff > 30) fs.unlinkSync(rutaArchivo)
      })
    } catch (err) {
      escribirLog('Error en backup: ' + err.message)
    }
  }

  hacerBackup()
  escribirLog('App iniciada correctamente')

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

  // ── CONFIGURACION IMPRESORA (IPC) ─────────────────
  ipcMain.handle('obtener-config-impresora', () => leerConfig())
  ipcMain.handle('guardar-config-impresora', (e, config) => {
    guardarConfig(config)
    return { ok: true }
  })
  ipcMain.handle('probar-impresora', async () => {
    try {
      const printer   = crearImpresora()
      const conectada = process.platform === 'win32' ? true : await printer.isPrinterConnected()
      if (!conectada) return { error: 'No se pudo conectar con la impresora. Verifica la configuracion.' }
      printer.alignCenter()
      printer.bold(true)
      printer.println('Casacas Colegial')
      printer.bold(false)
      printer.println('Prueba de impresora OK')
      printer.println(new Date().toLocaleString('es-CO'))
      printer.cut()
      await printer.execute()
      return { ok: true }
    } catch (err) {
      escribirLog('Error prueba impresora: ' + err.message)
      return { error: err.message }
    }
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

  // ── CATEGORIAS INSUMO ─────────────────────────────
  ipcMain.handle('obtener-categorias-insumo', () => db.prepare('SELECT * FROM categorias_insumo ORDER BY orden, nombre').all())
  ipcMain.handle('agregar-categoria-insumo', (e, nombre) => {
    const existe = db.prepare('SELECT id FROM categorias_insumo WHERE nombre = ?').get(nombre)
    if (existe) return { error: 'Ya existe esa categoria' }
    db.prepare('INSERT INTO categorias_insumo (nombre) VALUES (?)').run(nombre)
    return { ok: true }
  })
  ipcMain.handle('editar-categoria-insumo', (e, { id, nombre }) => {
    db.prepare('UPDATE categorias_insumo SET nombre = ? WHERE id = ?').run(nombre, id)
    return { ok: true }
  })
  ipcMain.handle('eliminar-categoria-insumo', (e, id) => {
    db.prepare('DELETE FROM categorias_insumo WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── GRUPOS DE TALLA ────────────────────────────────
  // Cada grupo (General, Pantalon, Medias, etc.) tiene su propio set de
  // tallas. Un producto elige un grupo y solo ve las tallas de ese grupo.
  ipcMain.handle('obtener-grupos-talla', () => db.prepare('SELECT * FROM grupos_talla ORDER BY orden, nombre').all())

  ipcMain.handle('agregar-grupo-talla', (e, nombre) => {
    const existe = db.prepare('SELECT id FROM grupos_talla WHERE nombre = ?').get(nombre)
    if (existe) return { error: 'Ya existe ese grupo de tallas' }
    const result = db.prepare('INSERT INTO grupos_talla (nombre) VALUES (?)').run(nombre)
    return { ok: true, id: result.lastInsertRowid }
  })

  ipcMain.handle('editar-grupo-talla', (e, { id, nombre }) => {
    db.prepare('UPDATE grupos_talla SET nombre = ? WHERE id = ?').run(nombre, id)
    return { ok: true }
  })

  ipcMain.handle('eliminar-grupo-talla', (e, id) => {
    const totalGrupos = db.prepare('SELECT COUNT(*) as n FROM grupos_talla').get().n
    if (totalGrupos <= 1) return { error: 'Debe existir al menos un grupo de tallas' }
    const enUso = db.prepare('SELECT COUNT(*) as n FROM productos WHERE grupo_talla_id = ?').get(id).n
    if (enUso > 0) return { error: `Hay ${enUso} producto(s) usando este grupo. Cambia su grupo de tallas antes de eliminarlo.` }
    db.prepare('DELETE FROM tallas WHERE grupo_id = ?').run(id)
    db.prepare('DELETE FROM grupos_talla WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── TALLAS ─────────────────────────────────────────
  // Sin grupoId devuelve todas (compatibilidad); con grupoId, solo las de ese grupo.
  ipcMain.handle('obtener-tallas', (e, grupoId) => {
    if (grupoId) return db.prepare('SELECT * FROM tallas WHERE grupo_id = ? ORDER BY orden, nombre').all(grupoId)
    return db.prepare('SELECT * FROM tallas ORDER BY grupo_id, orden, nombre').all()
  })
  ipcMain.handle('agregar-talla', (e, { nombre, grupoId }) => {
    const existe = db.prepare('SELECT id FROM tallas WHERE nombre = ? AND grupo_id = ?').get(nombre, grupoId)
    if (existe) return { error: 'Ya existe esa talla en este grupo' }
    db.prepare('INSERT INTO tallas (nombre, grupo_id) VALUES (?, ?)').run(nombre, grupoId)
    return { ok: true }
  })
  ipcMain.handle('editar-talla', (e, { id, nombre }) => {
    db.prepare('UPDATE tallas SET nombre = ? WHERE id = ?').run(nombre, id)
    return { ok: true }
  })
  ipcMain.handle('eliminar-talla', (e, id) => {
    db.prepare('DELETE FROM tallas WHERE id = ?').run(id)
    return { ok: true }
  })

  // ── PRODUCTOS ─────────────────────────────────────
  ipcMain.handle('obtener-productos', () => {
    const productos = db.prepare('SELECT * FROM productos ORDER BY nombre').all()
    return productos.map(p => ({
      ...p,
      variantes: db.prepare('SELECT * FROM producto_variantes WHERE producto_id = ?')
        .all(p.id)
        .map(v => {
          const componentes = db.prepare(
            'SELECT componente_variante_id, cantidad FROM bundle_componentes WHERE bundle_variante_id = ?'
          ).all(v.id)
          if (componentes.length === 0) return { ...v, es_bundle: false }

          // El stock "real" de un bundle es el minimo de piezas completas que
          // se pueden armar con lo que hay disponible de cada componente
          // (no la cantidad cruda de su propia fila, que no se usa como
          // inventario fisico independiente).
          const stockDisponible = Math.min(...componentes.map(c => {
            const comp = db.prepare('SELECT cantidad FROM producto_variantes WHERE id = ?').get(c.componente_variante_id)
            if (!comp) return 0
            return Math.floor(comp.cantidad / (c.cantidad || 1))
          }))

          return { ...v, cantidad: stockDisponible, es_bundle: true }
        })
        .sort((a, b) => compararTallas(a.talla, b.talla))
    }))
  })

  ipcMain.handle('agregar-producto', (e, { producto, variantes }) => {
    const result = db.prepare(`
      INSERT INTO productos (nombre, categoria, colegio, genero, grupo_talla_id)
      VALUES (@nombre, @categoria, @colegio, @genero, @grupo_talla_id)
    `).run(producto)

    const productoId = result.lastInsertRowid
    const insertVar  = db.prepare(`
      INSERT INTO producto_variantes (producto_id, talla, precio, precio_costo, cantidad, stock_minimo, codigo_barras)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    for (const v of variantes) {
      const varResult  = insertVar.run(productoId, v.talla, v.precio, v.precio_costo || 0, v.cantidad, v.stock_minimo, 'TEMP')
      const varianteId = varResult.lastInsertRowid
      const codigo     = generarEAN13(productoId, varianteId)
      db.prepare('UPDATE producto_variantes SET codigo_barras = ? WHERE id = ?').run(codigo, varianteId)
    }

    actualizarExcelInventario(db)
    return { ok: true, productoId }
  })

  ipcMain.handle('editar-producto', (e, { producto }) => {
    db.prepare(`
      UPDATE productos SET nombre=@nombre, categoria=@categoria, colegio=@colegio, genero=@genero, grupo_talla_id=@grupo_talla_id WHERE id=@id
    `).run(producto)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  ipcMain.handle('agregar-variante', (e, { productoId, variante }) => {
    const result = db.prepare(`
      INSERT INTO producto_variantes (producto_id, talla, precio, precio_costo, cantidad, stock_minimo, codigo_barras)
      VALUES (?, ?, ?, ?, ?, ?, 'TEMP')
    `).run(productoId, variante.talla, variante.precio, variante.precio_costo || 0, variante.cantidad, variante.stock_minimo)
    const varianteId = result.lastInsertRowid
    const codigo     = generarEAN13(productoId, varianteId)
    db.prepare('UPDATE producto_variantes SET codigo_barras = ? WHERE id = ?').run(codigo, varianteId)
    actualizarExcelInventario(db)
    return { ok: true, varianteId, codigo }
  })

  ipcMain.handle('editar-variante', (e, variante) => {
    const datos = { ...variante, precio_costo: variante.precio_costo || 0 }
    db.prepare(`
      UPDATE producto_variantes SET talla=@talla, precio=@precio, precio_costo=@precio_costo, cantidad=@cantidad, stock_minimo=@stock_minimo WHERE id=@id
    `).run(datos)
    actualizarExcelInventario(db)
    return { ok: true }
  })

  ipcMain.handle('eliminar-variante', (e, id) => {
    db.prepare('DELETE FROM bundle_componentes WHERE bundle_variante_id = ?').run(id)
    db.prepare('DELETE FROM bundle_componentes WHERE componente_variante_id = ?').run(id)
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
      db.prepare(`DELETE FROM bundle_componentes WHERE bundle_variante_id IN (${placeholders})`).run(...ids)
      db.prepare(`DELETE FROM bundle_componentes WHERE componente_variante_id IN (${placeholders})`).run(...ids)
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
    const v = db.prepare(`
      SELECT v.*, p.nombre, p.categoria, p.colegio, p.genero
      FROM producto_variantes v
      JOIN productos p ON v.producto_id = p.id
      WHERE v.codigo_barras = ?
    `).get(codigo)
    if (!v) return null

    // Igual que en obtener-productos: si es un bundle, su stock real depende
    // de sus componentes, no de la cantidad cruda de su propia fila.
    const componentes = db.prepare(
      'SELECT componente_variante_id, cantidad FROM bundle_componentes WHERE bundle_variante_id = ?'
    ).all(v.id)
    if (componentes.length === 0) return v

    const stockDisponible = Math.min(...componentes.map(c => {
      const comp = db.prepare('SELECT cantidad FROM producto_variantes WHERE id = ?').get(c.componente_variante_id)
      if (!comp) return 0
      return Math.floor(comp.cantidad / (c.cantidad || 1))
    }))

    return { ...v, cantidad: stockDisponible }
  })

  ipcMain.handle('actualizar-precios-producto', (e, { productoId, variantes }) => {
    const update = db.prepare(`
      UPDATE producto_variantes SET precio = @precio, precio_costo = @precio_costo WHERE id = @id
    `)
    for (const v of variantes) {
      update.run({ id: v.id, precio: v.precio, precio_costo: v.precio_costo || 0 })
    }
    actualizarExcelInventario(db)
    return { ok: true }
  })

  // ── BUNDLES ───────────────────────────────────────
  ipcMain.handle('obtener-componentes-bundle', (e, bundleVarianteId) => {
    return db.prepare(`
      SELECT bc.id, bc.componente_variante_id, bc.cantidad,
             p.nombre as producto, pv.talla, pv.cantidad as stock,
             p.colegio, p.categoria
      FROM bundle_componentes bc
      JOIN producto_variantes pv ON bc.componente_variante_id = pv.id
      JOIN productos p ON pv.producto_id = p.id
      WHERE bc.bundle_variante_id = ?
    `).all(bundleVarianteId)
  })

  ipcMain.handle('guardar-componentes-bundle', (e, { bundleVarianteId, componentes }) => {
    db.prepare('DELETE FROM bundle_componentes WHERE bundle_variante_id = ?').run(bundleVarianteId)
    const ins = db.prepare('INSERT INTO bundle_componentes (bundle_variante_id, componente_variante_id, cantidad) VALUES (?, ?, ?)')
    for (const c of componentes) {
      ins.run(bundleVarianteId, c.componente_variante_id, c.cantidad || 1)
    }
    return { ok: true }
  })

  ipcMain.handle('eliminar-componentes-bundle', (e, bundleVarianteId) => {
    db.prepare('DELETE FROM bundle_componentes WHERE bundle_variante_id = ?').run(bundleVarianteId)
    return { ok: true }
  })

  // ── INSUMOS ───────────────────────────────────────
  ipcMain.handle('obtener-insumos', () => {
    return db.prepare('SELECT * FROM insumos ORDER BY categoria, nombre').all()
  })

  ipcMain.handle('agregar-insumo', (e, insumo) => {
    const result = db.prepare(`
      INSERT INTO insumos (nombre, categoria, unidad_medida, cantidad, stock_minimo, costo_unitario)
      VALUES (@nombre, @categoria, @unidad_medida, @cantidad, @stock_minimo, @costo_unitario)
    `).run({
      nombre:         insumo.nombre,
      categoria:      insumo.categoria,
      unidad_medida:  insumo.unidad_medida,
      cantidad:       insumo.cantidad || 0,
      stock_minimo:   insumo.stock_minimo || 0,
      costo_unitario: insumo.costo_unitario || 0
    })
    actualizarExcelInsumos(db)
    return { ok: true, insumoId: result.lastInsertRowid }
  })

  ipcMain.handle('editar-insumo', (e, insumo) => {
    db.prepare(`
      UPDATE insumos SET
        nombre = @nombre,
        categoria = @categoria,
        unidad_medida = @unidad_medida,
        stock_minimo = @stock_minimo,
        costo_unitario = @costo_unitario
      WHERE id = @id
    `).run({
      id:             insumo.id,
      nombre:         insumo.nombre,
      categoria:      insumo.categoria,
      unidad_medida:  insumo.unidad_medida,
      stock_minimo:   insumo.stock_minimo || 0,
      costo_unitario: insumo.costo_unitario || 0
    })
    actualizarExcelInsumos(db)
    return { ok: true }
  })

  ipcMain.handle('eliminar-insumo', (e, id) => {
    db.prepare('DELETE FROM movimientos_insumo WHERE insumo_id = ?').run(id)
    db.prepare('DELETE FROM insumos WHERE id = ?').run(id)
    actualizarExcelInsumos(db)
    return { ok: true }
  })

  ipcMain.handle('obtener-movimientos-insumo', (e, insumoId) => {
    let query = `
      SELECT m.id, m.tipo, m.cantidad, m.nota, m.fecha,
             i.nombre as insumo, i.unidad_medida,
             u.nombre as usuario
      FROM movimientos_insumo m
      LEFT JOIN insumos i ON m.insumo_id = i.id
      LEFT JOIN usuarios u ON m.usuario_id = u.id
    `
    if (insumoId) {
      query += ' WHERE m.insumo_id = ?'
      return db.prepare(query + ' ORDER BY m.fecha DESC').all(insumoId)
    }
    return db.prepare(query + ' ORDER BY m.fecha DESC').all()
  })

  ipcMain.handle('agregar-movimiento-insumo', (e, m) => {
    const insumo = db.prepare('SELECT cantidad FROM insumos WHERE id = ?').get(m.insumo_id)
    if (!insumo) return { error: 'Insumo no encontrado' }

    if (m.tipo === 'salida' && insumo.cantidad < m.cantidad) {
      return { error: `Solo hay ${insumo.cantidad} disponible. No puedes registrar una salida de ${m.cantidad}.` }
    }

    db.prepare(`
      INSERT INTO movimientos_insumo (insumo_id, usuario_id, tipo, cantidad, nota)
      VALUES (@insumo_id, @usuario_id, @tipo, @cantidad, @nota)
    `).run(m)

    if (m.tipo === 'entrada') {
      db.prepare('UPDATE insumos SET cantidad = cantidad + ? WHERE id = ?').run(m.cantidad, m.insumo_id)
    } else if (m.tipo === 'salida') {
      db.prepare('UPDATE insumos SET cantidad = cantidad - ? WHERE id = ?').run(m.cantidad, m.insumo_id)
    }

    actualizarExcelInsumos(db)
    return { ok: true }
  })

  // ── LIBRO DE CAJA ─────────────────────────────────
  // Toda entrada o salida de dinero real pasa por aqui. La regla es una sola:
  // se escribe un asiento en el momento en que la plata cambia de manos, no
  // cuando se entrega la mercancia. Por eso un apartado genera un asiento el
  // dia del abono y otro el dia de la entrega (solo por el saldo), y un cambio
  // de talla genera uno por la diferencia aunque no exista una venta nueva.
  //
  // El arqueo del dia suma este libro, asi que si un flujo mueve plata y no
  // escribe su asiento, la caja no cuadra contra el cajon. Cualquier flujo
  // nuevo que cobre o devuelva dinero tiene que llamar a registrarCaja().

  const insertMovCaja = db.prepare(`
    INSERT INTO movimientos_caja
      (tipo, concepto, monto, monto_efectivo, monto_transferencia, apartado_id, venta_id, usuario_id)
    VALUES (@tipo, @concepto, @monto, @monto_efectivo, @monto_transferencia, @apartado_id, @venta_id, @usuario_id)
  `)

  // Reparte un monto entre efectivo y transferencia segun el metodo de pago.
  // Se usa tanto en ventas como en abonos y diferencias de cambio, para que
  // todos los flujos partan la plata igual y el arqueo sea comparable.
  function repartirPago(monto, metodoPago, montoTransferencia) {
    const metodo = ['transferencia', 'mixto'].includes(metodoPago) ? metodoPago : 'efectivo'
    if (metodo === 'transferencia') {
      return { metodo, efectivo: 0, transferencia: monto }
    }
    if (metodo === 'mixto') {
      // El signo importa: en una devolucion el monto es negativo y el reparto
      // tiene que respetarlo, por eso se trabaja sobre el valor absoluto y se
      // le devuelve el signo al final.
      const signo       = monto < 0 ? -1 : 1
      const absoluto    = Math.abs(monto)
      const transferido = Math.min(absoluto, Math.max(0, parseFloat(montoTransferencia) || 0))
      return {
        metodo,
        efectivo:      signo * (absoluto - transferido),
        transferencia: signo * transferido
      }
    }
    return { metodo, efectivo: monto, transferencia: 0 }
  }

  function registrarCaja({ tipo, concepto, monto, metodoPago, montoTransferencia, apartadoId, ventaId, usuarioId }) {
    if (!monto) return null
    const { efectivo, transferencia } = repartirPago(monto, metodoPago, montoTransferencia)
    return insertMovCaja.run({
      tipo,
      concepto:            concepto || null,
      monto,
      monto_efectivo:      efectivo,
      monto_transferencia: transferencia,
      apartado_id:         apartadoId || null,
      venta_id:            ventaId    || null,
      usuario_id:          usuarioId  || null
    })
  }

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
      SELECT ai.*,
             COALESCE(v.talla, ai.talla_libre)          as talla,
             v.codigo_barras,
             COALESCE(p.nombre, ai.descripcion_libre)   as producto,
             COALESCE(p.colegio, '')                    as colegio,
             COALESCE(p.categoria, 'Confeccion')        as categoria
      FROM apartado_items ai
      LEFT JOIN producto_variantes v ON ai.variante_id = v.id
      LEFT JOIN productos p ON v.producto_id = p.id
      WHERE ai.apartado_id = ?
    `).all(apartadoId)
  })

  // El abono inicial es plata que entra HOY, aunque la mercancia se entregue
  // semanas despues: por eso se le escribe su asiento de caja aqui mismo.
  const crearApartado = db.transaction(({ apartado, items, metodoPago, montoTransferencia }) => {
    const total = items.reduce((acc, i) => acc + (i.cantidad * i.precio_unitario), 0)
    const abono = Math.max(0, Math.min(parseFloat(apartado.abono) || 0, total))

    const result = db.prepare(`
      INSERT INTO apartados (nombre, telefono, colegio, notas, abono, total, estado, tipo, usuario_id)
      VALUES (@nombre, @telefono, @colegio, @notas, @abono, @total, 'pendiente', @tipo, @usuario_id)
    `).run({ ...apartado, abono, total, tipo: apartado.tipo || 'apartado' })

    const insertItem = db.prepare(`
      INSERT INTO apartado_items (apartado_id, variante_id, cantidad, precio_unitario, descripcion_libre, talla_libre)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const item of items) {
      insertItem.run(
        result.lastInsertRowid,
        item.variante_id || null,
        item.cantidad,
        item.precio_unitario,
        item.descripcion_libre || null,
        item.talla_libre || null
      )
    }

    if (abono > 0) {
      registrarCaja({
        tipo:       'abono_apartado',
        concepto:   `Abono inicial de apartado de ${apartado.nombre}`,
        monto:      abono,
        metodoPago, montoTransferencia,
        apartadoId: result.lastInsertRowid,
        usuarioId:  apartado.usuario_id
      })
    }

    return { ok: true, apartadoId: result.lastInsertRowid, total, abono }
  })

  ipcMain.handle('agregar-apartado', (e, { apartado, items, metodoPago, montoTransferencia }) => {
    try {
      return crearApartado({ apartado, items, metodoPago, montoTransferencia })
    } catch (err) {
      escribirLog('Error creando apartado: ' + err.message)
      return { error: 'No se pudo guardar el apartado: ' + err.message }
    }
  })

  // Abono posterior: el cliente vuelve y deja mas plata antes de la entrega.
  // Antes esto se hacia con un UPDATE directo sobre "abono" desde el formulario
  // de edicion, lo que pisaba el valor anterior y no dejaba rastro de cuanto ni
  // que dia habia entrado. Ahora suma sobre el acumulado y deja su asiento.
  const abonarApartado = db.transaction(({ apartadoId, monto, metodoPago, montoTransferencia, usuarioId }) => {
    const apartado = db.prepare('SELECT * FROM apartados WHERE id = ?').get(apartadoId)
    if (!apartado) return { error: 'Apartado no encontrado' }
    if (apartado.estado !== 'pendiente') {
      return { error: 'Este apartado ya fue entregado. No se le pueden registrar mas abonos.' }
    }

    const cantidad = parseFloat(monto) || 0
    if (cantidad <= 0) return { error: 'El abono debe ser mayor a cero.' }

    const saldo = apartado.total - apartado.abono
    if (cantidad > saldo) {
      return { error: `El abono no puede superar el saldo pendiente ($${saldo.toLocaleString('es-CO')}).` }
    }

    db.prepare('UPDATE apartados SET abono = abono + ? WHERE id = ?').run(cantidad, apartadoId)

    registrarCaja({
      tipo:       'abono_apartado',
      concepto:   `Abono de apartado de ${apartado.nombre}`,
      monto:      cantidad,
      metodoPago, montoTransferencia,
      apartadoId, usuarioId
    })

    const nuevoAbono = apartado.abono + cantidad
    return { ok: true, abono: nuevoAbono, saldo: apartado.total - nuevoAbono }
  })

  ipcMain.handle('agregar-abono-apartado', (e, datos) => {
    try {
      return abonarApartado(datos)
    } catch (err) {
      escribirLog('Error registrando abono: ' + err.message)
      return { error: 'No se pudo registrar el abono: ' + err.message }
    }
  })

  ipcMain.handle('obtener-abonos-apartado', (e, apartadoId) => {
    return db.prepare(`
      SELECT mc.id, mc.tipo, mc.monto, mc.monto_efectivo, mc.monto_transferencia,
             mc.fecha, u.nombre as usuario
      FROM movimientos_caja mc
      LEFT JOIN usuarios u ON mc.usuario_id = u.id
      WHERE mc.apartado_id = ? AND mc.tipo IN ('abono_apartado', 'abono_apartado_migrado')
      ORDER BY mc.fecha ASC
    `).all(apartadoId)
  })

  // Nota: "abono" ya NO se toca desde aqui. Cambiarlo a mano desataria el
  // descuadre que este modulo existe para evitar (plata en el apartado sin
  // asiento en caja). Los abonos entran unicamente por 'agregar-abono-apartado'.
  ipcMain.handle('editar-apartado', (e, apartado) => {
    db.prepare(`
      UPDATE apartados SET nombre=@nombre, telefono=@telefono, colegio=@colegio, notas=@notas WHERE id=@id
    `).run({
      id:       apartado.id,
      nombre:   apartado.nombre,
      telefono: apartado.telefono,
      colegio:  apartado.colegio,
      notas:    apartado.notas
    })
    return { ok: true }
  })

  // Al borrar un apartado tambien se borran sus asientos de caja: esa plata se
  // le devuelve al cliente, asi que no puede seguir contando como ingreso.
  const borrarApartado = db.transaction(id => {
    const apartado = db.prepare('SELECT * FROM apartados WHERE id = ?').get(id)
    if (!apartado) return { error: 'Apartado no encontrado' }

    // Un apartado ya entregado tiene una venta detras. Borrarlo se llevaria
    // por delante el asiento del saldo cobrado y dejaria la venta huerfana,
    // descuadrando el dia de la entrega. Para deshacer una entrega esta la
    // anulacion de la venta, que si devuelve el stock y la plata como toca.
    if (apartado.estado === 'entregado') {
      return { error: 'Este apartado ya fue entregado. Para deshacerlo, anula la venta desde Historial.' }
    }

    db.prepare('DELETE FROM movimientos_caja WHERE apartado_id = ?').run(id)
    db.prepare('DELETE FROM apartado_items WHERE apartado_id = ?').run(id)
    db.prepare('DELETE FROM apartados WHERE id = ?').run(id)
    return { ok: true, abonoDevuelto: apartado.abono }
  })

  ipcMain.handle('eliminar-apartado', (e, id) => {
    try {
      return borrarApartado(id)
    } catch (err) {
      escribirLog('Error eliminando apartado: ' + err.message)
      return { error: 'No se pudo eliminar el apartado: ' + err.message }
    }
  })

  // ── VENTAS ────────────────────────────────────────
  // Toda la venta ocurre dentro de una unica transaccion: si algo falla a
  // mitad de camino, SQLite revierte y no queda ni media venta registrada ni
  // stock descontado de mas. Las validaciones van ANTES de cualquier
  // escritura, para que devolver un error no deje nada a medias.
  const guardarVenta = db.transaction(({
    usuarioId, apartadoId, items, abonoAplicado, metodoPago,
    montoEfectivo, montoTransferencia,
    nombreFactura, cedulaFactura
  }) => {

    const itemsParaStock    = []
    const itemsParaRegistro = []

    for (const item of items) {
      // Items de confeccion (por encargo, sin producto de inventario detras)
      // no tienen variante_id: no afectan ni requieren stock, solo quedan
      // registrados en la venta con su descripcion y talla libres.
      if (!item.variante_id) {
        itemsParaRegistro.push({ ...item })
        continue
      }

      const componentes = db.prepare(
        'SELECT * FROM bundle_componentes WHERE bundle_variante_id = ?'
      ).all(item.variante_id)

      if (componentes.length > 0) {
        itemsParaRegistro.push({ ...item })
        // OJO: el bundle (ej. "3 piezas") es una variante virtual que no tiene
        // stock fisico propio - su disponibilidad depende 100% de sus
        // componentes. Por eso NO se valida ni se descuenta la cantidad de la
        // propia fila del bundle (antes esto bloqueaba la venta si esa fila
        // tenia 0, aunque las piezas sueltas si tuvieran stock).
        for (const c of componentes) {
          itemsParaStock.push({
            variante_id: c.componente_variante_id,
            cantidad:    c.cantidad * item.cantidad,
            nota:        `Venta como parte de bundle (x${item.cantidad})`
          })
        }
      } else {
        itemsParaRegistro.push({ ...item })
        itemsParaStock.push({ ...item, nota: 'Venta registrada' })
        // OJO: antes, al vender una pieza suelta se intentaba descontar/validar
        // el stock propio de cada bundle que la usa (para "marcarlo como
        // descompletado"). Como esa fila del bundle ya no es un stock fisico
        // real (se calcula desde sus componentes), esa validacion bloqueaba
        // la venta de la pieza suelta con un falso "stock insuficiente".
        // Se quita por completo: el bundle simplemente se recalcula solo la
        // proxima vez que se consulte, sin necesidad de tocar su fila.
      }
    }

    const stockRequerido = {}
    for (const item of itemsParaStock) {
      if (!stockRequerido[item.variante_id]) stockRequerido[item.variante_id] = 0
      stockRequerido[item.variante_id] += item.cantidad
    }

    for (const [varianteId, cantidadRequerida] of Object.entries(stockRequerido)) {
      const variante = db.prepare('SELECT cantidad FROM producto_variantes WHERE id = ?').get(varianteId)
      if (!variante) {
        return { error: `Producto no encontrado (variante ID ${varianteId}).` }
      }
      if (variante.cantidad < cantidadRequerida) {
        const info = db.prepare(`
          SELECT p.nombre, pv.talla FROM producto_variantes pv
          JOIN productos p ON pv.producto_id = p.id WHERE pv.id = ?
        `).get(varianteId)
        const nombre = info ? `${info.nombre} T${info.talla}` : `variante ${varianteId}`
        const disp   = variante.cantidad
        return { error: `Stock insuficiente: solo hay ${disp} unidad${disp === 1 ? '' : 'es'} de "${nombre}".` }
      }
    }

    const totalItems  = items.reduce((acc, i) => acc + (i.cantidad * i.precio_unitario), 0)
    const total       = Math.max(0, totalItems - (abonoAplicado || 0))

    const contador    = db.prepare('SELECT ultimo_numero FROM contador_facturas WHERE id = 1').get()
    const nuevoNumero = (contador?.ultimo_numero || 0) + 1
    db.prepare('UPDATE contador_facturas SET ultimo_numero = ? WHERE id = 1').run(nuevoNumero)

    const metodo = ['transferencia', 'mixto'].includes(metodoPago) ? metodoPago : 'efectivo'

    let montoEfectivoFinal = total
    let montoTransferenciaFinal = 0
    if (metodo === 'transferencia') {
      montoEfectivoFinal = 0
      montoTransferenciaFinal = total
    } else if (metodo === 'mixto') {
      montoTransferenciaFinal = Math.min(total, Math.max(0, parseFloat(montoTransferencia) || 0))
      montoEfectivoFinal      = Math.max(0, total - montoTransferenciaFinal)
    }

    const venta = db.prepare(`
      INSERT INTO ventas (
        usuario_id, apartado_id, total, abono_aplicado, estado, numero_factura, metodo_pago,
        monto_efectivo, monto_transferencia, cliente_factura_nombre, cliente_factura_cedula
      )
      VALUES (?, ?, ?, ?, 'entregado', ?, ?, ?, ?, ?, ?)
    `).run(
      usuarioId, apartadoId || null, total, abonoAplicado || 0, nuevoNumero, metodo,
      montoEfectivoFinal, montoTransferenciaFinal,
      (nombreFactura || '').trim() || null, (cedulaFactura || '').trim() || null
    )

    const insertItem = db.prepare(`
      INSERT INTO venta_items (venta_id, variante_id, cantidad, precio_unitario, descripcion_libre, talla_libre)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const descontar  = db.prepare(`UPDATE producto_variantes SET cantidad = cantidad - ? WHERE id = ?`)
    const insertMov  = db.prepare(`INSERT INTO movimientos (variante_id, usuario_id, tipo, cantidad, nota) VALUES (?, ?, 'venta', ?, ?)`)

    for (const item of itemsParaRegistro) {
      insertItem.run(
        venta.lastInsertRowid,
        item.variante_id || null,
        item.cantidad,
        item.precio_unitario,
        item.descripcion_libre || null,
        item.talla_libre || null
      )
    }

    for (const item of itemsParaStock) {
      descontar.run(item.cantidad, item.variante_id)
      insertMov.run(item.variante_id, usuarioId, item.cantidad, item.nota || 'Venta registrada')
    }

    if (apartadoId) {
      db.prepare("UPDATE apartados SET estado='entregado', fecha_entrega=datetime('now','localtime') WHERE id=?").run(apartadoId)
    }

    // Lo que entra a caja hoy es SOLO lo que el cliente paga ahora. Si la
    // venta viene de un apartado, su abono ya genero su propio asiento el dia
    // en que lo dejo, y "total" es unicamente el saldo. Registrar aqui el
    // precio completo haria aparecer en el arqueo plata que hoy no entro al
    // cajon, que es exactamente el descuadre que este libro corrige.
    registrarCaja({
      tipo:     apartadoId ? 'saldo_apartado' : 'venta',
      concepto: apartadoId
        ? `Saldo de apartado al entregar (factura #${nuevoNumero})`
        : `Venta #${nuevoNumero}`,
      monto:              total,
      metodoPago:         metodo,
      montoTransferencia: montoTransferenciaFinal,
      apartadoId:         apartadoId || null,
      ventaId:            venta.lastInsertRowid,
      usuarioId
    })

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

    return { ok: true, ventaId: venta.lastInsertRowid, numeroFactura: nuevoNumero, alertasStockBajo, alertasAgotados }
  })

  ipcMain.handle('registrar-venta', (e, datos) => {
    let resultado
    try {
      resultado = guardarVenta(datos)
    } catch (err) {
      escribirLog('Error registrando venta: ' + err.stack)
      return { error: 'No se pudo registrar la venta: ' + err.message }
    }

    // Los Excel se refrescan DESPUES de confirmar la transaccion, nunca dentro:
    // si el archivo esta abierto en otra ventana la escritura falla, y adentro
    // ese fallo revertiria una venta que ya se cobro.
    if (resultado && resultado.ok) {
      try {
        actualizarExcelVentas(db)
        actualizarExcelInventario(db)
        actualizarExcelMovimientos(db)
      } catch (err) {
        escribirLog('Venta guardada, pero fallo la actualizacion de los Excel: ' + err.message)
      }
    }
    return resultado
  })

  ipcMain.handle('obtener-ventas', () => {
    return db.prepare(`
      SELECT v.id, v.total, v.fecha, v.estado, v.abono_aplicado, v.anulada,
             v.numero_factura, v.motivo_anulacion, v.metodo_pago,
             v.monto_efectivo, v.monto_transferencia,
             v.cliente_factura_nombre, v.cliente_factura_cedula,
             u.nombre as vendedor, a.nombre as cliente,
             (
               SELECT GROUP_CONCAT(
                 p.nombre || ' ' || COALESCE(p.categoria,'') || ' ' || COALESCE(p.colegio,'') || ' ' || COALESCE(p.genero,'') || ' T' || pv.talla,
                 ' | '
               )
               FROM venta_items vi
               JOIN producto_variantes pv ON vi.variante_id = pv.id
               JOIN productos p ON pv.producto_id = p.id
               WHERE vi.venta_id = v.id
             ) as items_resumen,
             (
               SELECT GROUP_CONCAT(
                 p.nombre || ' T' || pv.talla || ' (' || vi.cantidad || 'x) — ' || p.colegio,
                 ', '
               )
               FROM venta_items vi
               JOIN producto_variantes pv ON vi.variante_id = pv.id
               JOIN productos p ON pv.producto_id = p.id
               WHERE vi.venta_id = v.id
             ) as items_display
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN apartados a ON v.apartado_id = a.id
      ORDER BY v.fecha DESC
    `).all()
  })

  ipcMain.handle('obtener-venta-detalle', (e, ventaId) => {
    return db.prepare(`
      SELECT vi.id as item_id, vi.variante_id, vi.cantidad, vi.precio_unitario,
             p.nombre as producto, pv.talla, p.colegio, p.categoria
      FROM venta_items vi
      JOIN producto_variantes pv ON vi.variante_id = pv.id
      JOIN productos p ON pv.producto_id = p.id
      WHERE vi.venta_id = ?
    `).all(ventaId)
  })

  // ── CAMBIAR PRODUCTO / TALLA DE UNA VENTA ─────────
  // Reemplaza un item de una venta ya registrada por otro (ej: talla S por talla M).
  // Devuelve al stock la variante vieja, descuenta la variante nueva, y ajusta el
  // total de la venta segun la diferencia de precio entre ambas variantes.
  const cambiarItemVenta = db.transaction(({ ventaId, itemId, varianteNuevaId, usuarioId, motivo, metodoPago, montoTransferencia }) => {
    const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaId)
    if (!venta) return { error: 'Venta no encontrada' }
    if (venta.anulada) return { error: 'No se puede cambiar un producto de una venta anulada' }

    const item = db.prepare('SELECT * FROM venta_items WHERE id = ? AND venta_id = ?').get(itemId, ventaId)
    if (!item) return { error: 'Producto de la venta no encontrado' }

    if (item.variante_id === varianteNuevaId) {
      return { error: 'Selecciona una talla o producto diferente al actual' }
    }

    // Los bundles (paquetes) no estan soportados en el cambio por ahora,
    // ya que involucran multiples componentes de stock.
    const esBundleViejo = db.prepare('SELECT id FROM bundle_componentes WHERE bundle_variante_id = ? LIMIT 1').get(item.variante_id)
    const esBundleNuevo = db.prepare('SELECT id FROM bundle_componentes WHERE bundle_variante_id = ? LIMIT 1').get(varianteNuevaId)
    if (esBundleViejo || esBundleNuevo) {
      return { error: 'Los cambios de productos tipo paquete no estan soportados todavia. Anula la venta y registra una nueva.' }
    }

    const varianteVieja = db.prepare('SELECT v.*, p.nombre FROM producto_variantes v JOIN productos p ON v.producto_id = p.id WHERE v.id = ?').get(item.variante_id)
    const varianteNueva = db.prepare('SELECT v.*, p.nombre FROM producto_variantes v JOIN productos p ON v.producto_id = p.id WHERE v.id = ?').get(varianteNuevaId)
    if (!varianteNueva) return { error: 'El producto nuevo no existe' }

    if (varianteNueva.cantidad < item.cantidad) {
      return { error: `Solo hay ${varianteNueva.cantidad} unidad${varianteNueva.cantidad === 1 ? '' : 'es'} disponible${varianteNueva.cantidad === 1 ? '' : 's'} de "${varianteNueva.nombre} T${varianteNueva.talla}".` }
    }

    const numFactura = venta.numero_factura || ventaId
    const notaBase    = `Cambio venta #${numFactura}${motivo ? ' - ' + motivo : ''}`

    // Devolver stock de la variante vieja al inventario
    db.prepare('UPDATE producto_variantes SET cantidad = cantidad + ? WHERE id = ?').run(item.cantidad, item.variante_id)
    db.prepare(`INSERT INTO movimientos (variante_id, usuario_id, tipo, cantidad, nota) VALUES (?, ?, 'entrada', ?, ?)`)
      .run(item.variante_id, usuarioId, item.cantidad, notaBase + ' (devolucion)')

    // Descontar stock de la variante nueva
    db.prepare('UPDATE producto_variantes SET cantidad = cantidad - ? WHERE id = ?').run(item.cantidad, varianteNuevaId)
    db.prepare(`INSERT INTO movimientos (variante_id, usuario_id, tipo, cantidad, nota) VALUES (?, ?, 'venta', ?, ?)`)
      .run(varianteNuevaId, usuarioId, item.cantidad, notaBase + ' (nueva talla)')

    // Actualizar el item de la venta con el nuevo producto y precio
    db.prepare('UPDATE venta_items SET variante_id = ?, precio_unitario = ? WHERE id = ?')
      .run(varianteNuevaId, varianteNueva.precio, itemId)

    // Recalcular el total de la venta segun la diferencia de precio
    const diferencia = (varianteNueva.precio - item.precio_unitario) * item.cantidad
    const nuevoTotal = venta.total + diferencia
    db.prepare('UPDATE ventas SET total = ? WHERE id = ?').run(nuevoTotal, ventaId)

    // La diferencia es plata que se cobra o se devuelve HOY, aunque la venta
    // original sea de otro dia. Va al libro de caja con su propio asiento (y
    // con la fecha de hoy), porque el cajon la siente hoy. Ademas se reparte
    // sobre los montos de la venta para que la factura siga cuadrando consigo
    // misma: antes solo se movia "total" y el arqueo, que suma efectivo y
    // transferencia, nunca se enteraba de este dinero.
    if (diferencia !== 0) {
      const reparto = repartirPago(diferencia, metodoPago, montoTransferencia)

      db.prepare(`
        UPDATE ventas
        SET monto_efectivo      = COALESCE(monto_efectivo, 0) + ?,
            monto_transferencia = COALESCE(monto_transferencia, 0) + ?
        WHERE id = ?
      `).run(reparto.efectivo, reparto.transferencia, ventaId)

      registrarCaja({
        tipo:     diferencia > 0 ? 'diferencia_cambio' : 'devolucion_cambio',
        concepto: diferencia > 0
          ? `Diferencia cobrada por cambio en venta #${numFactura}`
          : `Diferencia devuelta por cambio en venta #${numFactura}`,
        monto:              diferencia,
        metodoPago,
        montoTransferencia,
        ventaId,
        usuarioId
      })
    }

    return {
      ok:            true,
      diferencia,
      nuevoTotal,
      productoViejo: varianteVieja ? `${varianteVieja.nombre} T${varianteVieja.talla}` : '',
      productoNuevo: `${varianteNueva.nombre} T${varianteNueva.talla}`
    }
  })

  ipcMain.handle('cambiar-item-venta', (e, datos) => {
    let resultado
    try {
      resultado = cambiarItemVenta(datos)
    } catch (err) {
      escribirLog('Error cambiando item de venta: ' + err.stack)
      return { error: 'No se pudo hacer el cambio: ' + err.message }
    }

    if (resultado && resultado.ok) {
      try {
        actualizarExcelVentas(db)
        actualizarExcelInventario(db)
        actualizarExcelMovimientos(db)
      } catch (err) {
        escribirLog('Cambio guardado, pero fallo la actualizacion de los Excel: ' + err.message)
      }
    }
    return resultado
  })

  // ── ANULAR VENTA (solo administradores) ───────────
  // No borra el registro de la venta (queda marcada como anulada, para que
  // no se pierda el historial/contabilidad), pero devuelve el stock vendido
  // al inventario. Los bundles no estan soportados todavia (igual que en
  // 'cambiar-item-venta'), ya que involucran multiples componentes de stock.
  const anularVenta = db.transaction(({ ventaId, usuarioId, motivo }) => {
    const usuario = db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(usuarioId)
    if (!usuario || usuario.rol !== 'admin') {
      return { error: 'Solo un administrador puede anular una venta.' }
    }

    const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaId)
    if (!venta) return { error: 'Venta no encontrada' }
    if (venta.anulada) return { error: 'Esta venta ya esta anulada' }

    const items = db.prepare('SELECT * FROM venta_items WHERE venta_id = ?').all(ventaId)
    if (items.length === 0) return { error: 'Esta venta no tiene productos asociados' }

    const tieneBundle = items.some(i =>
      db.prepare('SELECT id FROM bundle_componentes WHERE bundle_variante_id = ? LIMIT 1').get(i.variante_id)
    )
    if (tieneBundle) {
      return { error: 'Esta venta incluye un producto tipo paquete. La anulacion de paquetes no esta soportada todavia.' }
    }

    const numFactura = venta.numero_factura || ventaId
    const notaMov    = `Anulacion venta #${numFactura}` + (motivo ? ' - ' + motivo : '')

    const restaurar = db.prepare('UPDATE producto_variantes SET cantidad = cantidad + ? WHERE id = ?')
    const insertMov = db.prepare(`INSERT INTO movimientos (variante_id, usuario_id, tipo, cantidad, nota) VALUES (?, ?, 'entrada', ?, ?)`)

    for (const item of items) {
      restaurar.run(item.cantidad, item.variante_id)
      insertMov.run(item.variante_id, usuarioId, item.cantidad, notaMov)
    }

    db.prepare('UPDATE ventas SET anulada = 1, motivo_anulacion = ? WHERE id = ?')
      .run(motivo || 'Sin motivo especificado', ventaId)

    // La plata se devuelve HOY, no el dia de la venta. Por eso el asiento
    // original se queda intacto en su fecha y aqui se escribe uno negativo con
    // la fecha de hoy: asi el arqueo de aquel dia sigue cuadrando con lo que
    // se conto ese dia, y la salida aparece en la caja de hoy, que es cuando
    // el dinero sale del cajon de verdad.
    //
    // Se devuelve unicamente lo que se cobro en ESTA venta (el saldo del dia
    // de la entrega mas las diferencias de cambios). Si la venta venia de un
    // apartado, el abono se cobro otro dia y NO se devuelve automaticamente:
    // se informa en "abonoAplicado" para que se decida a mano, porque
    // devolverlo o no es una decision del negocio, no del sistema.
    const cobradoEfectivo      = venta.monto_efectivo      || 0
    const cobradoTransferencia = venta.monto_transferencia || 0
    const totalDevuelto        = cobradoEfectivo + cobradoTransferencia

    if (totalDevuelto !== 0) {
      insertMovCaja.run({
        tipo:                'devolucion_anulacion',
        concepto:            `Devolucion por anulacion de venta #${numFactura}` + (motivo ? ' - ' + motivo : ''),
        monto:               -totalDevuelto,
        monto_efectivo:      -cobradoEfectivo,
        monto_transferencia: -cobradoTransferencia,
        apartado_id:         venta.apartado_id || null,
        venta_id:            ventaId,
        usuario_id:          usuarioId
      })
    }

    return {
      ok:             true,
      totalDevuelto,
      abonoAplicado:  venta.abono_aplicado || 0
    }
  })

  ipcMain.handle('anular-venta', (e, datos) => {
    let resultado
    try {
      resultado = anularVenta(datos)
    } catch (err) {
      escribirLog('Error anulando venta: ' + err.stack)
      return { error: 'No se pudo anular la venta: ' + err.message }
    }

    if (resultado && resultado.ok) {
      try {
        actualizarExcelVentas(db)
        actualizarExcelInventario(db)
        actualizarExcelMovimientos(db)
      } catch (err) {
        escribirLog('Anulacion guardada, pero fallo la actualizacion de los Excel: ' + err.message)
      }
    }
    return resultado
  })

  // ── REIMPRIMIR RECIBO ─────────────────────────────
  ipcMain.handle('reimprimir-recibo', async (e, ventaId) => {
    try {
      const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(ventaId)
      if (!venta) return { error: 'Venta no encontrada' }

      const items = db.prepare(`
        SELECT vi.cantidad, vi.precio_unitario,
               p.nombre, pv.talla
        FROM venta_items vi
        JOIN producto_variantes pv ON vi.variante_id = pv.id
        JOIN productos p ON pv.producto_id = p.id
        WHERE vi.venta_id = ?
      `).all(ventaId)

      const vendedor = db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(venta.usuario_id)
      const cliente  = venta.apartado_id
        ? db.prepare('SELECT nombre FROM apartados WHERE id = ?').get(venta.apartado_id)
        : null

      const subtotal    = items.reduce((acc, i) => acc + i.cantidad * i.precio_unitario, 0)
      const totalCobrar = venta.total

      return await imprimirRecibo({
        items:         items.map(i => ({ ...i, nombre: i.nombre })),
        subtotal,
        abonoAplicado: venta.abono_aplicado || 0,
        totalCobrar,
        dado:          totalCobrar,
        vueltos:       0,
        vendedor:      vendedor?.nombre || 'Desconocido',
        cliente:       cliente?.nombre || null,
        numeroFactura: venta.numero_factura || ventaId,
        metodoPago:    venta.metodo_pago || 'efectivo',
        montoEfectivo:       venta.monto_efectivo,
        montoTransferencia:  venta.monto_transferencia,
        nombreFactura:       venta.cliente_factura_nombre,
        cedulaFactura:       venta.cliente_factura_cedula
      })
    } catch (err) {
      return { error: err.message }
    }
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

  ipcMain.handle('obtener-estadisticas', () => {
    // Estas series miden DINERO QUE ENTRO, no mercancia facturada, y por eso
    // salen del libro de caja. Un apartado aporta a su dia de abono y a su dia
    // de entrega por separado, que es como el negocio siente la plata. Antes
    // salian de SUM(ventas.total), donde los abonos no aparecian nunca.
    const ventasPorDia = db.prepare(`
      SELECT date(fecha) as dia,
             SUM(CASE WHEN tipo IN ('venta', 'saldo_apartado') THEN 1 ELSE 0 END) as cantidad,
             COALESCE(SUM(monto), 0) as total
      FROM movimientos_caja WHERE date(fecha) >= date('now', '-7 days', 'localtime')
      GROUP BY date(fecha) ORDER BY dia ASC
    `).all()

    const ventasPorSemana = db.prepare(`
      SELECT strftime('%W', fecha) as semana, strftime('%Y', fecha) as anio,
             SUM(CASE WHEN tipo IN ('venta', 'saldo_apartado') THEN 1 ELSE 0 END) as cantidad,
             COALESCE(SUM(monto), 0) as total
      FROM movimientos_caja WHERE date(fecha) >= date('now', '-28 days', 'localtime')
      GROUP BY strftime('%W', fecha) ORDER BY anio ASC, semana ASC
    `).all()

    const ventasPorMes = db.prepare(`
      SELECT strftime('%m', fecha) as mes, strftime('%Y', fecha) as anio,
             SUM(CASE WHEN tipo IN ('venta', 'saldo_apartado') THEN 1 ELSE 0 END) as cantidad,
             COALESCE(SUM(monto), 0) as total
      FROM movimientos_caja WHERE date(fecha) >= date('now', '-180 days', 'localtime')
      GROUP BY strftime('%Y-%m', fecha) ORDER BY anio ASC, mes ASC
    `).all()

    const topProductos = db.prepare(`
      SELECT p.nombre, p.colegio, p.categoria, pv.talla,
             SUM(vi.cantidad) as total_vendido,
             SUM(vi.cantidad * vi.precio_unitario) as total_pesos
      FROM venta_items vi
      JOIN ventas v ON vi.venta_id = v.id
      JOIN producto_variantes pv ON vi.variante_id = pv.id
      JOIN productos p ON pv.producto_id = p.id
      WHERE v.anulada = 0
      GROUP BY pv.id ORDER BY total_vendido DESC LIMIT 8
    `).all()

    const porColegio = db.prepare(`
      SELECT p.colegio, COUNT(DISTINCT v.id) as ventas,
             SUM(vi.cantidad * vi.precio_unitario) as total
      FROM venta_items vi
      JOIN ventas v ON vi.venta_id = v.id
      JOIN producto_variantes pv ON vi.variante_id = pv.id
      JOIN productos p ON pv.producto_id = p.id
      WHERE v.anulada = 0 AND p.colegio IS NOT NULL AND p.colegio != ''
      GROUP BY p.colegio ORDER BY ventas DESC
    `).all()

    const porCategoria = db.prepare(`
      SELECT p.categoria, SUM(vi.cantidad) as total_vendido,
             SUM(vi.cantidad * vi.precio_unitario) as total_pesos
      FROM venta_items vi
      JOIN ventas v ON vi.venta_id = v.id
      JOIN producto_variantes pv ON vi.variante_id = pv.id
      JOIN productos p ON pv.producto_id = p.id
      WHERE v.anulada = 0 AND p.categoria IS NOT NULL AND p.categoria != ''
      GROUP BY p.categoria ORDER BY total_vendido DESC
    `).all()

    const porTalla = db.prepare(`
      SELECT pv.talla, SUM(vi.cantidad) as total_vendido
      FROM venta_items vi
      JOIN ventas v ON vi.venta_id = v.id
      JOIN producto_variantes pv ON vi.variante_id = pv.id
      WHERE v.anulada = 0
      GROUP BY pv.talla ORDER BY total_vendido DESC
    `).all()

    const apartadosVencidos = db.prepare(`
      SELECT id, nombre, telefono, colegio, total, abono,
             CAST((julianday('now','localtime') - julianday(fecha_creacion)) AS INTEGER) as dias
      FROM apartados WHERE estado = 'pendiente' ORDER BY dias DESC
    `).all()

    const resumenMeses = db.prepare(`
      SELECT strftime('%Y-%m', fecha) as periodo,
             strftime('%m', fecha) as mes, strftime('%Y', fecha) as anio,
             COALESCE(SUM(monto), 0) as ingresos,
             SUM(CASE WHEN tipo IN ('venta', 'saldo_apartado') THEN 1 ELSE 0 END) as ventas
      FROM movimientos_caja WHERE date(fecha) >= date('now', '-180 days', 'localtime')
      GROUP BY strftime('%Y-%m', fecha) ORDER BY periodo ASC
    `).all()

    const egresosPorMes = db.prepare(`
      SELECT strftime('%Y-%m', fecha) as periodo, SUM(monto) as egresos
      FROM egresos WHERE date(fecha) >= date('now', '-180 days', 'localtime')
      GROUP BY strftime('%Y-%m', fecha)
    `).all()

    return {
      ventasPorDia, ventasPorSemana, ventasPorMes,
      topProductos, porColegio, porCategoria, porTalla,
      apartadosVencidos, resumenMeses, egresosPorMes
    }
  })

  // Ingresos reales de hoy / esta semana / este mes, para las metas. Se miden
  // contra el libro de caja porque una meta de ventas se cumple con la plata
  // que efectivamente entro, no con el precio de la mercancia entregada.
  // Los limites del periodo los manda la pantalla, que ya sabe donde empieza
  // su semana.
  ipcMain.handle('obtener-ingresos-resumen', (e, { dia, desdeSemana, mes } = {}) => {
    const hoy = dia || new Date().toISOString().slice(0, 10)

    const contarVentas = `SUM(CASE WHEN tipo IN ('venta', 'saldo_apartado') THEN 1 ELSE 0 END)`

    const delDia = db.prepare(`
      SELECT COALESCE(SUM(monto), 0) as total, ${contarVentas} as transacciones
      FROM movimientos_caja WHERE date(fecha) = date(?)
    `).get(hoy)

    const deLaSemana = db.prepare(`
      SELECT COALESCE(SUM(monto), 0) as total, ${contarVentas} as transacciones
      FROM movimientos_caja WHERE date(fecha) >= date(?)
    `).get(desdeSemana || hoy)

    const delMes = db.prepare(`
      SELECT COALESCE(SUM(monto), 0) as total, ${contarVentas} as transacciones
      FROM movimientos_caja WHERE strftime('%Y-%m', fecha) = ?
    `).get(mes || hoy.slice(0, 7))

    // Ingreso total de cada dia del ultimo año, para la racha y el "mejor dia
    // de la semana". Se calculan sobre la misma fuente que las metas para que
    // no se contradigan entre si en la misma pantalla.
    const porDia = db.prepare(`
      SELECT date(fecha) as dia, COALESCE(SUM(monto), 0) as total
      FROM movimientos_caja WHERE date(fecha) >= date('now', '-365 days', 'localtime')
      GROUP BY date(fecha) ORDER BY dia ASC
    `).all()

    return {
      dia:    { total: delDia.total     || 0, transacciones: delDia.transacciones     || 0 },
      semana: { total: deLaSemana.total || 0, transacciones: deLaSemana.transacciones || 0 },
      mes:    { total: delMes.total     || 0, transacciones: delMes.transacciones     || 0 },
      porDia
    }
  })

  // ── REPORTES ──────────────────────────────────────
  ipcMain.handle('obtener-reporte', (e, { fechaInicio, fechaFin }) => {
    const ventas = db.prepare(`
      SELECT v.id, v.total, v.fecha, v.estado, v.abono_aplicado, v.metodo_pago,
             v.monto_efectivo, v.monto_transferencia,
             u.nombre as vendedor, a.nombre as cliente
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      LEFT JOIN apartados a ON v.apartado_id = a.id
      WHERE date(v.fecha) BETWEEN date(?) AND date(?)
        AND (v.anulada IS NULL OR v.anulada = 0)
      ORDER BY v.fecha DESC
    `).all(fechaInicio, fechaFin)

    // Los totales de dinero del reporte salen del libro de caja, igual que el
    // arqueo, para que ambos digan siempre lo mismo. La lista "ventas" de
    // arriba sigue siendo el detalle de facturas del periodo; el dinero puede
    // no coincidir con esa lista, porque un abono de un apartado que todavia
    // no se entrega es plata cobrada sin factura asociada.
    const movimientosPeriodo = db.prepare(`
      SELECT tipo, monto, monto_efectivo, monto_transferencia
      FROM movimientos_caja WHERE date(fecha) BETWEEN date(?) AND date(?)
    `).all(fechaInicio, fechaFin)

    const totalVendido       = movimientosPeriodo.reduce((acc, m) => acc + (m.monto || 0), 0)
    const totalEfectivo      = movimientosPeriodo.reduce((acc, m) => acc + (m.monto_efectivo || 0), 0)
    const totalTransferencia = movimientosPeriodo.reduce((acc, m) => acc + (m.monto_transferencia || 0), 0)
    const cantidadEfectivo      = movimientosPeriodo.filter(m => (m.monto_efectivo      || 0) !== 0).length
    const cantidadTransferencia = movimientosPeriodo.filter(m => (m.monto_transferencia || 0) !== 0).length

    const masVendidos = db.prepare(`
      SELECT p.nombre, p.colegio, pv.talla, p.categoria,
             SUM(vi.cantidad) as total_vendido,
             SUM(vi.cantidad * vi.precio_unitario) as total_pesos
      FROM venta_items vi
      JOIN producto_variantes pv ON vi.variante_id = pv.id
      JOIN productos p ON pv.producto_id = p.id
      JOIN ventas v ON vi.venta_id = v.id
      WHERE date(v.fecha) BETWEEN date(?) AND date(?)
        AND (v.anulada IS NULL OR v.anulada = 0)
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
      SELECT date(fecha) as dia,
             SUM(CASE WHEN tipo IN ('venta', 'saldo_apartado') THEN 1 ELSE 0 END) as cantidad_ventas,
             COALESCE(SUM(monto), 0) as total
      FROM movimientos_caja
      WHERE date(fecha) BETWEEN date(?) AND date(?)
      GROUP BY date(fecha) ORDER BY dia DESC
    `).all(fechaInicio, fechaFin)

    const totalEgresos = db.prepare(`
      SELECT COALESCE(SUM(monto), 0) as total FROM egresos
      WHERE date(fecha) BETWEEN date(?) AND date(?)
    `).get(fechaInicio, fechaFin)

    const costoVendido = db.prepare(`
      SELECT COALESCE(SUM(vi.cantidad * pv.precio_costo), 0) as total
      FROM venta_items vi
      JOIN ventas v ON vi.venta_id = v.id
      JOIN producto_variantes pv ON vi.variante_id = pv.id
      WHERE date(v.fecha) BETWEEN date(?) AND date(?)
        AND (v.anulada IS NULL OR v.anulada = 0)
    `).get(fechaInicio, fechaFin)

    const gananciaBruta = totalVendido - (totalEgresos.total || 0)
    const gananciaNeta  = gananciaBruta - (costoVendido.total || 0)

    return {
      ventas,
      totalVendido,
      cantidadVentas:        ventas.length,
      totalEfectivo,
      cantidadEfectivo,
      totalTransferencia,
      cantidadTransferencia,
      masVendidos,
      entradas:              entradas.total || 0,
      salidas:               salidas.total  || 0,
      porDia,
      totalEgresos:          totalEgresos.total  || 0,
      costoVendido:          costoVendido.total  || 0,
      gananciaBruta,
      gananciaNeta
    }
  })

  ipcMain.handle('obtener-ruta-excel', () => getRutaExcel())

  // ── ARQUEO DE CAJA ─────────────────────────────────
  // Etiquetas legibles para el desglose impreso del arqueo.
  const ETIQUETAS_CAJA = {
    venta:                   'Ventas de mostrador',
    abono_apartado:          'Abonos de apartados',
    abono_apartado_migrado:  'Abonos de apartados',
    saldo_apartado:          'Saldos de apartados entregados',
    diferencia_cambio:       'Diferencias cobradas por cambios',
    devolucion_cambio:       'Diferencias devueltas por cambios',
    devolucion_anulacion:    'Devoluciones por anulaciones'
  }

  // El resumen sale del libro de caja, no de la tabla "ventas". Es la unica
  // forma de que cuadre contra el cajon: el dinero de un apartado entra en dos
  // dias distintos, y un cambio o una anulacion mueven plata sin que haya una
  // venta nueva ese dia.
  //
  // Los asientos anulados NO se excluyen: una venta anulada deja su asiento
  // original en su fecha y genera uno negativo el dia de la anulacion. Filtrar
  // por "anulada = 0" (como se hacia antes) cambiaba retroactivamente el
  // arqueo de un dia ya cerrado y contado.
  function resumenCajaDelDia(fecha) {
    const movimientos = db.prepare(`
      SELECT tipo, monto, monto_efectivo, monto_transferencia
      FROM movimientos_caja WHERE date(fecha) = date(?)
    `).all(fecha)

    const egresos = db.prepare(`
      SELECT COALESCE(SUM(monto), 0) as total FROM egresos WHERE date(fecha) = date(?)
    `).get(fecha)

    const suma = (campo) => movimientos.reduce((acc, m) => acc + (m[campo] || 0), 0)

    // Desglose por concepto, para que al cerrar se pueda ver de donde salio
    // cada peso y encontrar rapido de donde viene una diferencia.
    const porTipo = {}
    for (const m of movimientos) {
      const etiqueta = ETIQUETAS_CAJA[m.tipo] || m.tipo
      if (!porTipo[etiqueta]) porTipo[etiqueta] = { concepto: etiqueta, cantidad: 0, total: 0 }
      porTipo[etiqueta].cantidad += 1
      porTipo[etiqueta].total    += m.monto || 0
    }

    return {
      cantidadEfectivo:      movimientos.filter(m => (m.monto_efectivo      || 0) !== 0).length,
      totalEfectivo:         suma('monto_efectivo'),
      cantidadTransferencia: movimientos.filter(m => (m.monto_transferencia || 0) !== 0).length,
      totalTransferencia:    suma('monto_transferencia'),
      totalEgresos:          egresos.total || 0,
      desglose:              Object.values(porTipo).sort((a, b) => b.total - a.total)
    }
  }

  // Movimientos de dinero recientes, con los nombres ya resueltos, para poder
  // mostrarlos en las pantallas junto a las ventas. Sin esto el dinero de un
  // abono queda registrado pero invisible: no crea una venta, asi que no
  // aparece en ninguna lista que solo consulte la tabla "ventas".
  ipcMain.handle('obtener-movimientos-caja', (e, { limite } = {}) => {
    return db.prepare(`
      SELECT mc.id, mc.tipo, mc.concepto, mc.monto, mc.monto_efectivo,
             mc.monto_transferencia, mc.fecha, mc.venta_id, mc.apartado_id,
             v.numero_factura,
             u.nombre as usuario,
             a.nombre as cliente,
             a.total  as apartado_total,
             a.abono  as apartado_abono
      FROM movimientos_caja mc
      LEFT JOIN usuarios  u ON mc.usuario_id  = u.id
      LEFT JOIN ventas    v ON mc.venta_id    = v.id
      LEFT JOIN apartados a ON mc.apartado_id = a.id
      ORDER BY mc.fecha DESC, mc.id DESC
      LIMIT ?
    `).all(limite || 500)
  })

  // Detalle movimiento por movimiento del dia, para cuadrar la caja cuando el
  // total no coincide con lo contado a mano.
  ipcMain.handle('obtener-movimientos-caja-dia', (e, fecha) => {
    const dia = fecha || new Date().toISOString().slice(0, 10)
    return db.prepare(`
      SELECT mc.id, mc.tipo, mc.concepto, mc.monto, mc.monto_efectivo,
             mc.monto_transferencia, mc.fecha, mc.venta_id, mc.apartado_id,
             u.nombre as usuario, v.numero_factura
      FROM movimientos_caja mc
      LEFT JOIN usuarios u ON mc.usuario_id = u.id
      LEFT JOIN ventas   v ON mc.venta_id   = v.id
      WHERE date(mc.fecha) = date(?)
      ORDER BY mc.fecha ASC, mc.id ASC
    `).all(dia)
  })

  ipcMain.handle('obtener-resumen-caja-dia', (e, fecha) => {
    return resumenCajaDelDia(fecha || new Date().toISOString().slice(0, 10))
  })

  ipcMain.handle('imprimir-arqueo-diario', async (e, { fecha, cerradoPor } = {}) => {
    const fechaConsulta = fecha || new Date().toISOString().slice(0, 10)
    const resumen        = resumenCajaDelDia(fechaConsulta)
    const fechaTexto      = new Date(fechaConsulta + 'T00:00:00').toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
    const datos = { ...resumen, fechaTexto, cerradoPor }

    try {
      if (process.platform === 'win32') {
        const buffer = construirBufferArqueo(datos)
        return await imprimirWindowsRaw(buffer)
      }
      const printer   = crearImpresora()
      const conectada = await printer.isPrinterConnected()
      if (!conectada) return { error: 'No se pudo conectar con la impresora. Verifica la configuracion en Ajustes.' }

      const totalVentas    = resumen.totalEfectivo + resumen.totalTransferencia
      const efectivoEnCaja = resumen.totalEfectivo - resumen.totalEgresos

      printer.alignCenter()
      printer.bold(true)
      printer.println('Casacas Colegial')
      printer.bold(false)
      printer.println('San Gil - Calle 11 No. 10-66')
      printer.println('Piso 2, Local 201')
      printer.drawLine()
      printer.bold(true)
      printer.println('ARQUEO DE CAJA')
      printer.bold(false)
      printer.println(fechaTexto)
      printer.drawLine()
      printer.alignLeft()

      // Mismo desglose que en la version de Windows: permite rastrear de donde
      // sale una diferencia sin tener que abrir la aplicacion.
      if (Array.isArray(resumen.desglose) && resumen.desglose.length > 0) {
        printer.bold(true)
        printer.println('DETALLE DEL DIA')
        printer.bold(false)
        for (const d of resumen.desglose) {
          printer.alignLeft()
          printer.println(d.concepto + ' (' + d.cantidad + ')')
          printer.alignRight()
          printer.println((d.total < 0 ? '-$' : '$') + Math.abs(d.total).toLocaleString('es-CO'))
        }
        printer.alignLeft()
        printer.drawLine()
      }

      printer.println('En efectivo (' + resumen.cantidadEfectivo + ' movs.)')
      printer.alignRight()
      printer.println('$' + resumen.totalEfectivo.toLocaleString('es-CO'))
      printer.alignLeft()
      printer.println('Por transferencia (' + resumen.cantidadTransferencia + ' movs.)')
      printer.alignRight()
      printer.println('$' + resumen.totalTransferencia.toLocaleString('es-CO'))
      printer.alignLeft()
      printer.drawLine()
      printer.alignRight()
      printer.bold(true)
      printer.println('Total recibido:  $' + totalVentas.toLocaleString('es-CO'))
      printer.bold(false)
      printer.alignLeft()
      printer.drawLine()
      printer.alignRight()
      printer.println('Egresos del dia: -$' + resumen.totalEgresos.toLocaleString('es-CO'))
      printer.alignLeft()
      printer.drawLine()
      printer.alignRight()
      printer.bold(true)
      printer.println('Efectivo esperado')
      printer.println('en caja: $' + efectivoEnCaja.toLocaleString('es-CO'))
      printer.bold(false)
      printer.alignLeft()
      printer.drawLine()
      printer.alignCenter()
      if (cerradoPor) printer.println('Cerrado por: ' + cerradoPor)
      printer.println('')
      printer.println('Firma: ________________________')
      printer.cut()
      await printer.execute()
      printer.clear()
      return { ok: true }
    } catch (err) {
      escribirLog('Error impresora arqueo: ' + err.message)
      return { error: err.message }
    }
  })

  // ── IMPRESORA TERMICA: funcion compartida ─────────
  async function imprimirRecibo(datos) {
    try {
      if (process.platform === 'win32') {
        const buffer = construirBufferEscpos(datos)
        return await imprimirWindowsRaw(buffer)
      }
      const printer   = crearImpresora()
      const conectada = await printer.isPrinterConnected()
      if (!conectada) return { error: 'No se pudo conectar con la impresora. Verifica la configuracion en Ajustes.' }
      const { items, subtotal, abonoAplicado, totalCobrar, dado, vueltos, vendedor, cliente, numeroFactura, metodoPago, montoEfectivo, montoTransferencia, nombreFactura, cedulaFactura } = datos
      const fecha       = new Date().toLocaleString('es-CO')
      const labelMetodo = metodoPago === 'transferencia' ? 'Transferencia' : metodoPago === 'mixto' ? 'Efectivo + Transferencia' : 'Efectivo'
      printer.alignCenter()
      printer.bold(true)
      printer.println('Casacas Colegial')
      printer.bold(false)
      printer.println('San Gil - Calle 11 No. 10-66')
      printer.println('Piso 2, Local 201')
      printer.println('Tel: 313 849 5210')
      printer.println('colegialcasacas@gmail.com')
      printer.drawLine()
      printer.println('Factura No. ' + (numeroFactura || Date.now().toString().slice(-6)))
      printer.println(fecha)
      if (cliente) printer.println('Cliente: ' + cliente)
      if (nombreFactura) printer.println('Facturado a: ' + nombreFactura)
      if (cedulaFactura) printer.println('C.C./NIT: ' + cedulaFactura)
      printer.alignLeft()
      printer.drawLine()
      items.forEach(i => {
        const sub = (i.precio_unitario * i.cantidad).toLocaleString('es-CO')
        printer.println(i.nombre + ' T' + i.talla)
        printer.println('  ' + i.cantidad + ' x $' + parseFloat(i.precio_unitario).toLocaleString('es-CO') + ' = $' + sub)
      })
      printer.drawLine()
      printer.alignRight()
      printer.println('Subtotal:  $' + subtotal.toLocaleString('es-CO'))
      if (abonoAplicado > 0) printer.println('Abono:    -$' + abonoAplicado.toLocaleString('es-CO'))
      printer.bold(true)
      printer.println('TOTAL:     $' + totalCobrar.toLocaleString('es-CO'))
      printer.bold(false)
      printer.println('Pago:      ' + labelMetodo)
      if (metodoPago === 'mixto') {
        printer.println('Efectivo:      $' + (montoEfectivo || 0).toLocaleString('es-CO'))
        printer.println('Transferencia: $' + (montoTransferencia || 0).toLocaleString('es-CO'))
        printer.println('Recibido:  $' + dado.toLocaleString('es-CO'))
        printer.println('Vueltos:   $' + vueltos.toLocaleString('es-CO'))
      } else if (metodoPago !== 'transferencia') {
        printer.println('Recibido:  $' + dado.toLocaleString('es-CO'))
        printer.println('Vueltos:   $' + vueltos.toLocaleString('es-CO'))
      }
      printer.alignLeft()
      printer.drawLine()
      printer.alignCenter()
      printer.println('Gracias por su compra!')
      printer.println('Vuelve pronto :)')
      printer.cut()
      await printer.execute()
      printer.clear()
      return { ok: true }
    } catch (err) {
      escribirLog('Error impresora: ' + err.message)
      return { error: err.message }
    }
  }

  ipcMain.handle('imprimir-recibo', async (e, datos) => {
    if (datos.ventaId && ((datos.nombreFactura || '').trim() || (datos.cedulaFactura || '').trim())) {
      try {
        db.prepare('UPDATE ventas SET cliente_factura_nombre = ?, cliente_factura_cedula = ? WHERE id = ?')
          .run((datos.nombreFactura || '').trim() || null, (datos.cedulaFactura || '').trim() || null, datos.ventaId)
      } catch (err) {
        escribirLog('Error guardando datos de facturacion: ' + err.message)
      }
    }
    return await imprimirRecibo(datos)
  })

  // ── IMPRESORA TERMICA: COMPROBANTE DE APARTADO ────
  ipcMain.handle('imprimir-comprobante-apartado', async (e, datos) => {
    const { nombre, telefono, colegio, notas, abono, items, total, vendedor } = datos
    try {
      if (process.platform === 'win32') {
        const buffer = construirBufferApartado(datos)
        return await imprimirWindowsRaw(buffer)
      }
      const printer   = crearImpresora()
      const conectada = await printer.isPrinterConnected()
      if (!conectada) return { error: 'No se pudo conectar con la impresora. Verifica la configuracion en Ajustes.' }
      const fecha = new Date().toLocaleString('es-CO')
      const saldo = Math.max(0, total - (abono || 0))
      printer.alignCenter()
      printer.bold(true)
      printer.println('Casacas Colegial')
      printer.bold(false)
      printer.println('San Gil - Calle 11 No. 10-66')
      printer.println('Piso 2, Local 201')
      printer.println('Tel: 313 849 5210')
      printer.drawLine()
      printer.bold(true)
      printer.println('COMPROBANTE DE APARTADO')
      printer.bold(false)
      printer.println(fecha)
      printer.drawLine()
      printer.println('Reclama con el nombre de:')
      printer.setTextSize(1, 1)
      printer.println(nombre)
      printer.setTextNormal()
      if (telefono) printer.println('Tel: ' + telefono)
      if (colegio)  printer.println('Colegio: ' + colegio)
      printer.alignLeft()
      printer.drawLine()
      items.forEach(i => {
        const sub = (i.precio_unitario * i.cantidad).toLocaleString('es-CO')
        printer.println(i.nombre + ' T' + i.talla)
        printer.println('  ' + i.cantidad + ' x $' + parseFloat(i.precio_unitario).toLocaleString('es-CO') + ' = $' + sub)
      })
      printer.drawLine()
      printer.alignRight()
      printer.println('Total apartado: $' + total.toLocaleString('es-CO'))
      printer.println('Abono pagado:  -$' + (abono || 0).toLocaleString('es-CO'))
      printer.bold(true)
      printer.println('SALDO:          $' + saldo.toLocaleString('es-CO'))
      printer.bold(false)
      printer.alignLeft()
      printer.drawLine()
      if (notas) { printer.println('Notas: ' + notas); printer.drawLine() }
      printer.alignCenter()
      printer.println('Conserva este papel')
      printer.println('para reclamar tu pedido')
      printer.cut()
      await printer.execute()
      printer.clear()
      return { ok: true }
    } catch (err) {
      escribirLog('Error impresora apartado: ' + err.message)
      return { error: err.message }
    }
  })

  // ── IMPRESORA TERMICA: COTIZACION (no afecta ventas ni inventario) ──
  ipcMain.handle('imprimir-cotizacion', async (e, datos) => {
    const { items, subtotal, cliente, vendedor } = datos
    try {
      if (process.platform === 'win32') {
        const buffer = construirBufferCotizacion(datos)
        return await imprimirWindowsRaw(buffer)
      }
      const printer   = crearImpresora()
      const conectada = await printer.isPrinterConnected()
      if (!conectada) return { error: 'No se pudo conectar con la impresora. Verifica la configuracion en Ajustes.' }
      const fecha = new Date().toLocaleString('es-CO')
      printer.alignCenter()
      printer.bold(true)
      printer.println('Casacas Colegial')
      printer.bold(false)
      printer.println('San Gil - Calle 11 No. 10-66')
      printer.println('Piso 2, Local 201')
      printer.println('Tel: 313 849 5210')
      printer.drawLine()
      printer.bold(true)
      printer.println('COTIZACION')
      printer.bold(false)
      printer.println('(no es factura de venta)')
      printer.println(fecha)
      if (cliente) printer.println('Cliente: ' + cliente)
      printer.alignLeft()
      printer.drawLine()
      items.forEach(i => {
        const sub = (i.precio_unitario * i.cantidad).toLocaleString('es-CO')
        printer.println(i.nombre + ' T' + i.talla)
        printer.println('  ' + i.cantidad + ' x $' + parseFloat(i.precio_unitario).toLocaleString('es-CO') + ' = $' + sub)
      })
      printer.drawLine()
      printer.alignRight()
      printer.bold(true)
      printer.println('TOTAL:     $' + subtotal.toLocaleString('es-CO'))
      printer.bold(false)
      printer.alignLeft()
      printer.drawLine()
      printer.alignCenter()
      printer.println('Precios sujetos a cambio sin previo aviso.')
      printer.println('Este documento no reserva stock.')
      printer.cut()
      await printer.execute()
      printer.clear()
      return { ok: true }
    } catch (err) {
      escribirLog('Error impresora cotizacion: ' + err.message)
      return { error: err.message }
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      win = new BrowserWindow({ width: 1200, height: 800, webPreferences: { nodeIntegration: true, contextIsolation: false } })
      win.loadFile('login.html')
    }
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') app.quit()
})