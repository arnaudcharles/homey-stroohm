'use strict';

// Data for the dashboard widget: this month's figures and the last 6 Monta months.
module.exports = {
  async getData({ homey, query }) {
    const list = homey.drivers.getDriver('driver').getDevices();
    const device = list.find((d) => d.getData().id === (query && query.deviceId)) || list[0];
    if (!device) return null;
    const s = device.getState();
    const v = s.values;
    return {
      name: device.getName(),
      currentMonth: s.currentMonth,
      due: v.stroohm_refund_due_month,
      projection: v.stroohm_refund_projection_month,
      kwh: v.stroohm_home_kwh_month,
      pending: v.stroohm_refund_pending,
      net: v.stroohm_net_month,
      months: s.months.filter((m) => !m.legacy && /^\d{4}-\d{2}$/.test(m.key)).slice(-6)
        .map((m) => ({ key: m.key, due: m.due, kwh: m.kwh })),
    };
  },
};
