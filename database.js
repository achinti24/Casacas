const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const { app } = require('electron')

const dbPath = path.join(app.getPath('userData'), 'casacas.db')

// ── Backup de seguridad antes de tocar nada ───────────────────────────────────
// Si ya existia una base de datos (cliente con datos reales), se guarda una
// copia completa antes de correr el esquema/migraciones. Si algo saliera mal,
// el archivo original queda disponible en la carpeta "backups".
if (fs.existsSync(dbPath)) {
  try {
    const backupDir = path.join(app.getPath('userData'), 'backups')
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(backupDir, `casacas_pre_migracion_${timestamp}.db`)
    fs.copyFileSync(dbPath, backupPath)
    console.log('Backup pre-migracion creado en:', backupPath)
  } catch (e) {
    console.error('No se pudo crear el backup pre-migracion (se continua de todos modos):', e.message)
  }
}

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

  CREATE TABLE IF NOT EXISTS grupos_talla (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    orden INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tallas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    grupo_id INTEGER REFERENCES grupos_talla(id),
    orden INTEGER DEFAULT 0,
    UNIQUE(nombre, grupo_id)
  );

  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    categoria TEXT,
    colegio TEXT,
    genero TEXT,
    grupo_talla_id INTEGER REFERENCES grupos_talla(id),
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
    tipo TEXT DEFAULT 'apartado',
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
    descripcion_libre TEXT,
    talla_libre TEXT,
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
    metodo_pago TEXT DEFAULT 'efectivo',
    monto_efectivo REAL DEFAULT 0,
    monto_transferencia REAL DEFAULT 0,
    cliente_factura_nombre TEXT,
    cliente_factura_cedula TEXT,
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
    descripcion_libre TEXT,
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

  CREATE TABLE IF NOT EXISTS bundle_componentes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bundle_variante_id INTEGER NOT NULL,
    componente_variante_id INTEGER NOT NULL,
    cantidad INTEGER DEFAULT 1,
    FOREIGN KEY (bundle_variante_id) REFERENCES producto_variantes(id),
    FOREIGN KEY (componente_variante_id) REFERENCES producto_variantes(id)
  );

  CREATE TABLE IF NOT EXISTS categorias_insumo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    orden INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS insumos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    categoria TEXT,
    unidad_medida TEXT NOT NULL DEFAULT 'unidades',
    cantidad REAL DEFAULT 0,
    stock_minimo REAL DEFAULT 0,
    costo_unitario REAL DEFAULT 0,
    fecha_creacion TEXT DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS movimientos_insumo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    insumo_id INTEGER NOT NULL,
    usuario_id INTEGER,
    tipo TEXT NOT NULL,
    cantidad REAL NOT NULL,
    nota TEXT,
    fecha TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (insumo_id) REFERENCES insumos(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  -- ── LIBRO DE CAJA ───────────────────────────────────────────────────────
  -- Registro de TODO el dinero que entra o sale del negocio, en el momento
  -- exacto en que ocurre. Existe porque "venta" y "dinero" no son lo mismo:
  -- un apartado cobra plata el dia del abono y el resto el dia de la entrega,
  -- y un cambio de talla mueve plata sin que haya una venta nueva. Antes el
  -- arqueo se deducia de la tabla "ventas", asi que todo ese dinero era
  -- invisible y la caja nunca cuadraba contra el cajon.
  --
  -- Convencion de signos: monto > 0 entra plata, monto < 0 sale plata.
  -- monto_efectivo + monto_transferencia siempre suman monto (con su signo).
  CREATE TABLE IF NOT EXISTS movimientos_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    concepto TEXT,
    monto REAL NOT NULL,
    monto_efectivo REAL DEFAULT 0,
    monto_transferencia REAL DEFAULT 0,
    apartado_id INTEGER,
    venta_id INTEGER,
    usuario_id INTEGER,
    fecha TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (apartado_id) REFERENCES apartados(id),
    FOREIGN KEY (venta_id) REFERENCES ventas(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );
`)

function columnaExiste(tabla, columna) {
  const cols = db.prepare(`PRAGMA table_info(${tabla})`).all()
  return cols.some(c => c.name === columna)
}

// Detecta bases de datos antiguas donde "tallas" tenia UNIQUE solo sobre
// "nombre" (de antes de que existieran los grupos de talla). Ese indice
// heredado impide guardar la misma talla (ej. "6") en mas de un grupo,
// aunque ya se le haya agregado la columna grupo_id via ALTER TABLE.
function tieneUniqueSoloEnNombre(tabla) {
  const indices = db.prepare(`PRAGMA index_list(${tabla})`).all()
  return indices.some(idx => {
    if (!idx.unique) return false
    const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all()
    return cols.length === 1 && cols[0].name === 'nombre'
  })
}

const createMigrations = [
  `CREATE TABLE IF NOT EXISTS bundle_componentes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bundle_variante_id INTEGER NOT NULL,
    componente_variante_id INTEGER NOT NULL,
    cantidad INTEGER DEFAULT 1,
    FOREIGN KEY (bundle_variante_id) REFERENCES producto_variantes(id),
    FOREIGN KEY (componente_variante_id) REFERENCES producto_variantes(id)
  )`,
  `CREATE TABLE IF NOT EXISTS categorias_insumo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    orden INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS insumos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    categoria TEXT,
    unidad_medida TEXT NOT NULL DEFAULT 'unidades',
    cantidad REAL DEFAULT 0,
    stock_minimo REAL DEFAULT 0,
    costo_unitario REAL DEFAULT 0,
    fecha_creacion TEXT DEFAULT (datetime('now', 'localtime'))
  )`,
  `CREATE TABLE IF NOT EXISTS movimientos_insumo (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    insumo_id INTEGER NOT NULL,
    usuario_id INTEGER,
    tipo TEXT NOT NULL,
    cantidad REAL NOT NULL,
    nota TEXT,
    fecha TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (insumo_id) REFERENCES insumos(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS tallas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    grupo_id INTEGER REFERENCES grupos_talla(id),
    orden INTEGER DEFAULT 0,
    UNIQUE(nombre, grupo_id)
  )`,
  `CREATE TABLE IF NOT EXISTS grupos_talla (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT UNIQUE NOT NULL,
    orden INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS movimientos_caja (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    concepto TEXT,
    monto REAL NOT NULL,
    monto_efectivo REAL DEFAULT 0,
    monto_transferencia REAL DEFAULT 0,
    apartado_id INTEGER,
    venta_id INTEGER,
    usuario_id INTEGER,
    fecha TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (apartado_id) REFERENCES apartados(id),
    FOREIGN KEY (venta_id) REFERENCES ventas(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  )`,
]

const alterMigrations = [
  { tabla: 'ventas', columna: 'anulada', sql: `ALTER TABLE ventas ADD COLUMN anulada INTEGER DEFAULT 0` },
  { tabla: 'ventas', columna: 'motivo_anulacion', sql: `ALTER TABLE ventas ADD COLUMN motivo_anulacion TEXT` },
  { tabla: 'ventas', columna: 'monto_efectivo', sql: `ALTER TABLE ventas ADD COLUMN monto_efectivo REAL DEFAULT 0` },
  { tabla: 'ventas', columna: 'monto_transferencia', sql: `ALTER TABLE ventas ADD COLUMN monto_transferencia REAL DEFAULT 0` },
  { tabla: 'ventas', columna: 'cliente_factura_nombre', sql: `ALTER TABLE ventas ADD COLUMN cliente_factura_nombre TEXT` },
  { tabla: 'ventas', columna: 'cliente_factura_cedula', sql: `ALTER TABLE ventas ADD COLUMN cliente_factura_cedula TEXT` },
  { tabla: 'ventas', columna: 'metodo_pago', sql: `ALTER TABLE ventas ADD COLUMN metodo_pago TEXT DEFAULT 'efectivo'` },
  { tabla: 'producto_variantes', columna: 'precio_costo', sql: `ALTER TABLE producto_variantes ADD COLUMN precio_costo REAL DEFAULT 0` },
  { tabla: 'tallas', columna: 'grupo_id', sql: `ALTER TABLE tallas ADD COLUMN grupo_id INTEGER REFERENCES grupos_talla(id)` },
  { tabla: 'productos', columna: 'grupo_talla_id', sql: `ALTER TABLE productos ADD COLUMN grupo_talla_id INTEGER REFERENCES grupos_talla(id)` },
  { tabla: 'apartado_items', columna: 'descripcion_libre', sql: `ALTER TABLE apartado_items ADD COLUMN descripcion_libre TEXT` },
  { tabla: 'apartado_items', columna: 'talla_libre', sql: `ALTER TABLE apartado_items ADD COLUMN talla_libre TEXT` },
  { tabla: 'apartados', columna: 'tipo', sql: `ALTER TABLE apartados ADD COLUMN tipo TEXT DEFAULT 'apartado'` },
  { tabla: 'venta_items', columna: 'descripcion_libre', sql: `ALTER TABLE venta_items ADD COLUMN descripcion_libre TEXT` },
  { tabla: 'venta_items', columna: 'talla_libre', sql: `ALTER TABLE venta_items ADD COLUMN talla_libre TEXT` },
]

// Todo corre dentro de una transaccion: si algo falla a mitad de camino,
// SQLite revierte automaticamente y la base de datos queda como estaba antes
// de intentar migrar (no se queda a medias).
const ejecutarMigraciones = db.transaction(() => {
  createMigrations.forEach(sql => db.exec(sql))
  alterMigrations.forEach(({ tabla, columna, sql }) => {
    if (!columnaExiste(tabla, columna)) db.exec(sql)
  })

  // Caso especial: numero_factura necesita ser UNIQUE, pero SQLite no
  // permite agregar una columna UNIQUE con ALTER TABLE ADD COLUMN. Se agrega
  // la columna simple y la unicidad se garantiza con un indice aparte.
  if (!columnaExiste('ventas', 'numero_factura')) {
    db.exec(`ALTER TABLE ventas ADD COLUMN numero_factura INTEGER`)
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ventas_numero_factura ON ventas(numero_factura)`)

  // El arqueo consulta el libro de caja siempre filtrando por dia.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_movimientos_caja_fecha ON movimientos_caja(fecha)`)

  // Reconstruccion segura de "tallas" si viene de una version anterior con
  // UNIQUE solo en nombre. Se copian todos los datos existentes (id, nombre,
  // grupo_id, orden) a una tabla nueva con la restriccion correcta
  // UNIQUE(nombre, grupo_id), y se reemplaza la tabla vieja por la nueva.
  if (tieneUniqueSoloEnNombre('tallas')) {
    db.exec(`
      CREATE TABLE tallas_nueva (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        grupo_id INTEGER REFERENCES grupos_talla(id),
        orden INTEGER DEFAULT 0,
        UNIQUE(nombre, grupo_id)
      );
      INSERT INTO tallas_nueva (id, nombre, grupo_id, orden)
        SELECT id, nombre, grupo_id, orden FROM tallas;
      DROP TABLE tallas;
      ALTER TABLE tallas_nueva RENAME TO tallas;
    `)
  }
})

try {
  ejecutarMigraciones()
} catch (e) {
  console.error('Error durante las migraciones (se revirtio todo, la BD quedo intacta):', e.message)
}

// ── Backfill: abonos cobrados antes de que existiera el libro de caja ────────
// Los apartados que ya estaban en la base traen su abono acumulado en la
// columna "abono", pero sin ningun asiento de caja detras (ese dinero se
// recibio cuando la app todavia no lo registraba). Se les crea un asiento
// fechado el dia en que se creo el apartado, para que los arqueos viejos
// queden consistentes.
//
// No se sabe si aquellos abonos fueron en efectivo o transferencia, asi que se
// asumen en efectivo y quedan marcados con tipo 'abono_apartado_migrado' para
// poder distinguirlos de los que registre la app de ahora en adelante.
//
// Es idempotente: solo toca apartados que todavia no tengan ningun asiento,
// por lo que correrlo en cada arranque no duplica nada.
const backfillAbonos = db.transaction(() => {
  const sinAsiento = db.prepare(`
    SELECT a.id, a.nombre, a.abono, a.fecha_creacion, a.usuario_id
    FROM apartados a
    WHERE a.abono > 0
      AND NOT EXISTS (
        SELECT 1 FROM movimientos_caja mc
        WHERE mc.apartado_id = a.id
          AND mc.tipo IN ('abono_apartado', 'abono_apartado_migrado')
      )
  `).all()

  const insertar = db.prepare(`
    INSERT INTO movimientos_caja
      (tipo, concepto, monto, monto_efectivo, monto_transferencia, apartado_id, usuario_id, fecha)
    VALUES ('abono_apartado_migrado', ?, ?, ?, 0, ?, ?, ?)
  `)

  for (const a of sinAsiento) {
    insertar.run(
      `Abono de apartado de ${a.nombre} (registrado antes del libro de caja)`,
      a.abono, a.abono, a.id, a.usuario_id,
      a.fecha_creacion || new Date().toISOString().slice(0, 19).replace('T', ' ')
    )
  }

  if (sinAsiento.length > 0) {
    console.log(`Libro de caja: se migraron ${sinAsiento.length} abono(s) de apartados anteriores.`)
  }
})

try {
  backfillAbonos()
} catch (e) {
  console.error('Error migrando abonos al libro de caja (no se aplico nada):', e.message)
}

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

// Categorias insumo por defecto
const catInsumo = ['Telas', 'Hilos', 'Botones', 'Cierres', 'Etiquetas', 'Empaques', 'Otro']
catInsumo.forEach((nombre, i) => {
  const existe = db.prepare('SELECT id FROM categorias_insumo WHERE nombre = ?').get(nombre)
  if (!existe) db.prepare('INSERT INTO categorias_insumo (nombre, orden) VALUES (?, ?)').run(nombre, i)
})

// Grupo de tallas "General"
let grupoGeneral = db.prepare("SELECT id FROM grupos_talla WHERE nombre = 'General'").get()
if (!grupoGeneral) {
  db.prepare("INSERT INTO grupos_talla (nombre, orden) VALUES ('General', 0)").run()
  grupoGeneral = db.prepare("SELECT id FROM grupos_talla WHERE nombre = 'General'").get()
}

// Tallas huerfanas de instalaciones previas (sin grupo_id, de antes de que
// existieran los grupos): se adoptan primero en "General", ANTES de insertar
// las tallas por defecto, para no crear filas duplicadas que luego choquen
// con estas al asignarles el grupo.
db.prepare('UPDATE tallas SET grupo_id = ? WHERE grupo_id IS NULL').run(grupoGeneral.id)

// Tallas por defecto (solo las que todavia no existan en "General")
const tallasDefault = ['6','8','10','12','14','16','S','M','L','XL']
tallasDefault.forEach((nombre, i) => {
  const existe = db.prepare('SELECT id FROM tallas WHERE nombre = ? AND grupo_id = ?').get(nombre, grupoGeneral.id)
  if (!existe) db.prepare('INSERT INTO tallas (nombre, grupo_id, orden) VALUES (?, ?, ?)').run(nombre, grupoGeneral.id, i)
})

// Metas por defecto
;['dia','semana','mes'].forEach(tipo => {
  const existe = db.prepare('SELECT id FROM metas WHERE tipo = ?').get(tipo)
  if (!existe) db.prepare('INSERT INTO metas (tipo, monto) VALUES (?, 0)').run(tipo)
})

module.exports = db