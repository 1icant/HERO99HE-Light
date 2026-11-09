'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, checksum]);
}
// Code-native H mark matching the existing HTML/SVG brand, no external image.
const size = 256, stride = size * 4 + 1, pixels = Buffer.alloc(stride * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const dx = Math.max(0, 60 - x, x - (size - 61)), dy = Math.max(0, 60 - y, y - (size - 61));
  const inside = dx * dx + dy * dy <= 60 * 60;
  const h = ((x >= 77 && x <= 99) || (x >= 157 && x <= 179)) && y >= 64 && y <= 191 || x >= 77 && x <= 179 && y >= 115 && y <= 139;
  const color = h ? [27,20,40] : [197,175,255], at = y * stride + 1 + x * 4;
  pixels.set([...color, inside ? 255 : 0], at);
}
const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const icoHeader = Buffer.alloc(22); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12); icoHeader.writeUInt32LE(png.length, 14); icoHeader.writeUInt32LE(22, 18);
const assets = path.resolve(__dirname, '..', 'assets'); fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'icon.png'), png); fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([icoHeader, png]));
console.log('Generated local H icon.');
