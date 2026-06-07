// Round-trip tool for the self-unpacking "__bundler" index.html artifact.
// Usage:
//   node tools/bundle.js decode   -> writes work/ with template.html + each text asset + assets.json
//   node tools/bundle.js encode   -> reads work/ and rebuilds index.html
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const WORK = path.join(ROOT, 'work');

// The three embedded payload script tags. We slice them out by their exact
// opening/closing markers rather than parsing HTML (lines are huge & minified).
const TAGS = {
  manifest: '<script type="__bundler/manifest">',
  template: '<script type="__bundler/template">',
  ext_resources: '<script type="__bundler/ext_resources">',
};
const CLOSE = '</script>';

function extract(html, openTag) {
  const start = html.indexOf(openTag);
  if (start === -1) return null;
  const contentStart = start + openTag.length;
  const end = html.indexOf(CLOSE, contentStart);
  return { contentStart, contentEnd: end, text: html.slice(contentStart, end) };
}

function decode() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const manifest = JSON.parse(extract(html, TAGS.manifest).text);
  const templateStr = JSON.parse(extract(html, TAGS.template).text); // JSON string -> raw HTML
  const extResEl = extract(html, TAGS.ext_resources);
  const extResources = extResEl ? JSON.parse(extResEl.text) : [];

  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(path.join(WORK, 'assets'), { recursive: true });

  fs.writeFileSync(path.join(WORK, 'template.html'), templateStr);

  // Decode every asset. Text-like (js/css/svg/html) get written readable so we
  // can edit them; binary (fonts/images) are left as-is in the manifest and we
  // only record metadata.
  const meta = {};
  for (const [uuid, entry] of Object.entries(manifest)) {
    let bytes = Buffer.from(entry.data, 'base64');
    if (entry.compressed) bytes = zlib.gunzipSync(bytes);
    const mime = entry.mime || '';
    const isText = /javascript|json|css|svg|html|text|babel|jsx/i.test(mime);
    meta[uuid] = { mime, compressed: !!entry.compressed, bytes: bytes.length, isText };
    if (isText) {
      fs.writeFileSync(path.join(WORK, 'assets', uuid + '.txt'), bytes);
    }
  }
  fs.writeFileSync(path.join(WORK, 'assets.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(WORK, 'ext_resources.json'), JSON.stringify(extResources, null, 2));
  console.log('Decoded', Object.keys(manifest).length, 'assets ->', WORK);
  console.log('Text assets:', Object.entries(meta).filter(([, m]) => m.isText).map(([u, m]) => `${u} (${m.mime}, ${m.bytes}b)`).join('\n  '));
}

// JSON.stringify, but escape "</" so HTML-raw-text payloads (the template &
// any text assets) can't break out of their <script> tag with a literal
// </script>. The original bundle escaped slashes the same way (</title>).
function safeStringify(obj) {
  return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

function encode() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const manifest = JSON.parse(extract(html, TAGS.manifest).text);

  // Re-inject ONLY assets whose decoded content actually changed; untouched
  // assets keep their exact original base64 (byte-identical, incl. the big
  // React/ReactDOM/Babel libs). This keeps the diff minimal and avoids
  // needless re-gzip churn. SRI is stripped at runtime, so re-gzipping an
  // edited asset is safe.
  const assetsDir = path.join(WORK, 'assets');
  let changed = 0;
  for (const f of fs.readdirSync(assetsDir)) {
    const uuid = f.replace(/\.txt$/, '');
    if (!manifest[uuid]) { console.warn('skip unknown asset', uuid); continue; }
    const fileBytes = fs.readFileSync(path.join(assetsDir, f));
    let orig = Buffer.from(manifest[uuid].data, 'base64');
    if (manifest[uuid].compressed) orig = zlib.gunzipSync(orig);
    if (orig.equals(fileBytes)) continue; // unchanged — leave original base64 intact
    const outBytes = manifest[uuid].compressed ? zlib.gzipSync(fileBytes) : fileBytes;
    manifest[uuid].data = outBytes.toString('base64');
    changed++;
    console.log('  re-encoded', uuid, `(${fileBytes.length}b)`);
  }

  // Rebuild the template tag from the edited template.html (JSON-encode it).
  const templateStr = fs.readFileSync(path.join(WORK, 'template.html'), 'utf8');

  // Splice the three payloads back into the original html, preserving everything
  // outside the tags (loader script, etc).
  let out = html;
  function replaceTag(openTag, newInner) {
    const start = out.indexOf(openTag);
    const contentStart = start + openTag.length;
    const end = out.indexOf(CLOSE, contentStart);
    out = out.slice(0, contentStart) + newInner + out.slice(end);
  }
  replaceTag(TAGS.manifest, safeStringify(manifest));
  replaceTag(TAGS.template, safeStringify(templateStr));

  fs.writeFileSync(INDEX, out);
  console.log(`Rebuilt ${INDEX} (${out.length} bytes, ${changed} asset(s) changed)`);
}

const cmd = process.argv[2];
if (cmd === 'decode') decode();
else if (cmd === 'encode') encode();
else { console.error('usage: node tools/bundle.js decode|encode'); process.exit(1); }
