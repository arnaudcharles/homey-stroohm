'use strict';
// Adds German and Italian to every {en, fr, nl} text of the compose files and builds locales/de.json
// and locales/it.json from locales/en.json, using scripts/translations.json (keyed by the English text).
// Run after gen-capabilities.js / gen-driver.js:  npm run gen
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const T = require('./translations.json');
const LANGS = ['de', 'it'];
const missing = new Set();

const tr = (en, lang) => {
  if (T[en] && T[en][lang]) return T[en][lang];
  missing.add(en);
  return en;
};

function addLangs(o) {
  if (Array.isArray(o)) return o.forEach(addLangs);
  if (!o || typeof o !== 'object') return;
  if (typeof o.en === 'string' && typeof o.fr === 'string') {
    for (const l of LANGS) o[l] = tr(o.en, l);
    return;
  }
  Object.values(o).forEach(addLangs);
}

const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (e.name.endsWith('.json')) files.push(p);
});
walk(path.join(root, '.homeycompose'));
files.push(path.join(root, 'drivers/driver/driver.compose.json'));
if (fs.existsSync(path.join(root, 'widgets'))) {
  for (const w of fs.readdirSync(path.join(root, 'widgets'))) {
    const f = path.join(root, 'widgets', w, 'widget.compose.json');
    if (fs.existsSync(f)) files.push(f);
  }
}
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  addLangs(j);
  fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
}

const en = JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8'));
for (const l of LANGS) {
  const map = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'object' ? map(v) : tr(v, l)]));
  const { lang, ...texts } = en; // eslint-disable-line no-unused-vars
  const out = { lang: l, ...map(texts) };
  fs.writeFileSync(path.join(root, `locales/${l}.json`), `${JSON.stringify(out, null, 2)}\n`);
}

if (missing.size) {
  console.error(`Missing translations (${missing.size}):\n${[...missing].map((s) => `  ${JSON.stringify(s)}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`de/it added to ${files.length} compose files and locales`);
}
