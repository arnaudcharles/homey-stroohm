'use strict';
// Generates .homeycompose/capabilities/*.json from the table below. Run: node scripts/gen-capabilities.js

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '.homeycompose', 'capabilities');
fs.mkdirSync(dir, { recursive: true });

// id: [type, unit, decimals, en, fr, nl]
const caps = {
  stroohm_home_kwh_month: ['kwh', 'kWh', 'Home charging this month', 'Recharge maison ce mois', 'Thuislading deze maand'],
  stroohm_home_kwh_prev_month: ['kwh', 'kWh', 'Home charging last month', 'Recharge maison mois dernier', 'Thuislading vorige maand'],
  stroohm_home_kwh_year: ['kwh', 'kWh', 'Home charging this year', 'Recharge maison cette année', 'Thuislading dit jaar'],
  stroohm_home_kwh_total: ['kwh', 'kWh', 'Home charging total', 'Recharge maison total', 'Thuislading totaal'],
  stroohm_refund_due_month: ['eur', '€', 'Refund due this month', 'Remboursement dû ce mois', 'Terugbetaling verschuldigd deze maand'],
  stroohm_refund_due_prev_month: ['eur', '€', 'Refund due last month', 'Remboursement dû mois dernier', 'Terugbetaling verschuldigd vorige maand'],
  stroohm_refund_due_year: ['eur', '€', 'Refund due this year', 'Remboursement dû cette année', 'Terugbetaling verschuldigd dit jaar'],
  stroohm_refund_due_total: ['eur', '€', 'Refund due total', 'Remboursement dû total', 'Terugbetaling verschuldigd totaal'],
  stroohm_refund_pending: ['eur', '€', 'Refund pending', 'Remboursement en attente', 'Terugbetaling in afwachting'],
  stroohm_refund_projection_month: ['eur', '€', 'Refund projected this month', 'Remboursement projeté ce mois', 'Verwachte terugbetaling deze maand'],
  stroohm_refund_paid_total: ['eur', '€', 'Refunded total (assumed)', 'Remboursé total (estimé)', 'Terugbetaald totaal (verondersteld)'],
  stroohm_rate: ['rate', '€/kWh', 'Refund rate', 'Taux de remboursement', 'Terugbetalingstarief'],
  stroohm_home_cost_month: ['eur', '€', 'Electricity cost this month', 'Coût électricité ce mois', 'Elektriciteitskost deze maand'],
  stroohm_cost_per_kwh_month: ['rate', '€/kWh', 'Average electricity price this month', 'Prix moyen électricité ce mois', 'Gemiddelde elektriciteitsprijs deze maand'],
  stroohm_net_month: ['eur', '€', 'Net result this month', 'Gain/perte ce mois', 'Nettoresultaat deze maand'],
  stroohm_net_year: ['eur', '€', 'Net result this year', 'Gain/perte cette année', 'Nettoresultaat dit jaar'],
  stroohm_net_total: ['eur', '€', 'Net result total', 'Gain/perte total', 'Nettoresultaat totaal'],
  stroohm_last_session_kwh: ['kwh', 'kWh', 'Last home session', 'Dernière session maison', 'Laatste thuissessie'],
  stroohm_last_session_refund: ['eur', '€', 'Last session refund', 'Remboursement dernière session', 'Terugbetaling laatste sessie'],
  stroohm_last_session_date: ['string', null, 'Last session date', 'Date dernière session', 'Datum laatste sessie'],
  stroohm_public_kwh_month: ['kwh', 'kWh', 'Public charging this month', 'Recharge publique ce mois', 'Openbaar laden deze maand'],
  stroohm_public_amount_month: ['eur', '€', 'Public charging cost this month', 'Coût recharge publique ce mois', 'Kost openbaar laden deze maand'],
  stroohm_public_kwh_year: ['kwh', 'kWh', 'Public charging this year', 'Recharge publique cette année', 'Openbaar laden dit jaar'],
  stroohm_public_amount_year: ['eur', '€', 'Public charging cost this year', 'Coût recharge publique cette année', 'Kost openbaar laden dit jaar'],
  stroohm_public_kwh_total: ['kwh', 'kWh', 'Public charging total', 'Recharge publique total', 'Openbaar laden totaal'],
  stroohm_public_amount_total: ['eur', '€', 'Public charging cost total', 'Coût recharge publique total', 'Kost openbaar laden totaal'],
  stroohm_home_share_month: ['pct', '%', 'Home share this month', 'Part maison ce mois', 'Aandeel thuis deze maand'],
  stroohm_home_share_year: ['pct', '%', 'Home share this year', 'Part maison cette année', 'Aandeel thuis dit jaar'],
  stroohm_home_share_total: ['pct', '%', 'Home share total', 'Part maison total', 'Aandeel thuis totaal'],
};

const decimals = { kwh: 1, eur: 2, rate: 3, pct: 0 };

// Number capabilities get the `measure_` prefix: Homey only offers capabilities starting with
// `measure_` or `meter_` as device indicator ("status indicator"). `meter_` is avoided on purpose:
// Homey Energy uses meter_power. Keep in sync with capId() in lib/capabilities.js.
for (const old of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, old));
for (const [key, [kind, unit, en, fr, nl]] of Object.entries(caps)) {
  const id = ['bool', 'string'].includes(kind) ? key : `measure_${key}`;
  const title = { en, fr, nl };
  let def;
  if (kind === 'bool') {
    def = {
      type: 'boolean',
      title,
      getable: true,
      setable: false,
      uiComponent: 'sensor',
      icon: '/assets/icon.svg',
      insights: true,
      insightsTitleTrue: { en: 'Refund became overdue', fr: 'Remboursement en retard', nl: 'Terugbetaling te laat' },
      insightsTitleFalse: { en: 'Refund no longer overdue', fr: 'Remboursement plus en retard', nl: 'Terugbetaling niet meer te laat' },
      options: { greyout: false },
    };
    def.uiComponent = 'sensor';
  } else if (kind === 'string') {
    def = { type: 'string', title, getable: true, setable: false, uiComponent: 'sensor', icon: '/assets/icon.svg' };
  } else {
    def = {
      type: 'number',
      title,
      units: { en: unit },
      decimals: decimals[kind],
      getable: true,
      setable: false,
      uiComponent: 'sensor',
      icon: '/assets/icon.svg',
      insights: true,
    };
  }
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(def, null, 2)}\n`);
}
console.log(`${Object.keys(caps).length} capabilities written`);
