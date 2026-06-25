const escpos = require('escpos')
escpos.USB = require('escpos-usb')

const devices = escpos.USB.findPrinter()
console.log('Impresoras encontradas por escpos-usb:', JSON.stringify(devices, null, 2))
