# Stroohm — Homey app

Homey Pro app (`be.charlesarnaud.stroohm`) that tracks home EV charging and the employer refund
paid through **STROOHM** (white-label of the **Monta** platform). Store description: `README.txt`
(+ `README.fr.txt`, `.nl`, `.de`, `.it`).

- Homey Pro (2023), Pro mini, Self-Hosted Server — `compatibility >=12.3.0` (widget), not Homey Cloud.
- SDK v3, Homey Compose, JavaScript, no runtime dependency.
- Languages: en, fr, nl, de, it.

## How it works

- Data: Monta public API `https://public-api.monta.com/api/v1` (`/auth/token`, `/charges`,
  `/charge-points`, `/charges/{id}/kwh-consumption`) with a personal API key created on
  platform.stroohm.com → Profile → *Personal API keys* → *+ New*.
- Home charger = the user's own charge point: `price` = refund due by the employer, `cost` =
  electricity cost from the tariff set in the STROOHM app (or the tariff set in this app).
- Monta pays the accumulated balance on the 1st of each month: closed months are assumed refunded,
  the current month is pending. Amounts (and optionally kWh / public charging) received before Monta
  are entered per month or per year in the app settings.
- Charge ids exceed 2^53: `lib/MontaClient.js` keeps them as strings; sessions are keyed on `externalId`.

## Layout

| Path | Role |
|---|---|
| `lib/compute.js` | Pure computations (months, refunds, gain/loss, shares) — unit tested |
| `lib/tariff.js` | Own tariff: fixed, day/night measured (hourly data) or average profiles |
| `lib/MontaClient.js` | API client: token/refresh, retries, pagination, long ids |
| `lib/csv.js` | Localized monthly CSV and summary |
| `drivers/driver/` | Device (sync, capabilities, Flow triggers), pairing and repair views |
| `settings/index.html` + `api.js` | App settings page (tariff, data before Monta, CSV) |
| `widgets/month/` | Dashboard widget |
| `scripts/` | Generators (`npm run gen`), translations, widget previews, live check |

Number values are exposed as `measure_stroohm_*` capabilities (only `measure_`/`meter_` can be
chosen as device indicator; `meter_` is avoided so Homey Energy never counts them).

## Develop

```bash
npm test                         # unit tests (node --test)
npm run gen                      # regenerate capabilities, driver manifest, de/it translations
homey app validate --level publish
homey app run --remote           # run on the Homey (no Docker)
```

Live API check without Homey: `CLIENT_ID=… CLIENT_SECRET=… node scripts/live-check.js` (never prints the secret).

Texts to translate live in `locales/*.json` (en/fr/nl) and `scripts/translations.json` (de/it,
keyed by the English text); `npm run gen` fails if a translation is missing.

## Support

help@charlesarnaud.be — community app, not affiliated with STROOHM or Monta.

## License

MIT — see [LICENSE](LICENSE). The STROOHM name and logo belong to their owner; this community app is not affiliated with STROOHM or Monta.
