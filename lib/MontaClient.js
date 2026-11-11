'use strict';

const BASE_URL = 'https://public-api.monta.com/api/v1';
const TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const PER_PAGE = 100; // API caps perPage at 100 silently

class MontaError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'MontaError';
    this.status = status;
    this.code = code; // 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'NETWORK' | 'SERVER' | 'UNKNOWN'
  }
}

/**
 * Ids such as 907326870275336990 exceed 2^53 and are corrupted by JSON.parse.
 * Quote any long integer value of an `...id` key so it stays a string.
 */
function parseJson(text) {
  return JSON.parse(text.replace(/"(\w*[iI]d)"\s*:\s*(\d{16,})/g, '"$1":"$2"'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MontaClient {
  /**
   * @param {object} o
   * @param {string} o.clientId
   * @param {string} o.clientSecret
   * @param {object} [o.tokens] previously stored {accessToken, refreshToken, accessExpiresAt, refreshExpiresAt}
   * @param {(tokens: object) => void} [o.onTokens] called whenever tokens change (to persist them)
   * @param {string} [o.userAgent]
   * @param {Function} [o.fetchImpl] for tests
   */
  constructor({ clientId, clientSecret, tokens = null, onTokens = () => {}, userAgent = 'StroohmRefund-Homey', fetchImpl = fetch }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokens = tokens;
    this.onTokens = onTokens;
    this.userAgent = userAgent;
    this.fetch = fetchImpl;
  }

  async _raw(method, path, { query, body, auth = true } = {}) {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers: {
            Accept: 'application/json',
            'User-Agent': this.userAgent,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(auth ? { Authorization: `Bearer ${this.tokens.accessToken}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new MontaError(`Network error: ${err.message}`, { code: 'NETWORK' });
      }

      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
        continue;
      }

      const text = await res.text();
      let json = null;
      try { json = text ? parseJson(text) : null; } catch (e) { /* non-JSON error body */ }
      if (res.ok) return json;

      const apiCode = json && json.errorCode;
      if (res.status === 401) {
        throw new MontaError((json && json.message) || 'Unauthorized', {
          status: 401,
          code: apiCode === 'APPLICATION_NOT_FOUND' ? 'INVALID_CREDENTIALS' : 'TOKEN_EXPIRED',
        });
      }
      if (res.status === 403) throw new MontaError((json && json.message) || 'Forbidden', { status: 403, code: 'FORBIDDEN' });
      throw new MontaError((json && json.message) || `HTTP ${res.status}`, { status: res.status, code: res.status >= 500 ? 'SERVER' : 'UNKNOWN' });
    }
  }

  _store(json) {
    this.tokens = {
      accessToken: json.accessToken,
      refreshToken: json.refreshToken,
      accessExpiresAt: json.accessTokenExpirationDate,
      refreshExpiresAt: json.refreshTokenExpirationDate,
    };
    this.onTokens(this.tokens);
  }

  async authenticate() {
    this._store(await this._raw('POST', '/auth/token', { auth: false, body: { clientId: this.clientId, clientSecret: this.clientSecret } }));
  }

  async _ensureToken() {
    const t = this.tokens;
    const soon = Date.now() + 60000;
    if (t && t.accessToken && Date.parse(t.accessExpiresAt) > soon) return;
    if (t && t.refreshToken && Date.parse(t.refreshExpiresAt) > soon) {
      try {
        this._store(await this._raw('POST', '/auth/refresh', { auth: false, body: { refreshToken: t.refreshToken } }));
        return;
      } catch (err) {
        if (err.code !== 'TOKEN_EXPIRED' && err.code !== 'UNKNOWN') throw err;
      }
    }
    await this.authenticate();
  }

  /** GET with automatic token handling and one re-auth on an unexpected 401. */
  async get(path, query) {
    await this._ensureToken();
    try {
      return await this._raw('GET', path, { query });
    } catch (err) {
      if (err.code !== 'TOKEN_EXPIRED') throw err;
      await this.authenticate();
      return this._raw('GET', path, { query });
    }
  }

  /** All pages of a list endpoint. `meta.totalPageCount` drives the loop. */
  async getAll(path, query = {}) {
    const items = [];
    for (let page = 0; ; page++) {
      const res = await this.get(path, { ...query, page, perPage: PER_PAGE });
      items.push(...(res.data || []));
      if (!res.meta || page + 1 >= res.meta.totalPageCount) break;
    }
    return items;
  }

  listCharges({ fromDate, chargePointId } = {}) {
    return this.getAll('/charges', { fromDate, chargePointId });
  }

  listChargePoints() {
    return this.getAll('/charge-points');
  }

  /** Hourly consumption of one charge: [[timestamp, kWh], ...]. `id` is the (string) Monta charge id. */
  async getHourlyKwh(id) {
    const res = await this.get(`/charges/${encodeURIComponent(id)}/kwh-consumption`);
    return ((res && res.kwhConsumption) || [])
      .map((p) => [p.timestamp, Number(p.value) || 0])
      .filter(([ts, v]) => ts != null && v > 0);
  }
}

module.exports = { MontaClient, MontaError, parseJson, BASE_URL };
