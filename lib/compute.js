'use strict';

// Pure computations (no Homey dependency). See API_NOTES.md in the kit for field semantics:
//  - on the home charge point, `price` = refund due by the employer, `cost` = electricity cost
//    (Monta's, from the tariff set in the STROOHM app, or ours when a tariff is set — see tariff.js)
//  - other charge points are paid by the company card: informational only
//
// Payment model (no manual confirmation): Monta pays the accumulated balance on the 1st of each
// month, so every month before the current one is assumed refunded, and the current month is pending.
// Amounts received before Monta are entered by the user per month ("YYYY-MM") or per year ("YYYY").

const EPS = 0.005;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** "2026-11" for an ISO instant, in the given IANA timezone. */
function monthKey(iso, tz) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(new Date(iso));
}

function prevMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Day of month and number of days of the month of `now`, in the given timezone. */
function monthProgress(now, tz) {
  const [y, m, d] = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(now).split('-').map(Number);
  return { day: d, days: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}

/** Raw Monta charge -> compact record kept in the device store. `id` is kept as a string (exceeds 2^53). */
function normalizeCharge(raw) {
  return {
    k: raw.externalId,
    id: raw.id == null ? null : String(raw.id),
    cp: String(raw.chargePointId),
    s: raw.startedAt,
    e: raw.stoppedAt || null,
    st: raw.state,
    kwh: Number(raw.consumedKwh) || 0,
    price: Number(raw.price) || 0,
    cost: Number(raw.cost) || 0,
  };
}

/** Merge new records into an existing list, deduplicating on `k` (new wins). */
function mergeSessions(existing, incoming) {
  const map = new Map(existing.map((s) => [s.k, s]));
  for (const s of incoming) map.set(s.k, s);
  return [...map.values()].sort((a, b) => (a.s < b.s ? -1 : 1));
}

const emptyMonth = () => ({ homeN: 0, homeKwh: 0, due: 0, cost: 0, publicN: 0, publicKwh: 0, publicAmount: 0 });

/**
 * Aggregate completed sessions per month.
 * @returns {Object<string, {homeN, homeKwh, due, cost, publicN, publicKwh, publicAmount}>}
 */
function aggregateMonths(sessions, { homeIds, tz, since }) {
  const months = {};
  for (const s of sessions) {
    if (s.st !== 'completed') continue;
    if (since && s.s < since) continue;
    const m = (months[monthKey(s.s, tz)] ??= emptyMonth());
    if (homeIds.includes(s.cp)) {
      m.homeN++;
      m.homeKwh += s.kwh;
      m.due += s.price;
      m.cost += s.cost;
    } else {
      m.publicN++;
      m.publicKwh += s.kwh;
      m.publicAmount += s.price;
    }
  }
  return months;
}

/** External entry: legacy plain number (amount) or {amount, kwh, publicKwh, publicAmount}. */
const readEntry = (raw) => {
  const o = raw && typeof raw === 'object' ? raw : { amount: raw };
  const n = (v) => round2(Number(v) || 0);
  return { amount: n(o.amount), kwh: n(o.kwh), publicKwh: n(o.publicKwh), publicAmount: n(o.publicAmount) };
};

/**
 * Data from before Monta, keyed by covered month ("YYYY-MM") or whole year ("YYYY"): amount received
 * and, optionally, kWh charged at home. Each becomes a settled `legacy` entry. When kWh are known and
 * a tariff is set, its cost is kWh × `legacyPrice` (the average price of the chosen tariff profile),
 * so gain/loss covers it too. A month that already has Monta data is left untouched (Monta is
 * authoritative) and reported in the returned list.
 */
function applyExternal(months, external, sinceKey, legacyPrice = null) {
  const ignored = [];
  for (const [k, raw] of Object.entries(external || {})) {
    const { amount, kwh, publicKwh, publicAmount } = readEntry(raw);
    if (!(amount > 0 || kwh > 0 || publicKwh > 0 || publicAmount > 0) || (sinceKey && k < sinceKey.slice(0, k.length))) continue;
    if (months[k] && (months[k].due > EPS || months[k].homeKwh > 0 || months[k].publicKwh > 0)) { ignored.push(k); continue; }
    const costKnown = kwh > 0 && legacyPrice != null;
    months[k] = {
      ...emptyMonth(),
      legacy: true,
      due: amount,
      homeKwh: kwh,
      cost: costKnown ? kwh * legacyPrice : 0,
      costKnown,
      publicKwh,
      publicAmount,
      shareKnown: publicKwh > 0, // home share only where public charging was entered too
    };
  }
  return ignored;
}

/**
 * Everything the device exposes, from the cached sessions.
 * @param {object} o
 * @param {object[]} o.sessions normalized sessions (cost already adjusted by tariff.js if needed)
 * @param {string[]} o.homeIds home charge point ids (strings)
 * @param {string} o.tz IANA timezone
 * @param {string} [o.since] ISO start of tracking
 * @param {Object<string, number|{amount:number,kwh:number}>} [o.external] before Monta, keyed "YYYY-MM" or "YYYY"
 * @param {number|null} [o.legacyPrice] average €/kWh of the user's tariff, to cost the kWh entered before Monta
 * @param {Date} [o.now]
 */
function snapshot({ sessions, homeIds, tz, since, external = {}, legacyPrice = null, now = new Date() }) {
  const months = aggregateMonths(sessions, { homeIds, tz, since });
  const ignoredExternal = applyExternal(months, external, since ? monthKey(since, tz) : null, legacyPrice);
  const cur = monthKey(now.toISOString(), tz);
  const prev = prevMonthKey(cur);
  const year = cur.slice(0, 4);
  const get = (k) => months[k] || emptyMonth();

  // Assumed refunded: every month before the current one (Monta pays on the 1st), and legacy entries.
  const paid = {};
  for (const k of Object.keys(months)) paid[k] = months[k].legacy || k < cur ? months[k].due : 0;

  const keys = Object.keys(months);
  const sum = (pred, f) => keys.filter(pred).reduce((a, k) => a + f(months[k]), 0);
  const all = () => true;
  const inYear = (k) => k.startsWith(year);
  const monta = (k) => !months[k].legacy;
  const withCost = (k) => !months[k].legacy || months[k].costKnown; // gain/loss computable

  const homeSessions = sessions
    .filter((s) => s.st === 'completed' && homeIds.includes(s.cp) && (!since || s.s >= since))
    .sort((a, b) => (a.s < b.s ? -1 : 1));
  const last = homeSessions[homeSessions.length - 1] || null;
  const lastWithRate = [...homeSessions].reverse().find((s) => s.kwh >= 1);

  const cm = get(cur);
  const { day, days } = monthProgress(now, tz);
  const homeYear = sum(inYear, (m) => m.homeKwh);
  const publicYear = sum(inYear, (m) => m.publicKwh);
  const homeAll = sum(all, (m) => m.homeKwh);
  const publicAll = sum(all, (m) => m.publicKwh);
  // Home share: only where public charging is known too (Monta, or entered before Monta), else skewed.
  const shareOk = (k) => monta(k) || months[k].shareKnown;
  const shareYear = (f) => sum((k) => inYear(k) && shareOk(k), f);
  const shareAll = (f) => sum(shareOk, f);
  const totalDue = sum(all, (m) => m.due);
  const totalPaid = Object.values(paid).reduce((a, b) => a + b, 0);

  return {
    values: {
      stroohm_home_kwh_month: round2(cm.homeKwh),
      stroohm_refund_due_month: round2(cm.due),
      stroohm_refund_projection_month: round2(day > 0 ? (cm.due / day) * days : cm.due),
      stroohm_refund_due_prev_month: round2(get(prev).due),
      stroohm_home_kwh_prev_month: round2(get(prev).homeKwh),
      stroohm_refund_pending: Math.max(0, round2(totalDue - totalPaid)),
      stroohm_refund_paid_total: round2(totalPaid),
      stroohm_refund_due_year: round2(sum(inYear, (m) => m.due)),
      stroohm_home_kwh_year: round2(homeYear),
      stroohm_refund_due_total: round2(totalDue),
      stroohm_home_kwh_total: round2(homeAll),
      stroohm_rate: lastWithRate ? Math.round((lastWithRate.price / lastWithRate.kwh) * 1e3) / 1e3 : 0,
      stroohm_home_cost_month: round2(cm.cost),
      stroohm_cost_per_kwh_month: cm.homeKwh > 0 ? Math.round((cm.cost / cm.homeKwh) * 1e3) / 1e3 : 0,
      stroohm_net_month: round2(cm.due - cm.cost),
      stroohm_net_year: round2(sum((k) => inYear(k) && withCost(k), (m) => m.due - m.cost)),
      stroohm_net_total: round2(sum(withCost, (m) => m.due - m.cost)),
      stroohm_last_session_kwh: last ? round2(last.kwh) : 0,
      stroohm_last_session_refund: last ? round2(last.price) : 0,
      stroohm_last_session_date: last ? last.e || last.s : null,
      stroohm_public_kwh_month: round2(cm.publicKwh),
      stroohm_public_amount_month: round2(cm.publicAmount),
      stroohm_public_kwh_year: round2(publicYear),
      stroohm_public_amount_year: round2(sum(inYear, (m) => m.publicAmount)),
      stroohm_public_kwh_total: round2(publicAll),
      stroohm_public_amount_total: round2(sum(all, (m) => m.publicAmount)),
      stroohm_home_share_month: pct(cm.homeKwh, cm.homeKwh + cm.publicKwh),
      stroohm_home_share_year: pct(shareYear((m) => m.homeKwh), shareYear((m) => m.homeKwh + m.publicKwh)),
      stroohm_home_share_total: pct(shareAll((m) => m.homeKwh), shareAll((m) => m.homeKwh + m.publicKwh)),
    },
    months,
    paid,
    ignoredExternal,
    currentMonth: cur,
  };
}

module.exports = {
  round2, monthKey, prevMonthKey, monthProgress, normalizeCharge, mergeSessions,
  aggregateMonths, applyExternal, readEntry, snapshot,
};
