'use strict';
// Generates drivers/driver/driver.compose.json (capability list = every file in .homeycompose/capabilities).
// Run: node scripts/gen-driver.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const L = (en, fr, nl) => ({ en, fr, nl });

// report_ready needs a month token
const reportFile = path.join(root, '.homeycompose/flow/triggers/report_ready.json');
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
if (!report.tokens.some((t) => t.name === 'month')) {
  report.tokens.unshift({ name: 'month', type: 'string', title: L('Month', 'Mois', 'Maand'), example: '2026-10' });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
}

const caps = fs.readdirSync(path.join(root, '.homeycompose/capabilities'))
  .map((f) => f.replace('.json', '')).sort();

const driver = {
  name: L('Stroohm', 'Stroohm', 'Stroohm'),
  class: 'other',
  platforms: ['local'],
  connectivity: ['cloud'],
  capabilities: caps,
  images: {
    small: '{{driverAssetsPath}}/images/small.png',
    large: '{{driverAssetsPath}}/images/large.png',
    xlarge: '{{driverAssetsPath}}/images/xlarge.png',
  },
  pair: [
    { id: 'intro' },
    { id: 'credentials' },
    { id: 'setup' },
  ],
  repair: [{ id: 'credentials' }],
  settings: [
    {
      type: 'group',
      label: L('Synchronisation', 'Synchronisation', 'Synchronisatie'),
      children: [
        {
          id: 'refresh_interval', type: 'number', value: 60, min: 15, max: 240, units: 'min',
          label: L('Refresh interval (minutes)', 'Intervalle d\'actualisation (minutes)', 'Vernieuwingsinterval (minuten)'),
        },
        {
          id: 'home_charger_ids', type: 'text', value: '',
          label: L('Home charger id(s), comma separated', 'Id de la/des borne(s) maison, séparés par une virgule', 'Id(s) van de thuislaadpaal, gescheiden door komma'),
        },
        {
          id: 'since', type: 'text', value: '',
          label: L('Track from (YYYY-MM-DD, optional)', 'Suivre à partir du (AAAA-MM-JJ, optionnel)', 'Volgen vanaf (JJJJ-MM-DD, optioneel)'),
        },
      ],
    },
    {
      type: 'group',
      label: L('Electricity cost', 'Coût de l\'électricité', 'Elektriciteitskost'),
      children: [
        {
          id: 'cost_mode', type: 'dropdown', value: 'monta',
          label: L('Cost based on', 'Coût calculé selon', 'Kost berekend op basis van'),
          hint: L(
            'STROOHM app: the tariff set in the STROOHM app. Fixed / day-night: your own tariff, applied to every home session (also past ones).',
            'App STROOHM : le tarif encodé dans l\'app STROOHM. Fixe / jour-nuit : votre propre tarif, appliqué à toutes les sessions maison (passées comprises).',
            'STROOHM-app: het tarief ingesteld in de STROOHM-app. Vast / dag-nacht: je eigen tarief, toegepast op alle thuissessies (ook eerdere).',
          ),
          values: [
            { id: 'monta', label: L('STROOHM app tariff', 'Tarif de l\'app STROOHM', 'Tarief uit de STROOHM-app') },
            { id: 'fixed', label: L('Fixed price', 'Prix fixe', 'Vaste prijs') },
            { id: 'dual', label: L('Day / night (dual rate)', 'Jour / nuit (bihoraire)', 'Dag / nacht (tweevoudig)') },
          ],
        },
        {
          id: 'price_fixed', type: 'number', value: 0, min: 0, max: 5, step: 0.0001, units: '€/kWh',
          label: L('Fixed price', 'Prix fixe', 'Vaste prijs'),
        },
        {
          id: 'price_day', type: 'number', value: 0, min: 0, max: 5, step: 0.0001, units: '€/kWh',
          label: L('Day price (peak)', 'Prix jour (heures pleines)', 'Dagprijs (piekuren)'),
        },
        {
          id: 'price_night', type: 'number', value: 0, min: 0, max: 5, step: 0.0001, units: '€/kWh',
          label: L('Night price (off-peak)', 'Prix nuit (heures creuses)', 'Nachtprijs (daluren)'),
        },
        {
          id: 'night_profile', type: 'dropdown', value: 'measured',
          label: L('Day / night split', 'Répartition jour / nuit', 'Verdeling dag / nacht'),
          hint: L(
            'Measured: the real hour of each kWh (from STROOHM/Monta), priced on your off-peak hours. Otherwise a fixed split.',
            'Mesurée : l\'heure réelle de chaque kWh (données STROOHM/Monta), tarifée selon vos heures creuses. Sinon une répartition fixe.',
            'Gemeten: het echte uur van elke kWh (STROOHM/Monta), geprijsd volgens je daluren. Anders een vaste verdeling.',
          ),
          values: [
            { id: 'measured', label: L('Measured (recommended)', 'Mesurée (recommandé)', 'Gemeten (aanbevolen)') },
            { id: 'night', label: L('Always at night (low)', 'Toujours la nuit (bas)', 'Altijd \'s nachts (laag)') },
            { id: 'mix', label: L('50 % / 50 % (average)', '50 % / 50 % (moyen)', '50 % / 50 % (gemiddeld)') },
            { id: 'day', label: L('Always by day (high)', 'Toujours en journée (haut)', 'Altijd overdag (hoog)') },
            { id: 'custom', label: L('Custom share', 'Part personnalisée', 'Eigen verdeling') },
          ],
        },
        {
          id: 'night_share', type: 'number', value: 80, min: 0, max: 100, units: '%',
          label: L('Share charged at night (custom)', 'Part rechargée la nuit (personnalisée)', 'Aandeel \'s nachts geladen (eigen)'),
        },
        {
          id: 'offpeak_start', type: 'number', value: 22, min: 0, max: 23, units: 'h',
          label: L('Off-peak starts at', 'Heures creuses à partir de', 'Daluren vanaf'),
        },
        {
          id: 'offpeak_end', type: 'number', value: 7, min: 0, max: 23, units: 'h',
          label: L('Off-peak ends at', 'Heures creuses jusqu\'à', 'Daluren tot'),
        },
        {
          id: 'offpeak_weekend', type: 'checkbox', value: true,
          label: L('Whole weekend is off-peak', 'Week-end entier en heures creuses', 'Volledig weekend daluren'),
        },
      ],
    },
  ],
};

fs.mkdirSync(path.join(root, 'drivers/driver'), { recursive: true });
fs.writeFileSync(path.join(root, 'drivers/driver/driver.compose.json'), `${JSON.stringify(driver, null, 2)}\n`);
console.log(`driver.compose.json written (${caps.length} capabilities)`);
