'use strict';
const ORIGIN = 'hero-light://studio';
const ENTRY = ORIGIN + '/';
const ROUTES = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/layout.js': ['layout.js', 'text/javascript; charset=utf-8'],
  '/core.js': ['core.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/desktop.js': ['desktop.js', 'text/javascript; charset=utf-8']
});
const CSP = "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'";
function trustedOrigin(raw) {
  try { const u = new URL(raw); return u.protocol === 'hero-light:' && u.hostname === 'studio' && !u.port && !u.username && !u.password; }
  catch { return false; }
}
function route(raw, method = 'GET') {
  if (!trustedOrigin(raw) || !['GET', 'HEAD'].includes(method)) return null;
  return ROUTES[new URL(raw).pathname] || null;
}
function matchesDevice(device) {
  if (device.vendorId !== 0x372e || device.productId !== 0x103e) return false;
  const name = String(device.name || device.productName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^(AULA)?HERO99(HE)?$/.test(name)) return false;
  function collection(list) {
    return (list || []).some(c => (c.usagePage === 0xff60 && c.usage === 0x61 && (c.outputReports || []).some(r =>
      r.reportId === 9 && (r.items || []).reduce((n, i) => n + i.reportCount * i.reportSize, 0) === 504)) || collection(c.children));
  }
  return collection(device.collections);
}
function allowedRequest(url) {
  return trustedOrigin(url) || url.startsWith('data:image/') || url.startsWith('blob:' + ORIGIN + '/');
}
module.exports = { ORIGIN, ENTRY, ROUTES, CSP, trustedOrigin, route, matchesDevice, allowedRequest };
