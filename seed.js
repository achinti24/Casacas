/**
 * seed.js — Insertar productos en casacas.db
 * Ejecutar: node seed.js
 * Correr desde la carpeta del proyecto Casacas
 */

const path     = require('path')
const os       = require('os')
const fs       = require('fs')
const Database = require('better-sqlite3')

const dbPath = path.join(os.homedir(), '.config', 'casacas', 'casacas.db')
if (!fs.existsSync(dbPath)) {
  console.error('No se encontro la BD en:', dbPath)
  process.exit(1)
}

const db = new Database(dbPath)
console.log('BD encontrada:', dbPath)

// ── EAN-13 ────────────────────────────────────────
function calcularDigitoEAN13(doce) {
  if (doce.length !== 12) return '0'
  let suma = 0
  for (let i = 0; i < 12; i++) {
    const d = parseInt(doce[i])
    if (isNaN(d)) return '0'
    suma += d * (i % 2 === 0 ? 1 : 3)
  }
  const resto = suma % 10
  return String(resto === 0 ? 0 : 10 - resto)
}

function generarEAN13(productoId, varianteId) {
  const pPart = String(Number(productoId)).padStart(5, '0').slice(-5)
  const vPart = String(Number(varianteId)).padStart(5, '0').slice(-5)
  const doce  = '10' + pPart + vPart
  return doce + calcularDigitoEAN13(doce)
}

// ── HELPERS ───────────────────────────────────────
function insertarProducto(nombre, categoria, colegio, genero, variantes) {
  const r = db.prepare(`
    INSERT INTO productos (nombre, categoria, colegio, genero)
    VALUES (?, ?, ?, ?)
  `).run(nombre, categoria, colegio, genero)

  const productoId   = r.lastInsertRowid
  const insertVar    = db.prepare(`INSERT INTO producto_variantes (producto_id, talla, precio, cantidad, stock_minimo, codigo_barras) VALUES (?, ?, ?, 10, 8, 'TEMP')`)
  const updateCodigo = db.prepare(`UPDATE producto_variantes SET codigo_barras = ? WHERE id = ?`)

  for (const v of variantes) {
    const vr = insertVar.run(productoId, v.talla, v.precio)
    updateCodigo.run(generarEAN13(productoId, vr.lastInsertRowid), vr.lastInsertRowid)
  }
  console.log(`  + ${nombre} (${colegio}) — ${variantes.length} variantes`)
}

function existe(nombre, colegio) {
  return db.prepare('SELECT id FROM productos WHERE nombre = ? AND colegio = ?').get(nombre, colegio)
}

function ins(nombre, categoria, colegio, genero, variantes) {
  if (existe(nombre, colegio)) { console.log(`  (ya existe) ${nombre} — ${colegio}`); return }
  insertarProducto(nombre, categoria, colegio, genero, variantes)
}

// ── COLEGIOS ──────────────────────────────────────
for (const c of ['La Presentacion', 'San Carlos', 'Guanenta', 'San Vicente']) {
  if (!db.prepare('SELECT id FROM colegios WHERE nombre = ?').get(c))
    db.prepare('INSERT INTO colegios (nombre) VALUES (?)').run(c)
}

// ── CATEGORIAS ────────────────────────────────────
const cats = [
  'Blusas', 'Guayaberas', 'Faldas', 'Pantalones', 'Bermuda',
  'Sudadera Camiseta', 'Sudadera Pantalon', 'Sudadera Pantaloneta',
  'Sudadera 3 Piezas', 'Busos', 'Batas', 'Jardinera', 'Correas', 'Corbatas'
]
for (const c of cats) {
  if (!db.prepare('SELECT id FROM categorias_producto WHERE nombre = ?').get(c))
    db.prepare('INSERT INTO categorias_producto (nombre) VALUES (?)').run(c)
}

console.log('\n=== INSERTANDO PRODUCTOS ===')

// ══════════════════════════════════════════════════
// LA PRESENTACION
// ══════════════════════════════════════════════════
console.log('\n-- La Presentacion --')

ins('Blusa Diario', 'Blusas', 'La Presentacion', 'Mujer', [
  { talla: '6-8',   precio: 44000 },
  { talla: '10-12', precio: 46000 },
  { talla: '14-16', precio: 48000 },
  { talla: 'XS-S',  precio: 50000 },
  { talla: 'M-L',   precio: 53000 },
  { talla: 'XL',    precio: 56000 },
  { talla: 'XXL',   precio: 66000 },
])

ins('Blusa Gala', 'Blusas', 'La Presentacion', 'Mujer', [
  { talla: '6-8',   precio: 52000 },
  { talla: '10-12', precio: 55000 },
  { talla: '14-16', precio: 58000 },
  { talla: 'XS-S',  precio: 59000 },
  { talla: 'M-L',   precio: 62000 },
  { talla: 'XL',    precio: 65000 },
  { talla: 'XXL',   precio: 66000 },
])

ins('Guayabera Diario', 'Guayaberas', 'La Presentacion', 'Hombre', [
  { talla: '6-8',   precio: 53000 },
  { talla: '10-12', precio: 57000 },
  { talla: '14-16', precio: 59000 },
  { talla: 'XS-S',  precio: 62000 },
  { talla: 'M-L',   precio: 64000 },
  { talla: 'XL',    precio: 66000 },
  { talla: 'XXL',   precio: 70000 },
])

ins('Guayabera Gala', 'Guayaberas', 'La Presentacion', 'Hombre', [
  { talla: '6-8',   precio: 54000 },
  { talla: '10-12', precio: 54000 },
  { talla: '14-16', precio: 55000 },
  { talla: 'XS-S',  precio: 62000 },
  { talla: 'M-L',   precio: 62000 },
  { talla: 'XL',    precio: 62000 },
  { talla: 'XXL',   precio: 65000 },
])

ins('Falda', 'Faldas', 'La Presentacion', 'Mujer', [
  { talla: '4-6-8', precio: 54000 },
  { talla: '10-12', precio: 56000 },
  { talla: '14-16', precio: 60000 },
  { talla: 'S',     precio: 64000 },
  { talla: 'M',     precio: 66000 },
  { talla: 'L',     precio: 68000 },
  { talla: 'XL',    precio: 74000 },
])

ins('Pantalon Colegial', 'Pantalones', 'La Presentacion', 'Hombre', [
  { talla: '4-6',   precio: 45000 },
  { talla: '8-10',  precio: 45000 },
  { talla: '12',    precio: 45000 },
  { talla: '14-16', precio: 47000 },
  { talla: '28-30', precio: 51000 },
  { talla: '32-34', precio: 53000 },
  { talla: '36-38', precio: 54000 },
  { talla: '40',    precio: 56000 },
])

ins('Bermuda', 'Bermuda', 'La Presentacion', 'Unisex', [
  { talla: '6-10',  precio: 30000 },
  { talla: '12-14', precio: 35000 },
])

ins('Sudadera Camiseta', 'Sudadera Camiseta', 'La Presentacion', 'Unisex', [
  { talla: '6-8',   precio: 46000 },
  { talla: '10-12', precio: 48000 },
  { talla: '14-16', precio: 50000 },
  { talla: 'XS-S',  precio: 52000 },
  { talla: 'M',     precio: 57000 },
  { talla: 'L',     precio: 60000 },
  { talla: 'XL',    precio: 62000 },
  { talla: 'XXL',   precio: 65000 },
])

ins('Sudadera Pantalon', 'Sudadera Pantalon', 'La Presentacion', 'Unisex', [
  { talla: '6-8',   precio: 47000 },
  { talla: '10-12', precio: 49000 },
  { talla: '14-16', precio: 52000 },
  { talla: 'XS-S',  precio: 58000 },
  { talla: 'M',     precio: 60000 },
  { talla: 'L',     precio: 62000 },
  { talla: 'XL',    precio: 65000 },
  { talla: 'XXL',   precio: 73000 },
])

ins('Sudadera Pantaloneta', 'Sudadera Pantaloneta', 'La Presentacion', 'Unisex', [
  { talla: '6-8',   precio: 25000 },
  { talla: '10-12', precio: 25000 },
  { talla: '14-16', precio: 28000 },
  { talla: 'XS-S',  precio: 32000 },
  { talla: 'M',     precio: 35000 },
  { talla: 'L',     precio: 37000 },
  { talla: 'XL',    precio: 42000 },
  { talla: 'XXL',   precio: 45000 },
])

ins('Sudadera 3 Piezas', 'Sudadera 3 Piezas', 'La Presentacion', 'Unisex', [
  { talla: '6-8',   precio: 98000 },
  { talla: '10-12', precio: 103000 },
  { talla: '14-16', precio: 110000 },
  { talla: 'XS-S',  precio: 116000 },
  { talla: 'M',     precio: 123000 },
  { talla: 'L',     precio: 137000 },
  { talla: 'XL',    precio: 142000 },
  { talla: 'XXL',   precio: 150000 },
])

ins('Buso', 'Busos', 'La Presentacion', 'Unisex', [
  { talla: '8-10',  precio: 65000 },
  { talla: '12-14', precio: 65000 },
  { talla: '16',    precio: 69000 },
  { talla: 'XS-S',  precio: 69000 },
  { talla: 'M',     precio: 70000 },
  { talla: 'L-XL',  precio: 78000 },
])

ins('Bata Manga Corta', 'Batas', 'La Presentacion', 'Unisex', [
  { talla: '10-12', precio: 45000 },
  { talla: '14-16', precio: 45000 },
  { talla: 'XS-S',  precio: 45000 },
  { talla: 'M-L',   precio: 48000 },
])

ins('Bata Manga Larga', 'Batas', 'La Presentacion', 'Unisex', [
  { talla: '10-12', precio: 55000 },
  { talla: '14-16', precio: 55000 },
  { talla: 'XS-S',  precio: 55000 },
  { talla: 'M-L',   precio: 60000 },
])

// ══════════════════════════════════════════════════
// SAN CARLOS
// ══════════════════════════════════════════════════
console.log('\n-- San Carlos --')

ins('Blusa Diario', 'Blusas', 'San Carlos', 'Mujer', [
  { talla: '6-8',   precio: 48000 },
  { talla: '10-12', precio: 50000 },
  { talla: '14-16', precio: 52000 },
  { talla: 'XS-S',  precio: 54000 },
  { talla: 'M-L',   precio: 57000 },
  { talla: 'XL',    precio: 60000 },
  { talla: 'XXL',   precio: 70000 },
])

ins('Blusa Gala', 'Blusas', 'San Carlos', 'Mujer', [
  { talla: '6-8',   precio: 52000 },
  { talla: '10-12', precio: 55000 },
  { talla: '14-16', precio: 58000 },
  { talla: 'XS-S',  precio: 59000 },
  { talla: 'M-L',   precio: 62000 },
  { talla: 'XL',    precio: 65000 },
  { talla: 'XXL',   precio: 70000 },
])

ins('Guayabera Diario', 'Guayaberas', 'San Carlos', 'Hombre', [
  { talla: '6-8',   precio: 53000 },
  { talla: '10-12', precio: 57000 },
  { talla: '14-16', precio: 59000 },
  { talla: 'XS-S',  precio: 62000 },
  { talla: 'M-L',   precio: 64000 },
  { talla: 'XL',    precio: 66000 },
  { talla: 'XXL',   precio: 70000 },
])

ins('Guayabera Gala', 'Guayaberas', 'San Carlos', 'Hombre', [
  { talla: '6-8',   precio: 59000 },
  { talla: '10-12', precio: 62000 },
  { talla: '14-16', precio: 64000 },
  { talla: 'XS-S',  precio: 67000 },
  { talla: 'M-L',   precio: 69000 },
  { talla: 'XL',    precio: 70000 },
  { talla: 'XXL',   precio: 75000 },
])

ins('Falda', 'Faldas', 'San Carlos', 'Mujer', [
  { talla: '4-6-8', precio: 67000 },
  { talla: '10-12', precio: 76000 },
  { talla: '14-16', precio: 79000 },
  { talla: 'S',     precio: 82000 },
  { talla: 'M',     precio: 83000 },
  { talla: 'L',     precio: 85000 },
  { talla: 'XL',    precio: 90000 },
])

ins('Pantalon', 'Pantalones', 'San Carlos', 'Hombre', [
  { talla: '4-6-8', precio: 67000 },
  { talla: '10-12', precio: 76000 },
  { talla: '14-16', precio: 79000 },
  { talla: '28-30', precio: 82000 },
  { talla: '32-34', precio: 86000 },
  { talla: '36-38', precio: 92000 },
  { talla: '40',    precio: 97000 },
])

ins('Sudadera Camiseta', 'Sudadera Camiseta', 'San Carlos', 'Unisex', [
  { talla: '6-8',   precio: 46000 },
  { talla: '10-12', precio: 48000 },
  { talla: '14-16', precio: 50000 },
  { talla: 'XS-S',  precio: 52000 },
  { talla: 'M',     precio: 57000 },
  { talla: 'L',     precio: 60000 },
  { talla: 'XL',    precio: 62000 },
  { talla: 'XXL',   precio: 65000 },
])

ins('Sudadera Pantalon', 'Sudadera Pantalon', 'San Carlos', 'Unisex', [
  { talla: '6-8',   precio: 54000 },
  { talla: '10-12', precio: 56000 },
  { talla: '14-16', precio: 59000 },
  { talla: 'XS-S',  precio: 64000 },
  { talla: 'M',     precio: 68000 },
  { talla: 'L',     precio: 70000 },
  { talla: 'XL',    precio: 75000 },
  { talla: 'XXL',   precio: 80000 },
])

ins('Sudadera Pantaloneta', 'Sudadera Pantaloneta', 'San Carlos', 'Unisex', [
  { talla: '6-8',   precio: 25000 },
  { talla: '10-12', precio: 25000 },
  { talla: '14-16', precio: 28000 },
  { talla: 'XS-S',  precio: 32000 },
  { talla: 'M',     precio: 35000 },
  { talla: 'L',     precio: 37000 },
  { talla: 'XL',    precio: 42000 },
  { talla: 'XXL',   precio: 45000 },
])

ins('Sudadera 3 Piezas', 'Sudadera 3 Piezas', 'San Carlos', 'Unisex', [
  { talla: '6-8',   precio: 105000 },
  { talla: '10-12', precio: 100000 },
  { talla: '14-16', precio: 112000 },
  { talla: 'XS-S',  precio: 123000 },
  { talla: 'M',     precio: 130000 },
  { talla: 'L',     precio: 139000 },
  { talla: 'XL',    precio: 145000 },
  { talla: 'XXL',   precio: 153000 },
])

ins('Correa Cuero', 'Correas', 'San Carlos', 'Unisex', [
  { talla: 'Unica', precio: 22000 },
])

ins('Correa Economica', 'Correas', 'San Carlos', 'Unisex', [
  { talla: 'Unica', precio: 15000 },
])

// ══════════════════════════════════════════════════
// GUANENTA
// ══════════════════════════════════════════════════
console.log('\n-- Guanenta --')

ins('Camisa Diario', 'Blusas', 'Guanenta', 'Unisex', [
  { talla: '6-8',   precio: 50000 },
  { talla: '10-12', precio: 54000 },
  { talla: '14-16', precio: 57000 },
  { talla: 'XS-S',  precio: 60000 },
  { talla: 'M-L',   precio: 63000 },
  { talla: 'XL',    precio: 65000 },
])

ins('Camisa Gala', 'Blusas', 'Guanenta', 'Unisex', [
  { talla: '6-8',   precio: 60000 },
  { talla: '10-12', precio: 63000 },
  { talla: '14-16', precio: 66000 },
  { talla: 'XS-S',  precio: 69000 },
  { talla: 'M-L',   precio: 75000 },
  { talla: 'XL',    precio: 78000 },
])

ins('Falda', 'Faldas', 'Guanenta', 'Mujer', [
  { talla: '6-8',   precio: 43000 },
  { talla: '10-12', precio: 45000 },
  { talla: '14-16', precio: 48000 },
  { talla: 'S',     precio: 52000 },
  { talla: 'M',     precio: 55000 },
  { talla: 'L',     precio: 57000 },
  { talla: 'XL',    precio: 58000 },
  { talla: 'XXL',   precio: 62000 },
])

ins('Pantalon Colegial', 'Pantalones', 'Guanenta', 'Hombre', [
  { talla: '4-6',   precio: 45000 },
  { talla: '8-10',  precio: 45000 },
  { talla: '12',    precio: 45000 },
  { talla: '14-16', precio: 47000 },
  { talla: '28-30', precio: 51000 },
  { talla: '32-34', precio: 53000 },
  { talla: '36-38', precio: 54000 },
  { talla: '40',    precio: 56000 },
])

ins('Sudadera Camiseta', 'Sudadera Camiseta', 'Guanenta', 'Unisex', [
  { talla: '6-8',   precio: 42000 },
  { talla: '10-12', precio: 44000 },
  { talla: '14-16', precio: 45000 },
  { talla: 'XS-S',  precio: 48000 },
  { talla: 'M',     precio: 52000 },
  { talla: 'L',     precio: 55000 },
  { talla: 'XL',    precio: 58000 },
  { talla: 'XXL',   precio: 62000 },
])

ins('Sudadera Pantalon', 'Sudadera Pantalon', 'Guanenta', 'Unisex', [
  { talla: '6-8',   precio: 47000 },
  { talla: '10-12', precio: 49000 },
  { talla: '14-16', precio: 52000 },
  { talla: 'XS-S',  precio: 58000 },
  { talla: 'M',     precio: 60000 },
  { talla: 'L',     precio: 62000 },
  { talla: 'XL',    precio: 70000 },
  { talla: 'XXL',   precio: 73000 },
])

ins('Sudadera Pantaloneta', 'Sudadera Pantaloneta', 'Guanenta', 'Unisex', [
  { talla: '6-8',   precio: 25000 },
  { talla: '10-12', precio: 25000 },
  { talla: '14-16', precio: 28000 },
  { talla: 'XS-S',  precio: 32000 },
  { talla: 'M',     precio: 35000 },
  { talla: 'L',     precio: 37000 },
  { talla: 'XL',    precio: 42000 },
  { talla: 'XXL',   precio: 45000 },
])

ins('Sudadera 3 Piezas', 'Sudadera 3 Piezas', 'Guanenta', 'Unisex', [
  { talla: '6-8',   precio: 96000 },
  { talla: '10-12', precio: 101000 },
  { talla: '14-16', precio: 108000 },
  { talla: 'XS-S',  precio: 115000 },
  { talla: 'M',     precio: 120000 },
  { talla: 'L',     precio: 133000 },
  { talla: 'XL',    precio: 140000 },
  { talla: 'XXL',   precio: 146000 },
])

ins('Buso', 'Busos', 'Guanenta', 'Unisex', [
  { talla: '8-10',  precio: 65000 },
  { talla: '12-14', precio: 65000 },
  { talla: '16',    precio: 69000 },
  { talla: 'XS-S',  precio: 69000 },
  { talla: 'M',     precio: 70000 },
  { talla: 'L-XL',  precio: 78000 },
])

ins('Bata Azul', 'Batas', 'Guanenta', 'Unisex', [
  { talla: 'Unica', precio: 65000 },
])

ins('Bata Dacron Corta', 'Batas', 'Guanenta', 'Unisex', [
  { talla: '10-12', precio: 45000 },
  { talla: '14-16', precio: 45000 },
  { talla: 'M-L',   precio: 48000 },
])

ins('Correa Cuero', 'Correas', 'Guanenta', 'Unisex', [
  { talla: 'Unica', precio: 22000 },
])

ins('Correa Economica', 'Correas', 'Guanenta', 'Unisex', [
  { talla: 'Unica', precio: 15000 },
])

ins('Corbata Caucho Pequena', 'Corbatas', 'Guanenta', 'Unisex', [
  { talla: 'Unica', precio: 12000 },
])

ins('Corbata Caucho Grande', 'Corbatas', 'Guanenta', 'Unisex', [
  { talla: 'Unica', precio: 15000 },
])

ins('Corbata de Nudo', 'Corbatas', 'Guanenta', 'Unisex', [
  { talla: 'Unica', precio: 15000 },
])

// ══════════════════════════════════════════════════
// SAN VICENTE
// ══════════════════════════════════════════════════
console.log('\n-- San Vicente --')

ins('Blusa Diario', 'Blusas', 'San Vicente', 'Mujer', [
  { talla: '6-8',   precio: 41000 },
  { talla: '10-12', precio: 44000 },
  { talla: '14-16', precio: 46000 },
  { talla: 'XS-S',  precio: 48000 },
  { talla: 'M-L',   precio: 49000 },
  { talla: 'XL',    precio: 53000 },
  { talla: 'XXL',   precio: 63000 },
])

ins('Blusa Gala', 'Blusas', 'San Vicente', 'Mujer', [
  { talla: '6-8',   precio: 49000 },
  { talla: '10-12', precio: 52000 },
  { talla: '14-16', precio: 55000 },
  { talla: 'XS-S',  precio: 57000 },
  { talla: 'M-L',   precio: 59000 },
  { talla: 'XL',    precio: 60000 },
  { talla: 'XXL',   precio: 68000 },
])

ins('Guayabera Diario', 'Guayaberas', 'San Vicente', 'Hombre', [
  { talla: '6-8',   precio: 53000 },
  { talla: '10-12', precio: 57000 },
  { talla: '14-16', precio: 59000 },
  { talla: 'XS-S',  precio: 62000 },
  { talla: 'M-L',   precio: 64000 },
  { talla: 'XL',    precio: 66000 },
  { talla: 'XXL',   precio: 70000 },
])

ins('Guayabera Gala', 'Guayaberas', 'San Vicente', 'Hombre', [
  { talla: '6-8',   precio: 59000 },
  { talla: '10-12', precio: 62000 },
  { talla: '14-16', precio: 64000 },
  { talla: 'XS-S',  precio: 67000 },
  { talla: 'M-L',   precio: 69000 },
  { talla: 'XL',    precio: 70000 },
  { talla: 'XXL',   precio: 75000 },
])

ins('Jardinera', 'Jardinera', 'San Vicente', 'Mujer', [
  { talla: '8',  precio: 90000 },
  { talla: '10', precio: 96000 },
  { talla: '12', precio: 98000 },
  { talla: '14', precio: 99000 },
  { talla: '16', precio: 102000 },
  { talla: 'S',  precio: 112000 },
  { talla: 'M',  precio: 112000 },
  { talla: 'L',  precio: 115000 },
])

ins('Pantalon', 'Pantalones', 'San Vicente', 'Hombre', [
  { talla: '4-6-8', precio: 67000 },
  { talla: '10-12', precio: 76000 },
  { talla: '14-16', precio: 79000 },
  { talla: '28-30', precio: 82000 },
  { talla: '32-34', precio: 86000 },
  { talla: '36-38', precio: 92000 },
  { talla: '40',    precio: 97000 },
])

console.log('\n=== LISTO! Todos los productos insertados ===')
db.close()