// Embeds the real Bar Basso venue photo as a single shared global
// (window.__BB_PHOTO) in the bootstrap script of work/template.html, so every
// screen can render the same image without duplicating ~90KB of base64.
//
// Source: Wikimedia Commons "Bar Basso.jpg" by Jwslubbock, CC BY-SA 3.0.
// https://commons.wikimedia.org/wiki/File:Bar_Basso.jpg
// Idempotent: re-running replaces the existing global in place.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMG = path.join(ROOT, 'assets-src', 'bb500.jpg');
const TPL = path.join(ROOT, 'work', 'template.html');

const b64 = fs.readFileSync(IMG).toString('base64');
const dataUri = `data:image/jpeg;base64,${b64}`;
const line = `  window.__BB_PHOTO = ${JSON.stringify(dataUri)}; // Bar Basso — Wikimedia Commons, Jwslubbock, CC BY-SA 3.0`;

let tpl = fs.readFileSync(TPL, 'utf8');
if (tpl.includes('window.__BB_PHOTO')) {
  tpl = tpl.replace(/^\s*window\.__BB_PHOTO = .*$/m, line);
  console.log('Updated existing window.__BB_PHOTO');
} else {
  const anchor = '  const W = 1366, H = 1024;';
  if (!tpl.includes(anchor)) throw new Error('anchor not found in template');
  tpl = tpl.replace(anchor, anchor + '\n' + line);
  console.log('Inserted window.__BB_PHOTO');
}
fs.writeFileSync(TPL, tpl);
console.log(`photo: ${b64.length} base64 chars (~${Math.round(b64.length / 1024)}KB)`);
