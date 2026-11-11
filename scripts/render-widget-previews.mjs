// Renders widgets/month/preview-{light,dark}.png (store previews of the dashboard widget).
// Usage: RESVG_FROM=<path to a package.json next to node_modules/@resvg/resvg-js> node scripts/render-widget-previews.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.RESVG_FROM || import.meta.url);
const { Resvg } = require('@resvg/resvg-js');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'widgets', 'month');
const F = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif"';
const months = [['Jun', 0.27], ['Jul', 11.21], ['Aug', 0], ['Sep', 5.91], ['Oct', 14.32], ['Nov', 57.32]];

const svg = (dark) => {
  const bg = dark ? '#1C1D21' : '#FFFFFF';
  const text = dark ? '#F2F2F2' : '#111111';
  const light = dark ? '#9A9CA3' : '#6E7076';
  const bar = dark ? '#3A3C42' : '#E2E4E8';
  const max = Math.max(...months.map((m) => m[1]));
  const bars = months.map(([k, v], i) => {
    const h = Math.max(4, (v / max) * 104);
    const x = 40 + i * 70;
    return `<rect x="${x + 12}" y="${410 - h}" width="40" height="${h}" rx="6" fill="${i === 5 ? '#0E9F7E' : bar}"/>`
      + `<text x="${x + 32}" y="436" ${F} font-size="16" fill="${light}" text-anchor="middle">${k}</text>`;
  }).join('');
  const stat = (x, label, value, color = text) => `<text x="${x}" y="196" ${F} font-size="17" fill="${light}">${label}</text>`
    + `<text x="${x}" y="226" ${F} font-size="22" font-weight="500" fill="${color}">${value}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 460">
  <rect width="480" height="460" rx="24" fill="${bg}"/>
  <text x="40" y="62" ${F} font-size="18" fill="${light}">Refund due this month</text>
  <text x="40" y="112" ${F} font-size="48" font-weight="700" fill="${text}">57.32 €</text>
  <text x="40" y="144" ${F} font-size="17" fill="${light}">Projected for the month: 171.96 €</text>
  ${stat(40, 'Home', '151.7 kWh')}${stat(185, 'Pending', '57.32 €')}${stat(330, 'Result', '−40.46 €', '#E5484D')}
  ${bars}
</svg>`;
};

for (const mode of ['light', 'dark']) {
  writeFileSync(join(out, `preview-${mode}.png`), new Resvg(svg(mode === 'dark'), { fitTo: { mode: 'width', value: 960 } }).render().asPng());
  console.log(`preview-${mode}.png`);
}
