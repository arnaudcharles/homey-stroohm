'use strict';

// Electricity cost of home sessions from the user's own tariff, instead of Monta's `cost`.
//
// Modes (device setting `cost_mode`):
//   monta  — keep Monta's cost (tariff configured in the STROOHM app)            [default]
//   fixed  — kWh × fixed price
//   dual   — day/night (Belgian "bihoraire"), with a profile (`night_profile`):
//              measured — real hourly consumption of each session (Monta API), split on the
//                         off-peak schedule; falls back to `custom` when not available yet
//              night    — 100 % night price (charges only at night)
//              mix      — 50 / 50
//              day      — 100 % day price
//              custom   — `night_share` % at night, the rest at day price
// Works for every Monta session, also those from before the app was installed: the hourly
// consumption is available in the API for past sessions too.

const PROFILE_SHARE = { night: 100, mix: 50, day: 0 };

/** Parse the settings into a normalized tariff, or null when Monta's cost must be kept. */
function tariffFromSettings(s = {}) {
  const num = (v) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const mode = s.cost_mode || 'monta';
  if (mode === 'fixed') {
    const price = num(s.price_fixed);
    return price > 0 ? { mode, price } : null;
  }
  if (mode === 'dual') {
    const day = num(s.price_day);
    const night = num(s.price_night);
    if (!(day > 0) || !(night > 0)) return null;
    const profile = s.night_profile || 'measured';
    const custom = s.night_share == null ? 80 : Math.min(100, Math.max(0, num(s.night_share)));
    return {
      mode,
      day,
      night,
      profile,
      nightShare: profile in PROFILE_SHARE ? PROFILE_SHARE[profile] : custom,
      start: s.offpeak_start == null ? 22 : Math.round(num(s.offpeak_start)) % 24, // Belgian default 22:00
      end: s.offpeak_end == null ? 7 : Math.round(num(s.offpeak_end)) % 24, //           → 07:00
      weekend: s.offpeak_weekend !== false,
    };
  }
  return null;
}

/** True when the hour starting at `date` is off-peak in timezone `tz`. */
function isOffPeak(date, tz, { start, end, weekend }) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const h = Number(parts.hour);
  if (weekend && (parts.weekday === 'Sat' || parts.weekday === 'Sun')) return true;
  if (start === end) return false;
  return start < end ? h >= start && h < end : h >= start || h < end;
}

/**
 * Cost of one session.
 * @param {{kwh:number}} s
 * @param {object} t tariff from tariffFromSettings
 * @param {Array<[string|number, number]>} [hourly] [[timestamp, kWh], ...] for the measured profile
 */
function sessionCost(s, t, tz, hourly) {
  if (t.mode === 'fixed') return s.kwh * t.price;
  if (t.profile === 'measured' && Array.isArray(hourly) && hourly.length) {
    const measured = hourly.reduce((a, [ts, v]) => a + v, 0);
    const cost = hourly.reduce((a, [ts, v]) => a + v * (isOffPeak(new Date(ts), tz, t) ? t.night : t.day), 0);
    // Hourly values may not add up exactly to the session total: price the gap at the average rate.
    return measured > 0 ? cost * (s.kwh / measured) : s.kwh * t.day;
  }
  // Fixed profile, or measured profile whose hourly data is not loaded yet (uses the custom share).
  return s.kwh * ((t.nightShare / 100) * t.night + (1 - t.nightShare / 100) * t.day);
}

/** Sessions with `cost` replaced on home sessions when a tariff is set (original list untouched). */
function applyTariff(sessions, { homeIds, tz, tariff, hourly = {} }) {
  if (!tariff) return sessions;
  return sessions.map((s) => (homeIds.includes(s.cp) && s.st === 'completed'
    ? { ...s, cost: sessionCost(s, tariff, tz, hourly[s.k]) }
    : s));
}

/**
 * Average €/kWh of a tariff, used for kWh entered by hand (before Monta: no hourly data).
 * Fixed: the price. Day/night: the chosen profile share (measured → the custom share). No tariff: null.
 */
function averagePrice(t) {
  if (!t) return null;
  if (t.mode === 'fixed') return t.price;
  return (t.nightShare / 100) * t.night + (1 - t.nightShare / 100) * t.day;
}

module.exports = { tariffFromSettings, isOffPeak, sessionCost, applyTariff, averagePrice };
