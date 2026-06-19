const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')

const dbPath = path.join(app.getPath('userData'), 'casacas.db')
const db = new Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    usuario TEXT UNIQUE NOT NULL,
    contrasena TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'empleado',
    fecha_creacion TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS categorias_producto (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    orden INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS colegios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    orden INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS categorias_egreso (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    orden INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    categoria TEXT,
    colegio TEXT,
    genero TEXT,
    fecha_creacion TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS producto_variantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL,
    talla TEXT NOT NULL,
    precio REAL DEFAULT 0,
    precio_costo REAL DEFAULT 0,
    cantidad INTEGER DEFAULT 0,
    stock_minimo INTEGER DEFAULT 3,
    codigo_barras TEXT UNIQUE,
    fecha_creacion TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
  );

  CREATE TABLE IF NOT EXISTS apartados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT,
    colegio TEXT,
    notas TEXT,
    abono REAL DEFAULT 0,
    total REAL DEFAULT 0,
    estado TEXT DEFAULT 'pendiente',
    usuario_id INTEGER,
    fecha_creacion TEXT DEFAULT (datetime('now', 'localtime')),
    fecha_entrega TEXT,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS apartado_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    apartado_id INTEGER,
    variante_id INTEGER,
    cantidad INTEGER,
    precio_unitario REAL,
    FOREIGN KEY (apartado_id) REFERENCES apartados(id),
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id)
  );

  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_factura INTEGER UNIQUE,
    usuario_id INTEGER,
    apartado_id INTEGER,
    total REAL DEFAULT 0,
    abono_aplicado REAL DEFAULT 0,
    estado TEXT DEFAULT 'entregado',
    anulada INTEGER DEFAULT 0,
    motivo_anulacion TEXT,
    fecha TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY (apartado_id) REFERENCES apartados(id)
  );

  CREATE TABLE IF NOT EXISTS venta_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER,
    variante_id INTEGER,
    cantidad INTEGER,
    precio_unitario REAL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id),
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id)
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    variante_id INTEGER,
    usuario_id INTEGER,
    tipo TEXT,
    cantidad INTEGER,
    nota TEXT,
    fecha TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (variante_id) REFERENCES producto_variantes(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS egresos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria TEXT NOT NULL,
    descripcion TEXT,
    monto REAL NOT NULL,
    usuario_id INTEGER,
    fecha TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS metas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    monto REAL NOT NULL,
    fecha_actualizacion TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    monto_inicial REAL DEFAULT 0,
    monto_final REAL,
    estado TEXT DEFAULT 'abierta',
    notas TEXT,
    fecha_apertura TEXT DEFAULT (datetime('now', 'localtime')),
    fecha_cierre TEXT,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS log_actividad (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    usuario_nombre TEXT,
    accion TEXT NOT NULL,
    detalle TEXT,
    fecha TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS contador_facturas (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    ultimo_numero INTEGER DEFAULT 0
  );
`)

// ── Migrations para BD existente ──────────────────────────────────────────────
const migrations = [
  `ALTER TABLE ventas ADD COLUMN numero_factura INTEGER UNIQUE`,
  `ALTER TABLE ventas ADD COLUMN anulada INTEGER DEFAULT 0`,
  `ALTER TABLE ventas ADD COLUMN motivo_anulacion TEXT`,
  // Nueva columna precio_costo para BDs existentes
  `ALTER TABLE producto_variantes ADD COLUMN precio_costo REAL DEFAULT 0`,
]

migrations.forEach(sql => {
  try { db.exec(sql) } catch(e) { /* columna ya existe, ignorar */ }
})

// Inicializar contador de facturas
const contadorExiste = db.prepare('SELECT id FROM contador_facturas WHERE id = 1').get()
if (!contadorExiste) {
  const ultimaVenta = db.prepare('SELECT MAX(id) as max FROM ventas').get()
  const inicio = ultimaVenta?.max || 0
  db.prepare('INSERT INTO contador_facturas (id, ultimo_numero) VALUES (1, ?)').run(inicio)
}

// Admin por defecto
const adminExiste = db.prepare("SELECT id FROM usuarios WHERE usuario = 'admin'").get()
if (!adminExiste) {
  db.prepare(`
    INSERT INTO usuarios (nombre, usuario, contrasena, rol)
    VALUES ('Administrador', 'admin', '1234', 'admin')
  `).run()
}

// Categorias producto por defecto
const catProd = ['Uniformes','Camisas','Pantalones','Antifluidos','Medias','Correas','Otro']
catProd.forEach((nombre, i) => {
  const existe = db.prepare('SELECT id FROM categorias_producto WHERE nombre = ?').get(nombre)
  if (!existe) db.prepare('INSERT INTO categorias_producto (nombre, orden) VALUES (?, ?)').run(nombre, i)
})

// Colegios por defecto
const colegiosDefault = ['Todos','Guanenta','Presentacion','Rafael Pombo','Luis Camacho','Otro']
colegiosDefault.forEach((nombre, i) => {
  const existe = db.prepare('SELECT id FROM colegios WHERE nombre = ?').get(nombre)
  if (!existe) db.prepare('INSERT INTO colegios (nombre, orden) VALUES (?, ?)').run(nombre, i)
})

// Categorias egreso por defecto
const catEgreso = [
  'Arriendo del local','Servicios (agua, luz, internet)',
  'Compra de mercancia','Transporte','Publicidad',
  'Salarios','Papeleria y empaques','Mantenimiento','Otro'
]
catEgreso.forEach((nombre, i) => {
  const existe = db.prepare('SELECT id FROM categorias_egreso WHERE nombre = ?').get(nombre)
  if (!existe) db.prepare('INSERT INTO categorias_egreso (nombre, orden) VALUES (?, ?)').run(nombre, i)
})

// Metas por defecto
;['dia','semana','mes'].forEach(tipo => {
  const existe = db.prepare('SELECT id FROM metas WHERE tipo = ?').get(tipo)
  if (!existe) db.prepare('INSERT INTO metas (tipo, monto) VALUES (?, 0)').run(tipo)
})

module.exports = db