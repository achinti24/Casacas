const usb = require('usb')
const devices = usb.getDeviceList()
console.log('Dispositivos USB encontrados:', devices.length)
devices.forEach(d => {
  console.log(`Vendor: 0x${d.deviceDescriptor.idVendor.toString(16)} Product: 0x${d.deviceDescriptor.idProduct.toString(16)}`)
})
