'use strict';
// Dev tool: live check of MontaClient + compute against the real account.
// Credentials come from env (CLIENT_ID / CLIENT_SECRET), never from files. See scripts/live-check.sh.
const { MontaClient } = require('../lib/MontaClient');
const c = require('../lib/compute');

(async () => {
  let saved;
  const opts = { clientId: process.env.CLIENT_ID, clientSecret: process.env.CLIENT_SECRET, onTokens: (t) => { saved = t; } };
  await new MontaClient(opts).authenticate();
  console.log('auth ok, access expires', saved.accessExpiresAt);

  // Force the refresh path: expired access token, valid refresh token.
  const old = saved.accessToken;
  const cl = new MontaClient({ ...opts, tokens: { ...saved, accessExpiresAt: new Date(Date.now() - 1000).toISOString() } });
  const cps = await cl.listChargePoints();
  console.log('refresh ok, new token:', saved.accessToken !== old, '| charge points:', cps.map((x) => `${x.id} ${x.name}`));

  const raw = await cl.listCharges({ fromDate: '2026-01-01T00:00:00Z' });
  console.log('charges:', raw.length, '| id type:', typeof raw[0].id, raw[0].id);
  const sessions = c.mergeSessions([], raw.map(c.normalizeCharge));
  const v = c.snapshot({ sessions, homeIds: [String(cps[0].id)], tz: 'Europe/Brussels', now: new Date() }).values;
  console.log('due this month:', v.stroohm_refund_due_month, '| previous month:', v.stroohm_refund_due_prev_month, '| rate:', v.stroohm_rate);
})().catch((e) => { console.error('ERR', e.code, e.message); process.exit(1); });
