'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../lib/tariff');

const TZ = 'Europe/Brussels';
const BE = { start: 22, end: 7, weekend: true };
const s = { k: 'a', cp: 'h', st: 'completed', kwh: 10, cost: 9.99 };

test('no tariff (or incomplete prices) keeps Monta cost', () => {
  assert.equal(t.tariffFromSettings({}), null);
  assert.equal(t.tariffFromSettings({ cost_mode: 'fixed', price_fixed: 0 }), null);
  assert.equal(t.tariffFromSettings({ cost_mode: 'dual', price_day: 0.3 }), null);
  const out = t.applyTariff([s], { homeIds: ['h'], tz: TZ, tariff: null });
  assert.equal(out[0].cost, 9.99);
});

test('fixed price', () => {
  const tariff = t.tariffFromSettings({ cost_mode: 'fixed', price_fixed: '0,30' });
  assert.equal(t.sessionCost(s, tariff, TZ), 3);
});

test('dual price with a fixed profile', () => {
  const base = { cost_mode: 'dual', price_day: 0.4, price_night: 0.2 };
  const cost = (profile, night_share) => t.sessionCost(s, t.tariffFromSettings({ ...base, night_profile: profile, night_share }), TZ);
  assert.equal(cost('night'), 2);
  assert.equal(cost('day'), 4);
  assert.equal(Math.round(cost('mix') * 100) / 100, 3);
  assert.equal(Math.round(cost('custom', 80) * 100) / 100, 2.4);
});

test('off-peak schedule (Brussels time, weekend included)', () => {
  assert.equal(t.isOffPeak(new Date('2026-11-10T21:00:00Z'), TZ, BE), true); // Tue 22:00
  assert.equal(t.isOffPeak(new Date('2026-11-10T05:00:00Z'), TZ, BE), true); // Tue 06:00
  assert.equal(t.isOffPeak(new Date('2026-11-10T06:00:00Z'), TZ, BE), false); // Tue 07:00
  assert.equal(t.isOffPeak(new Date('2026-11-10T12:00:00Z'), TZ, BE), false); // Tue 13:00
  assert.equal(t.isOffPeak(new Date('2026-11-14T12:00:00Z'), TZ, BE), true); // Sat 13:00
  assert.equal(t.isOffPeak(new Date('2026-11-14T12:00:00Z'), TZ, { ...BE, weekend: false }), false);
});

test('measured profile prices each hour; missing data falls back to the custom share', () => {
  const tariff = t.tariffFromSettings({ cost_mode: 'dual', price_day: 0.4, price_night: 0.2, night_profile: 'measured', night_share: 50 });
  const hourly = [['2026-11-10T20:00:00Z', 4], ['2026-11-10T21:00:00Z', 6]]; // 21:00 day, 22:00 night
  assert.equal(Math.round(t.sessionCost(s, tariff, TZ, hourly) * 100) / 100, 2.8);
  assert.equal(Math.round(t.sessionCost(s, tariff, TZ, undefined) * 100) / 100, 3);
});

test('only completed home sessions are repriced', () => {
  const tariff = t.tariffFromSettings({ cost_mode: 'fixed', price_fixed: 0.3 });
  const out = t.applyTariff([s, { ...s, k: 'p', cp: 'pub' }, { ...s, k: 'c', st: 'charging' }], { homeIds: ['h'], tz: TZ, tariff });
  assert.deepEqual(out.map((x) => x.cost), [3, 9.99, 9.99]);
});

test('average price of a tariff (for kWh entered by hand)', () => {
  assert.equal(t.averagePrice(null), null);
  assert.equal(t.averagePrice(t.tariffFromSettings({ cost_mode: 'fixed', price_fixed: 0.3 })), 0.3);
  const dual = (p, sh) => t.averagePrice(t.tariffFromSettings({ cost_mode: 'dual', price_day: 0.4, price_night: 0.2, night_profile: p, night_share: sh }));
  assert.equal(dual('night'), 0.2);
  assert.equal(dual('day'), 0.4);
  assert.equal(Math.round(dual('mix') * 1000) / 1000, 0.3);
  assert.equal(Math.round(dual('custom', 80) * 1000) / 1000, 0.24);
  assert.equal(Math.round(dual('measured', 80) * 1000) / 1000, 0.24); // measured -> custom share for manual kWh
});
