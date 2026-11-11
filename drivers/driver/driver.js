'use strict';

const Homey = require('homey');
const { MontaClient, MontaError } = require('../../lib/MontaClient');
const { normalizeCharge, aggregateMonths, monthKey, round2 } = require('../../lib/compute');
const { pick } = require('../../lib/i18n');

const MSG = {
  INVALID_CREDENTIALS: {
    en: 'Invalid Client ID or Client secret. Check them in the STROOHM platform.',
    fr: 'Client ID ou Client secret invalide. Vérifiez-les sur la plateforme STROOHM.',
    nl: 'Ongeldige Client ID of Client secret. Controleer ze op het STROOHM-platform.',
    de: 'Ungültige Client ID oder Client secret. Prüfen Sie sie auf der STROOHM-Plattform.',
    it: 'Client ID o Client secret non validi. Verificali sulla piattaforma STROOHM.',
  },
  FORBIDDEN: {
    en: 'This API key does not have access to charging sessions.',
    fr: 'Cette clé API n\'a pas accès aux sessions de recharge.',
    nl: 'Deze API-sleutel heeft geen toegang tot laadsessies.',
    de: 'Dieser API-Schlüssel hat keinen Zugriff auf Ladevorgänge.',
    it: 'Questa chiave API non ha accesso alle sessioni di ricarica.',
  },
  NETWORK: {
    en: 'Cannot reach STROOHM/Monta. Check your internet connection and retry.',
    fr: 'STROOHM/Monta est injoignable. Vérifiez votre connexion et réessayez.',
    nl: 'STROOHM/Monta is onbereikbaar. Controleer je verbinding en probeer opnieuw.',
    de: 'STROOHM/Monta ist nicht erreichbar. Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.',
    it: 'STROOHM/Monta non è raggiungibile. Verifica la connessione e riprova.',
  },
  NO_CHARGER: {
    en: 'No charger found on this account. A charger registered with STROOHM is required.',
    fr: 'Aucune borne trouvée sur ce compte. Une borne enregistrée chez STROOHM est nécessaire.',
    nl: 'Geen laadpaal gevonden op dit account. Een bij STROOHM geregistreerde laadpaal is vereist.',
    de: 'Keine Ladestation in diesem Konto gefunden. Eine bei STROOHM registrierte Ladestation ist erforderlich.',
    it: 'Nessuna colonnina trovata su questo account. È necessaria una colonnina registrata presso STROOHM.',
  },
  UNKNOWN: {
    en: 'Unexpected error while contacting STROOHM/Monta.',
    fr: 'Erreur inattendue lors de la connexion à STROOHM/Monta.',
    nl: 'Onverwachte fout bij verbinding met STROOHM/Monta.',
    de: 'Unerwarteter Fehler bei der Verbindung mit STROOHM/Monta.',
    it: 'Errore imprevisto durante la connessione a STROOHM/Monta.',
  },
};

module.exports = class StroohmDriver extends Homey.Driver {
  _error(err, key) {
    const code = key || (err instanceof MontaError ? err.code : 'UNKNOWN');
    return new Error(pick(this.homey, MSG[code] || MSG.UNKNOWN));
  }

  async onPair(session) {
    let client = null;
    let chargePoints = [];
    let sessions = [];
    let setup = { homeIds: [], external: {}, since: '' };

    session.setHandler('login', async ({ username, password }) => {
      const c = new MontaClient({ clientId: (username || '').trim(), clientSecret: (password || '').trim() });
      try {
        await c.authenticate();
        chargePoints = await c.listChargePoints();
        if (!chargePoints.length) throw this._error(null, 'NO_CHARGER');
        sessions = (await c.listCharges()).map(normalizeCharge);
      } catch (err) {
        this.error('Pairing login failed:', err.code || err.message); // never log credentials
        throw err instanceof MontaError ? this._error(err) : err;
      }
      client = c;
      setup.homeIds = chargePoints.map((p) => String(p.id));
      return true;
    });

    session.setHandler('getSetup', async ({ homeIds } = {}) => {
      const ids = homeIds && homeIds.length ? homeIds : setup.homeIds;
      const tz = this.homey.clock.getTimezone();
      const agg = aggregateMonths(sessions, { homeIds: ids, tz });
      const cur = monthKey(new Date().toISOString(), tz);
      return {
        chargers: chargePoints.map((p) => ({ id: String(p.id), name: p.name || String(p.id) })),
        homeIds: ids,
        currentMonth: cur,
        months: Object.keys(agg).sort().filter((k) => agg[k].due > 0.005)
          .map((k) => ({ key: k, kwh: round2(agg[k].homeKwh), due: round2(agg[k].due) })),
      };
    });

    const descriptor = () => {
      if (!client) throw this._error(null, 'UNKNOWN');
      return {
        name: 'Stroohm',
        data: { id: client.clientId },
        settings: {
          home_charger_ids: setup.homeIds.join(','),
          since: setup.since || '',
        },
        store: {
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          tokens: client.tokens,
          sessions: [],
          external: setup.external || {},
        },
      };
    };

    // The setup view creates the device itself (Homey.createDevice) with this descriptor.
    session.setHandler('saveSetup', async (payload) => {
      setup = { ...setup, ...payload };
      return descriptor();
    });
  }

  async onRepair(session, device) {
    session.setHandler('login', async ({ username, password }) => {
      const c = new MontaClient({ clientId: (username || '').trim(), clientSecret: (password || '').trim() });
      try {
        await c.authenticate();
      } catch (err) {
        throw err instanceof MontaError ? this._error(err) : err;
      }
      await device.updateCredentials(c.clientId, c.clientSecret, c.tokens);
      return true;
    });
  }
};
