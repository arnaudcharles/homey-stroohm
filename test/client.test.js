'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MontaClient, MontaError, parseJson } = require('../lib/MontaClient');

const resp = (status, body, headers = {}) => ({
  status, ok: status < 300,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const future = (ms) => new Date(Date.now() + ms).toISOString();
const tokenBody = { accessToken: 'A', refreshToken: 'R', accessTokenExpirationDate: future(3600e3), refreshTokenExpirationDate: future(30 * 864e5) };

test('parseJson keeps ids above 2^53 as strings', () => {
  const o = parseJson('{"id":912345678901234567,"chargePointId":1234567,"consumedKwh":1.5,"data":[{"id":912345678901234568}]}');
  assert.equal(o.id, '912345678901234567');
  assert.equal(o.data[0].id, '912345678901234568');
  assert.equal(o.chargePointId, 1234567);
});

test('authenticates, then paginates until totalPageCount', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(`${opts.method} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/auth/token')) return resp(200, tokenBody);
    const page = Number(url.searchParams.get('page'));
    return resp(200, { data: [{ n: page * 2 }, { n: page * 2 + 1 }], meta: { totalPageCount: 2 } });
  };
  const c = new MontaClient({ clientId: 'i', clientSecret: 's', fetchImpl });
  const items = await c.listCharges({ fromDate: '2026-01-01T00:00:00Z' });
  assert.equal(items.length, 4);
  assert.equal(calls.filter((x) => x.includes('/charges')).length, 2);
  assert.match(calls[1], /perPage=100/);
});

test('refreshes with the refresh token when the access token is about to expire', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url.pathname);
    if (url.pathname.endsWith('/auth/refresh')) return resp(200, tokenBody);
    return resp(200, { data: [], meta: { totalPageCount: 0 } });
  };
  const c = new MontaClient({
    clientId: 'i', clientSecret: 's', fetchImpl,
    tokens: { accessToken: 'old', refreshToken: 'R', accessExpiresAt: future(1000), refreshExpiresAt: future(864e5) },
  });
  await c.listChargePoints();
  assert.ok(seen.some((p) => p.endsWith('/auth/refresh')));
  assert.ok(!seen.some((p) => p.endsWith('/auth/token')));
});

test('wrong credentials -> INVALID_CREDENTIALS', async () => {
  const fetchImpl = async () => resp(401, { errorCode: 'APPLICATION_NOT_FOUND', message: 'nope' });
  const c = new MontaClient({ clientId: 'i', clientSecret: 's', fetchImpl });
  await assert.rejects(c.authenticate(), (e) => e instanceof MontaError && e.code === 'INVALID_CREDENTIALS');
});

test('403 -> FORBIDDEN (missing scope)', async () => {
  const fetchImpl = async (url) => (url.pathname.endsWith('/auth/token') ? resp(200, tokenBody) : resp(403, { message: 'scope' }));
  const c = new MontaClient({ clientId: 'i', clientSecret: 's', fetchImpl });
  await assert.rejects(c.listCharges(), (e) => e.code === 'FORBIDDEN');
});

test('retries 429 honouring Retry-After, then succeeds', async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith('/auth/token')) return resp(200, tokenBody);
    return ++n === 1 ? resp(429, {}, { 'retry-after': '0' }) : resp(200, { data: [{ ok: 1 }], meta: { totalPageCount: 1 } });
  };
  const c = new MontaClient({ clientId: 'i', clientSecret: 's', fetchImpl });
  assert.equal((await c.listChargePoints()).length, 1);
  assert.equal(n, 2);
});

test('unexpected 401 triggers one re-authentication', async () => {
  let tokens = 0, listed = 0;
  const fetchImpl = async (url) => {
    if (url.pathname.endsWith('/auth/token')) { tokens++; return resp(200, tokenBody); }
    return ++listed === 1 ? resp(401, { errorCode: 'INVALID_ACCESS_TOKEN' }) : resp(200, { data: [], meta: { totalPageCount: 0 } });
  };
  const c = new MontaClient({ clientId: 'i', clientSecret: 's', fetchImpl });
  await c.listChargePoints();
  assert.equal(tokens, 2);
});
