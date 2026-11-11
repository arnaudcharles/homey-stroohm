'use strict';

const Homey = require('homey');

module.exports = class StroohmRefundApp extends Homey.App {
  async onInit() {
    // Flow conditions
    this.homey.flow.getConditionCard('pending_above')
      .registerRunListener(async ({ device, amount }) => (device.getCapabilityValue('measure_stroohm_refund_pending') || 0) > amount);
    this.homey.flow.getConditionCard('net_negative')
      .registerRunListener(async ({ device }) => (device.getCapabilityValue('measure_stroohm_net_month') || 0) < 0);

    // Flow actions
    this.homey.flow.getActionCard('refresh_now')
      .registerRunListener(async ({ device }) => device.refresh());
    this.homey.flow.getActionCard('month_report')
      .registerRunListener(async ({ device, month }) => device.runReport(month));

    // Dashboard widget: pick the device (only needed with several Stroohm devices).
    this.homey.dashboards.getWidget('month').registerSettingAutocompleteListener('device', async (query) => this.homey.drivers
      .getDriver('driver').getDevices()
      .map((d) => ({ name: d.getName(), id: d.getData().id }))
      .filter((d) => d.name.toLowerCase().includes(String(query || '').toLowerCase())));

    this.log('Stroohm started');
  }
};
