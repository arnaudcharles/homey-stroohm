'use strict';

const Homey = require('homey');
const { MontaClient, MontaError } = require('../../lib/MontaClient');
const {
  normalizeCharge, mergeSessions, snapshot, prevMonthKey, round2, readEntry,
} = require('../../lib/compute');
const { buildCsv, summarize } = require('../../lib/csv');
const { tariffFromSettings, applyTariff, averagePrice } = require('../../lib/tariff');
const { pick } = require('../../lib/i18n');
const { capId } = require('../../lib/capabilities');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TARIFF_KEYS = ['cost_mode', 'price_fixed', 'price_day', 'price_night', 'night_profile', 'night_share',
  'offpeak_start', 'offpeak_end', 'offpeak_weekend'];
const HOURLY_PER_RUN = 40; // hourly-consumption calls per refresh (first run catches up over a few refreshes)
const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/; // "2025" (whole year) or "2025-03"

module.exports = class StroohmDevice extends Homey.Device {
  async onInit() {
    this._busy = false;
    this._client = null;
    this._snap = null;
    await this._migrateCapabilities();
    await this._recompute({ fire: false }).catch((e) => this.error('initial compute', e.message));
    this._schedule();
    this.homey.setTimeout(() => this.refresh().catch((e) => this.error('refresh', e.message)), 3000);
  }

  async _migrateCapabilities() {
    const wanted = this.driver.manifest.capabilities;
    // Never let a capability change block the device init (a failure is retried at next start).
    const safe = (fn, c) => fn.call(this, c).catch((e) => this.error(`capability ${c}:`, e.message));
    for (const c of this.getCapabilities()) if (!wanted.includes(c)) await safe(this.removeCapability, c);
    for (const c of wanted) if (!this.hasCapability(c)) await safe(this.addCapability, c);
  }

  _schedule() {
    if (this._timer) this.homey.clearInterval(this._timer);
    const min = Math.max(15, Number(this.getSetting('refresh_interval')) || 60);
    this._timer = this.homey.setInterval(() => this.refresh().catch((e) => this.error('refresh', e.message)), min * 60000);
  }

  async onSettings({ changedKeys }) {
    if (changedKeys.includes('refresh_interval')) this._schedule();
    // Once the new settings are persisted: load hourly data if the tariff now needs it, then recompute.
    const tariffChanged = changedKeys.some((k) => TARIFF_KEYS.includes(k));
    this.homey.setTimeout(async () => {
      try {
        if (tariffChanged) await this._loadHourly();
        await this._recompute({ fire: false });
      } catch (e) {
        this.error('settings', e.message);
      }
    }, 500);
  }

  async onDeleted() {
    if (this._timer) this.homey.clearInterval(this._timer);
  }

  async onUninit() {
    if (this._timer) this.homey.clearInterval(this._timer);
  }

  // ---- credentials ------------------------------------------------------------------------------

  async updateCredentials(clientId, clientSecret, tokens) {
    await this.setStoreValue('clientId', clientId);
    await this.setStoreValue('clientSecret', clientSecret);
    await this.setStoreValue('tokens', tokens);
    this._client = null;
    await this.setAvailable();
    await this.refresh();
  }

  _getClient() {
    if (!this._client) {
      this._client = new MontaClient({
        clientId: this.getStoreValue('clientId'),
        clientSecret: this.getStoreValue('clientSecret'),
        tokens: this.getStoreValue('tokens'),
        onTokens: (t) => { this.setStoreValue('tokens', t).catch(() => {}); },
        userAgent: `StroohmRefund-Homey/${this.homey.app.manifest.version}`,
      });
    }
    return this._client;
  }

  // ---- sync -------------------------------------------------------------------------------------

  async refresh() {
    if (this._busy) return;
    this._busy = true;
    try {
      const last = this.getStoreValue('lastSync');
      const stored = this.getStoreValue('sessions') || [];
      // Re-read the last 3 days so that sessions that were running at the previous sync get completed.
      // Full re-read once if older records predate the charge id (needed for hourly consumption).
      const full = !last || stored.some((x) => x.id === undefined);
      const fromDate = full ? undefined : new Date(Date.parse(last) - 3 * 86400000).toISOString();
      const raw = await this._getClient().listCharges({ fromDate });
      const merged = mergeSessions(stored, raw.map(normalizeCharge));
      await this.setStoreValue('sessions', merged);
      await this.setStoreValue('lastSync', new Date().toISOString());
      await this._loadHourly();
      await this.setAvailable();
      await this.unsetWarning().catch(() => {});
      await this._recompute({ fire: true });
    } catch (err) {
      await this._onSyncError(err);
    } finally {
      this._busy = false;
    }
  }

  async _onSyncError(err) {
    const code = err instanceof MontaError ? err.code : 'UNKNOWN';
    this.error('sync failed:', code, err.message);
    if (code === 'INVALID_CREDENTIALS' || code === 'FORBIDDEN') {
      await this.setUnavailable(pick(this.homey, {
        en: 'API credentials rejected. Open the device and use "Repair" to enter them again.',
        fr: 'Identifiants API refusés. Ouvrez l\'appareil et utilisez « Réparer » pour les saisir à nouveau.',
        nl: 'API-gegevens geweigerd. Open het apparaat en gebruik "Repareren" om ze opnieuw in te voeren.',
        de: 'API-Zugangsdaten abgelehnt. Öffnen Sie das Gerät und nutzen Sie „Reparieren“, um sie erneut einzugeben.',
        it: 'Credenziali API rifiutate. Apri il dispositivo e usa "Ripara" per inserirle di nuovo.',
      }));
    } else {
      await this.setWarning(pick(this.homey, {
        en: 'STROOHM/Monta is unreachable, showing the last known data.',
        fr: 'STROOHM/Monta est injoignable, dernières données connues affichées.',
        nl: 'STROOHM/Monta is onbereikbaar, laatst bekende gegevens getoond.',
        de: 'STROOHM/Monta ist nicht erreichbar, die zuletzt bekannten Daten werden angezeigt.',
        it: 'STROOHM/Monta non è raggiungibile, sono mostrati gli ultimi dati noti.',
      })).catch(() => {});
    }
  }

  /** Hourly consumption of home sessions, only when the tariff uses the measured day/night split. */
  async _loadHourly() {
    const tariff = this._tariff();
    if (!tariff || tariff.mode !== 'dual' || tariff.profile !== 'measured') return;
    const homeIds = this._homeIds();
    const hourly = { ...(this.getStoreValue('hourly') || {}) };
    const todo = (this.getStoreValue('sessions') || [])
      .filter((x) => x.st === 'completed' && x.id && homeIds.includes(x.cp) && x.kwh > 0 && !(x.k in hourly))
      .slice(-HOURLY_PER_RUN);
    if (!todo.length) return;
    for (const x of todo) {
      try {
        hourly[x.k] = await this._getClient().getHourlyKwh(x.id);
      } catch (err) {
        this.error('hourly', x.k, err.code || err.message);
        break; // retry on the next refresh
      }
    }
    await this.setStoreValue('hourly', hourly);
  }

  _tariff() {
    return tariffFromSettings(Object.fromEntries(TARIFF_KEYS.map((k) => [k, this.getSetting(k)])));
  }

  // ---- computation + events --------------------------------------------------------------------

  _homeIds() {
    return String(this.getSetting('home_charger_ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  _compute() {
    const since = String(this.getSetting('since') || '').trim();
    const homeIds = this._homeIds();
    const tz = this.homey.clock.getTimezone();
    const tariff = this._tariff();
    const sessions = applyTariff(this.getStoreValue('sessions') || [], {
      homeIds, tz, tariff, hourly: this.getStoreValue('hourly') || {},
    });
    return snapshot({
      sessions,
      homeIds,
      tz,
      since: DATE_RE.test(since) ? `${since}T00:00:00Z` : undefined,
      external: this.getStoreValue('external') || {},
      legacyPrice: averagePrice(tariff),
    });
  }

  _formatDate(iso) {
    if (!iso) return '-';
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: this.homey.clock.getTimezone(), dateStyle: 'short', timeStyle: 'short',
    }).format(new Date(iso));
  }

  async _recompute({ fire }) {
    const snap = this._compute();
    this._snap = snap;
    const { values } = snap;

    if (fire) await this._fireEvents(snap);

    for (const [id, raw] of Object.entries(values)) {
      const v = id === 'stroohm_last_session_date' ? this._formatDate(raw) : raw;
      const cap = capId(id);
      if (this.getCapabilityValue(cap) !== v) await this.setCapabilityValue(cap, v).catch((e) => this.error(cap, e.message));
    }
  }

  async _fireEvents(snap) {
    const homeIds = this._homeIds();
    const sessions = applyTariff(this.getStoreValue('sessions') || [], {
      homeIds, tz: this.homey.clock.getTimezone(), tariff: this._tariff(), hourly: this.getStoreValue('hourly') || {},
    });
    const flow = this.homey.flow;
    const done = sessions.filter((s) => s.st === 'completed' && s.e);
    const maxEnd = done.reduce((m, s) => (s.e > m ? s.e : m), '');
    const lastEnd = this.getStoreValue('lastEnd');

    if (lastEnd) {
      for (const s of done.filter((x) => x.e > lastEnd)) {
        if (homeIds.includes(s.cp)) {
          await flow.getDeviceTriggerCard('home_session_ended')
            .trigger(this, { kwh: round2(s.kwh), refund: round2(s.price), net: round2(s.price - s.cost) })
            .catch(this.error);
        } else {
          await flow.getDeviceTriggerCard('public_session_ended')
            .trigger(this, { kwh: round2(s.kwh), amount: round2(s.price) }).catch(this.error);
        }
      }
    }
    if (maxEnd && maxEnd !== lastEnd) await this.setStoreValue('lastEnd', maxEnd);

    const lastMonth = this.getStoreValue('lastMonth');
    if (lastMonth && lastMonth !== snap.currentMonth) {
      const closed = prevMonthKey(snap.currentMonth);
      const m = snap.months[closed];
      if (m) {
        await flow.getDeviceTriggerCard('month_closed').trigger(this, {
          month: closed, kwh: round2(m.homeKwh), due: round2(m.due),
          pending: round2(Math.max(0, m.due - (snap.paid[closed] || 0))),
        }).catch(this.error);
      }
    }
    await this.setStoreValue('lastMonth', snap.currentMonth);

    const rate = snap.values.stroohm_rate;
    const lastRate = this.getStoreValue('lastRate');
    if (rate > 0 && lastRate > 0 && Math.abs(rate - lastRate) >= 0.0005) {
      await flow.getDeviceTriggerCard('rate_changed').trigger(this, { old_rate: lastRate, new_rate: rate }).catch(this.error);
    }
    if (rate > 0) await this.setStoreValue('lastRate', rate);
  }

  // ---- user data (settings page + Flow actions) ------------------------------------------------

  getState() {
    const snap = this._snap || this._compute();
    const external = this.getStoreValue('external') || {};
    const keys = [...new Set([...Object.keys(snap.months), ...Object.keys(external)])].sort();
    return {
      name: this.getName(),
      currentMonth: snap.currentMonth,
      lastSync: this.getStoreValue('lastSync') || null,
      values: snap.values,
      ignoredExternal: snap.ignoredExternal,
      costSource: this._tariff() ? 'tariff' : 'monta',
      tariff: Object.fromEntries(TARIFF_KEYS.map((k) => [k, this.getSetting(k)])),
      months: keys.map((k) => {
        const m = snap.months[k] || {};
        const paid = snap.paid[k] || 0;
        return {
          key: k,
          kwh: round2(m.homeKwh || 0),
          due: round2(m.due || 0),
          paid: round2(paid),
          pending: round2(Math.max(0, (m.due || 0) - paid)),
          cost: round2(m.cost || 0),
          publicKwh: round2(m.publicKwh || 0),
          publicAmount: round2(m.publicAmount || 0),
          legacy: !!m.legacy,
          costKnown: !m.legacy || !!m.costKnown,
          external: readEntry(external[k]).amount,
          externalKwh: readEntry(external[k]).kwh,
          externalPublicKwh: readEntry(external[k]).publicKwh,
          externalPublicAmount: readEntry(external[k]).publicAmount,
        };
      }),
    };
  }

  /**
   * Before Monta, for a covered month ("YYYY-MM") or a whole year ("YYYY"): amount received, kWh
   * charged at home, kWh and cost of public charging (all optional). All empty / 0 removes the entry.
   */
  async setExternal({ month, amount, kwh, publicKwh, publicAmount }) {
    if (!PERIOD_RE.test(month || '')) throw new Error('Invalid period (YYYY or YYYY-MM)');
    const parse = (v) => round2(Number(String(v ?? 0).replace(',', '.')) || 0);
    const e = { amount: parse(amount), kwh: parse(kwh), publicKwh: parse(publicKwh), publicAmount: parse(publicAmount) };
    if (Object.values(e).some((v) => v < 0)) throw new Error('Invalid value');
    const ext = { ...(this.getStoreValue('external') || {}) };
    if (Object.values(e).some((v) => v > 0)) ext[month] = e; else delete ext[month];
    await this.setStoreValue('external', ext);
    await this._recompute({ fire: false });
    return this.getState();
  }

  /** Tariff settings edited from the app settings page (same keys as the device settings). */
  async setTariff(values = {}) {
    const num = (v, min, max) => {
      const n = Number(String(v ?? '').replace(',', '.'));
      if (!Number.isFinite(n) || n < min || n > max) throw new Error('Invalid value');
      return n;
    };
    const s = {};
    if (values.cost_mode !== undefined) {
      if (!['monta', 'fixed', 'dual'].includes(values.cost_mode)) throw new Error('Invalid mode');
      s.cost_mode = values.cost_mode;
    }
    if (values.night_profile !== undefined) {
      if (!['measured', 'night', 'mix', 'day', 'custom'].includes(values.night_profile)) throw new Error('Invalid profile');
      s.night_profile = values.night_profile;
    }
    for (const k of ['price_fixed', 'price_day', 'price_night']) if (values[k] !== undefined && values[k] !== '') s[k] = num(values[k], 0, 5);
    if (values.night_share !== undefined && values.night_share !== '') s.night_share = num(values.night_share, 0, 100);
    for (const k of ['offpeak_start', 'offpeak_end']) if (values[k] !== undefined && values[k] !== '') s[k] = Math.round(num(values[k], 0, 23));
    if (values.offpeak_weekend !== undefined) s.offpeak_weekend = !!values.offpeak_weekend;
    await this.setSettings(s); // setSettings does not call onSettings: refresh what depends on it here
    await this._loadHourly().catch((e) => this.error('hourly', e.message));
    await this._recompute({ fire: false });
    return this.getState();
  }

  getCsv(month) {
    const snap = this._snap || this._compute();
    return buildCsv(snap, month && MONTH_RE.test(month) ? month : undefined, this.homey.i18n.getLanguage());
  }

  /** Flow action: build the report and expose it through the "report_ready" trigger tokens. */
  async runReport(month) {
    const snap = this._snap || this._compute();
    const key = month && MONTH_RE.test(month) ? month : prevMonthKey(snap.currentMonth);
    const m = snap.months[key] || { homeKwh: 0, due: 0 };
    const paid = snap.paid[key] || 0;
    await this.homey.flow.getDeviceTriggerCard('report_ready').trigger(this, {
      month: key,
      summary: summarize(snap, key, this.homey.i18n.getLanguage()),
      csv: buildCsv(snap, snap.months[key] ? key : undefined, this.homey.i18n.getLanguage()),
      kwh: round2(m.homeKwh),
      due: round2(m.due),
      paid: round2(paid),
      pending: round2(Math.max(0, m.due - paid)),
    });
  }
};
