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

  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    categoria TEXT,
    colegio TEXT,
    genero TEXT,
    talla TEXT,
    cantidad INTEGER DEFAULT 0,
    precio REAL DEFAULT 0,
    stock_minimo INTEGER DEFAULT 3,
    fecha_creacion TEXT DEFAULT (datetime('now', 'localtime'))
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
    producto_id INTEGER,
    cantidad INTEGER,
    precio_unitario REAL,
    FOREIGN KEY (apartado_id) REFERENCES apartados(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
  );

  CREATE TABLE IF NOT EXISTS ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    apartado_id INTEGER,
    total REAL DEFAULT 0,
    abono_aplicado REAL DEFAULT 0,
    estado TEXT DEFAULT 'pendiente',
    fecha TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
    FOREIGN KEY (apartado_id) REFERENCES apartados(id)
  );

  CREATE TABLE IF NOT EXISTS venta_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id INTEGER,
    producto_id INTEGER,
    cantidad INTEGER,
    precio_unitario REAL,
    FOREIGN KEY (venta_id) REFERENCES ventas(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER,
    usuario_id INTEGER,
    tipo TEXT,
    cantidad INTEGER,
    nota TEXT,
    fecha TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (producto_id) REFERENCES productos(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
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
`)

const adminExiste = db.prepare("SELECT id FROM usuarios WHERE usuario = 'admin'").get()
if (!adminExiste) {
  db.prepare(`
    INSERT INTO usuarios (nombre, usuario, contrasena, rol)
    VALUES ('Administrador', 'admin', '1234', 'admin')
  `).run()
}

module.exports = db