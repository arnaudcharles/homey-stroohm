'use strict';

// Monthly report as CSV, in the user's Homey language. UTF-8 BOM so Excel detects the encoding.
// Separator and decimal mark follow what Excel expects for that language:
//   en → ',' separator, '.' decimal      fr / nl / de / it (decimal comma) → ';' separator, ',' decimal
//   (Swiss users typically use de/fr/it; Excel in de-CH also opens ';' files correctly)

const { round2 } = require('./compute');

const T = {
  en: {
    header: ['Month', 'Home kWh', 'Refund due (€)', 'Refunded, assumed (€)', 'Pending (€)',
      'Electricity cost (€)', 'Gain/loss (€)', 'Public kWh', 'Public amount (€)', 'Status'],
    legacy: 'Received before Monta',
    nothing: 'Nothing to refund',
    refunded: 'Refunded (assumed)',
    current: 'Current month',
    pending: 'Pending',
    none: (k) => `${k}: no home charging.`,
    summary: (k, kwh, due, paid, rest) => `${k}: ${kwh} kWh at home, ${due} € due, ${paid} € refunded${rest ? `, ${rest} € pending` : ''}.`,
  },
  fr: {
    header: ['Mois', 'kWh maison', 'Remboursement dû (€)', 'Remboursé estimé (€)', 'En attente (€)',
      'Coût électricité (€)', 'Gain/perte (€)', 'kWh publics', 'Montant public (€)', 'Statut'],
    legacy: 'Reçu avant Monta',
    nothing: 'Rien à rembourser',
    refunded: 'Remboursé (estimé)',
    current: 'Mois en cours',
    pending: 'En attente',
    none: (k) => `${k} : aucune recharge à domicile.`,
    summary: (k, kwh, due, paid, rest) => `${k} : ${kwh} kWh à domicile, ${due} € dus, ${paid} € remboursés${rest ? `, ${rest} € en attente` : ''}.`,
  },
  nl: {
    header: ['Maand', 'kWh thuis', 'Verschuldigde terugbetaling (€)', 'Terugbetaald, verondersteld (€)', 'In afwachting (€)',
      'Elektriciteitskost (€)', 'Winst/verlies (€)', 'Openbare kWh', 'Openbaar bedrag (€)', 'Status'],
    legacy: 'Ontvangen vóór Monta',
    nothing: 'Niets terug te betalen',
    refunded: 'Terugbetaald (verondersteld)',
    current: 'Huidige maand',
    pending: 'In afwachting',
    none: (k) => `${k}: geen thuisladen.`,
    summary: (k, kwh, due, paid, rest) => `${k}: ${kwh} kWh thuis, ${due} € verschuldigd, ${paid} € terugbetaald${rest ? `, ${rest} € in afwachting` : ''}.`,
  },
  de: {
    header: ['Monat', 'kWh zu Hause', 'Fällige Rückerstattung (€)', 'Erstattet, angenommen (€)', 'Ausstehend (€)',
      'Stromkosten (€)', 'Gewinn/Verlust (€)', 'Öffentliche kWh', 'Öffentlicher Betrag (€)', 'Status'],
    legacy: 'Vor Monta erhalten',
    nothing: 'Nichts zu erstatten',
    refunded: 'Erstattet (angenommen)',
    current: 'Laufender Monat',
    pending: 'Ausstehend',
    none: (k) => `${k}: kein Laden zu Hause.`,
    summary: (k, kwh, due, paid, rest) => `${k}: ${kwh} kWh zu Hause, ${due} € fällig, ${paid} € erstattet${rest ? `, ${rest} € ausstehend` : ''}.`,
  },
  it: {
    header: ['Mese', 'kWh a casa', 'Rimborso dovuto (€)', 'Rimborsato, stimato (€)', 'In attesa (€)',
      'Costo elettricità (€)', 'Guadagno/perdita (€)', 'kWh pubblici', 'Importo pubblico (€)', 'Stato'],
    legacy: 'Ricevuto prima di Monta',
    nothing: 'Niente da rimborsare',
    refunded: 'Rimborsato (stimato)',
    current: 'Mese in corso',
    pending: 'In attesa',
    none: (k) => `${k}: nessuna ricarica a casa.`,
    summary: (k, kwh, due, paid, rest) => `${k}: ${kwh} kWh a casa, ${due} € dovuti, ${paid} € rimborsati${rest ? `, ${rest} € in attesa` : ''}.`,
  },
};

const fmt = (lang) => {
  const t = T[lang] || T.en;
  const comma = lang !== 'en' && T[lang] !== undefined;
  const dec = (s) => (comma ? s.replace('.', ',') : s);
  return {
    t,
    sep: comma ? ';' : ',',
    num: (n) => dec(String(round2(n))),
    kwh: (n) => dec((Math.round(n * 10) / 10).toString()),
  };
};

function statusOf(t, m, paid, currentMonth, key) {
  if (m.legacy) return t.legacy;
  if (m.due <= 0.005) return t.nothing;
  if (round2(m.due - paid) <= 0.005) return t.refunded;
  return key >= currentMonth ? t.current : t.pending;
}

/** @param {{months: object, paid: object, currentMonth: string}} snap result of compute.snapshot */
function monthRow(snap, key, lang = 'en') {
  const m = snap.months[key];
  if (!m) return null;
  const { t, num, kwh } = fmt(lang);
  const paid = snap.paid[key] || 0;
  const noCost = m.legacy && !m.costKnown;
  return [
    key,
    kwh(m.homeKwh),
    num(m.due),
    num(paid),
    num(Math.max(0, m.due - paid)),
    noCost ? '' : num(m.cost),
    noCost ? '' : num(m.due - m.cost),
    kwh(m.publicKwh),
    num(m.publicAmount),
    statusOf(t, m, paid, snap.currentMonth, key),
  ];
}

/** Full CSV (all months, oldest first) or a single month when `onlyKey` is given. */
function buildCsv(snap, onlyKey, lang = 'en') {
  const { t, sep } = fmt(lang);
  const keys = onlyKey ? [onlyKey] : Object.keys(snap.months).sort();
  const rows = keys.map((k) => monthRow(snap, k, lang)).filter(Boolean);
  return `﻿${[t.header, ...rows].map((r) => r.join(sep)).join('\r\n')}\r\n`;
}

/** One-line human summary of a month, for Flow tokens / notifications. */
function summarize(snap, key, lang = 'en') {
  const { t, num, kwh } = fmt(lang);
  const m = snap.months[key];
  if (!m) return t.none(key);
  const paid = snap.paid[key] || 0;
  const rest = Math.max(0, m.due - paid);
  return t.summary(key, kwh(m.homeKwh), num(m.due), num(paid), rest > 0.005 ? num(rest) : null);
}

module.exports = { buildCsv, summarize, monthRow };
