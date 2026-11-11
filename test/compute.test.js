'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../lib/compute');

const TZ = 'Europe/Brussels';
const HOME = '111';
const mk = (k, cp, s, kwh, price, cost, st = 'completed') => ({ k, cp, s, e: s, st, kwh, price, cost });
const base = { homeIds: [HOME], tz: TZ };

const sessions = [
  mk('a', HOME, '2026-10-04T18:34:00Z', 23.36, 8.83, 14.77),
  mk('b', HOME, '2026-10-24T17:34:00Z', 14.53, 5.49, 6.72),
  mk('c', HOME, '2026-11-03T17:03:00Z', 26.79, 10.12, 19.16),
  mk('d', HOME, '2026-11-08T17:53:00Z', 42.07, 15.9, 27.6),
  mk('p1', '999', '2026-11-05T10:00:00Z', 30, 20, 0),
  mk('x', HOME, '2026-11-09T08:00:00Z', 5, 1.9, 3, 'charging'),
];

test('monthKey uses the Homey timezone, not UTC', () => {
  assert.equal(c.monthKey('2026-10-31T23:30:00Z', TZ), '2026-11'); // 00:30 on Nov 1st in Brussels (CET)
  assert.equal(c.monthKey('2026-03-31T22:30:00Z', TZ), '2026-04'); // CEST starts: 00:30 on Apr 1st
  assert.equal(c.monthKey('2026-10-31T22:30:00Z', TZ), '2026-10'); // still CET? 23:30 Oct 31 (CET=UTC+1)
});

test('session spanning midnight at month end is attributed to its start month', () => {
  const s = [mk('m', HOME, '2026-10-31T22:30:00Z', 10, 3.78, 5)]; // 23:30 Oct 31 Brussels
  const m = c.aggregateMonths(s, base);
  assert.deepEqual(Object.keys(m), ['2026-10']);
});

test('monthly aggregation: home vs public, non-completed excluded', () => {
  const m = c.aggregateMonths(sessions, base);
  assert.equal(c.round2(m['2026-11'].due), 26.02);
  assert.equal(c.round2(m['2026-11'].homeKwh), 68.86);
  assert.equal(m['2026-11'].homeN, 2);
  assert.equal(m['2026-11'].publicKwh, 30);
  assert.equal(c.round2(m['2026-10'].due), 14.32);
});

const NOW = new Date('2026-11-10T10:00:00Z');

test('snapshot: gain/loss, rate, pending = current month, shares', () => {
  const v = c.snapshot({ sessions, ...base, now: NOW }).values;
  assert.equal(v.stroohm_refund_due_month, 26.02);
  assert.equal(v.stroohm_refund_due_prev_month, 14.32);
  assert.equal(v.stroohm_net_month, c.round2(26.02 - 46.76));
  assert.equal(v.stroohm_rate, 0.378);
  assert.equal(v.stroohm_refund_pending, 26.02); // October assumed paid on Nov 1st
  assert.equal(v.stroohm_refund_paid_total, 14.32);
  assert.equal(v.stroohm_home_share_month, 70);
  assert.equal(v.stroohm_home_share_year, 78); // (37.89 + 68.86) / (37.89 + 68.86 + 30)
  assert.equal(v.stroohm_home_share_total, 78);
  assert.equal(v.stroohm_public_kwh_total, 30);
  assert.equal(v.stroohm_public_amount_total, 20);
  assert.equal(v.stroohm_last_session_kwh, 42.07);
  assert.equal(v.stroohm_cost_per_kwh_month, Math.round((46.76 / 68.86) * 1e3) / 1e3);
  assert.equal(v.alarm_stroohm_overdue, undefined);
});

test('projection: due so far extrapolated to the whole month', () => {
  const v = c.snapshot({ sessions, ...base, now: NOW }).values; // Nov 10th, 30 days
  assert.equal(v.stroohm_refund_projection_month, c.round2((26.02 / 10) * 30));
});

test('sessions under 1 kWh do not drive the rate', () => {
  const s = [mk('a', HOME, '2026-10-04T18:34:00Z', 20, 7.56, 8), mk('t', HOME, '2026-10-05T10:00:00Z', 0.02, 0.5, 0)];
  const v = c.snapshot({ sessions: s, ...base, now: new Date('2026-10-10T10:00:00Z') }).values;
  assert.equal(v.stroohm_rate, 0.378);
});

test('since filters earlier sessions', () => {
  const v = c.snapshot({ sessions, ...base, since: '2026-11-01T00:00:00Z', now: NOW }).values;
  assert.equal(v.stroohm_refund_due_total, 26.02);
});

test('normalizeCharge keeps the long id as a string and stringifies chargePointId', () => {
  const n = c.normalizeCharge({ id: '912345678901234567', externalId: 'u-1', chargePointId: 1234567, startedAt: 's', stoppedAt: null, state: 'completed', consumedKwh: 1.5, price: 0.5, cost: 0.7 });
  assert.equal(n.k, 'u-1');
  assert.equal(n.cp, '1234567');
  assert.equal(n.id, '912345678901234567');
});

test('mergeSessions deduplicates on k, new wins', () => {
  const m = c.mergeSessions([mk('a', HOME, '2026-10-01T00:00:00Z', 1, 1, 1, 'charging')], [mk('a', HOME, '2026-10-01T00:00:00Z', 2, 2, 2)]);
  assert.equal(m.length, 1);
  assert.equal(m[0].st, 'completed');
});

// --- Real-world case: Monta data since June, earlier payments from another platform ---
const accSessions = [
  mk('j', HOME, '2026-06-10T10:00:00Z', 0.72, 0.27, 0.2),
  mk('l', HOME, '2026-07-05T10:00:00Z', 29.63, 11.21, 20),
  mk('s', HOME, '2026-09-19T10:00:00Z', 15.63, 5.91, 7),
  mk('o', HOME, '2026-10-04T10:00:00Z', 37.89, 14.32, 20),
  mk('n', HOME, '2026-11-03T10:00:00Z', 151.69, 57.32, 97.78),
];

test('real case: pending = Monta balance, received = closed months + before Monta', () => {
  const r = c.snapshot({ sessions: accSessions, ...base, now: NOW, external: { 2025: 59.87, 2026: 151.73 } });
  const v = r.values;
  assert.equal(v.stroohm_refund_pending, 57.32);
  assert.equal(v.stroohm_refund_paid_total, 243.31);
  assert.equal(v.stroohm_refund_due_total, 300.63);
  assert.equal(v.stroohm_refund_due_year, 240.76);
  assert.equal(v.stroohm_net_month, -40.46);
});

test('before-Monta month entries become settled legacy months, without kWh', () => {
  const r = c.snapshot({ sessions: accSessions, ...base, now: NOW, external: { '2026-01': 106.28, '2026-02': 32.48 } });
  assert.equal(r.months['2026-01'].legacy, true);
  assert.equal(r.months['2026-01'].homeKwh, 0);
  assert.equal(r.paid['2026-01'], 106.28);
  assert.equal(r.values.stroohm_refund_pending, 57.32);
});

test('an entry on a month that has Monta data is ignored (Monta is authoritative)', () => {
  const r = c.snapshot({ sessions: accSessions, ...base, now: NOW, external: { '2026-07': 12 } });
  assert.deepEqual(r.ignoredExternal, ['2026-07']);
  assert.equal(r.months['2026-07'].due, 11.21);
  assert.equal(r.values.stroohm_refund_paid_total, c.round2(0.27 + 11.21 + 5.91 + 14.32));
});

test('legacy entries do not change gain/loss nor home share', () => {
  const a = c.snapshot({ sessions: accSessions, ...base, now: NOW }).values;
  const b = c.snapshot({ sessions: accSessions, ...base, now: NOW, external: { 2025: 59.87 } }).values;
  assert.equal(a.stroohm_net_year, b.stroohm_net_year);
  assert.equal(a.stroohm_net_total, b.stroohm_net_total);
  assert.equal(a.stroohm_home_share_total, b.stroohm_home_share_total);
});

test('entries before the tracking start are ignored (month and year keys)', () => {
  const r = c.snapshot({ sessions: accSessions, ...base, now: NOW, since: '2026-06-01T00:00:00Z', external: { '2026-01': 106.28, 2025: 59.87, 2026: 1 } });
  assert.equal(r.months['2026-01'], undefined);
  assert.equal(r.months['2025'], undefined);
  assert.equal(r.months['2026'].due, 1); // same year as the start: kept
});

test('kWh entered before Monta: counted in home kWh, costed with the tariff average, not in home share', () => {
  const ext = { 2025: { amount: 59.87, kwh: 160 }, '2026-01': 106.28 }; // 2026-01: old plain-number format
  const none = c.snapshot({ sessions: accSessions, ...base, now: NOW, external: ext }).values;
  const priced = c.snapshot({ sessions: accSessions, ...base, now: NOW, external: ext, legacyPrice: 0.25 });
  const v = priced.values;
  assert.equal(v.stroohm_home_kwh_total, c.round2(none.stroohm_home_kwh_total)); // kWh counted with or without tariff
  assert.equal(c.round2(v.stroohm_home_kwh_total - 235.56), 160);
  assert.equal(priced.months['2025'].cost, 40);
  assert.equal(v.stroohm_net_total, c.round2(none.stroohm_net_total + 59.87 - 40)); // 2025 now in gain/loss
  assert.equal(none.stroohm_net_total, c.round2(none.stroohm_net_total)); // without tariff: 2025 excluded
  assert.equal(priced.months['2026-01'].costKnown, false); // no kWh -> no cost
  assert.equal(v.stroohm_home_share_total, none.stroohm_home_share_total);
  assert.equal(v.stroohm_refund_paid_total, c.round2(59.87 + 106.28 + 0.27 + 11.21 + 5.91 + 14.32));
});

test('public charging entered before Monta: counted in public totals and in the home share', () => {
  const homeOnly = { 2025: { amount: 59.87, kwh: 169.5 } };
  const withPublic = { 2025: { amount: 59.87, kwh: 169.5, publicKwh: 830.5, publicAmount: 560 } };
  const a = c.snapshot({ sessions: accSessions, ...base, now: NOW, external: homeOnly }).values;
  const b = c.snapshot({ sessions: accSessions, ...base, now: NOW, external: withPublic }).values;
  assert.equal(a.stroohm_home_share_total, 100); // accSessions has no public charging: 2025 ignored in share
  assert.equal(b.stroohm_home_share_total, Math.round(((235.56 + 169.5) / (235.56 + 169.5 + 830.5)) * 100));
  assert.equal(b.stroohm_public_kwh_total, 830.5);
  assert.equal(b.stroohm_public_amount_total, 560);
  assert.equal(b.stroohm_public_kwh_year, 0); // 2025 is not this year
  assert.equal(b.stroohm_refund_paid_total, a.stroohm_refund_paid_total);
});
