'use strict';

// Endpoints used by settings/index.html (declared in .homeycompose/app.json).

function devices(homey) {
  return homey.drivers.getDriver('driver').getDevices();
}

function pickDevice(homey, id) {
  const list = devices(homey);
  const d = (id && list.find((x) => x.getData().id === id)) || list[0];
  if (!d) throw new Error('No device');
  return d;
}

module.exports = {
  async getState({ homey, query }) {
    const list = devices(homey);
    if (!list.length) return { devices: [], state: null };
    const d = pickDevice(homey, query && query.deviceId);
    return {
      devices: list.map((x) => ({ id: x.getData().id, name: x.getName() })),
      state: d.getState(),
      deviceId: d.getData().id,
    };
  },

  async setExternal({ homey, body }) {
    return pickDevice(homey, body.deviceId).setExternal(body);
  },

  async setTariff({ homey, body }) {
    return pickDevice(homey, body.deviceId).setTariff(body);
  },

  async getCsv({ homey, query }) {
    return pickDevice(homey, query && query.deviceId).getCsv(query && query.month);
  },
};
