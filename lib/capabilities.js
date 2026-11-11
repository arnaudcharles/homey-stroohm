'use strict';

// Values computed by compute.js are named `stroohm_*`; the matching capability of a number value is
// `measure_stroohm_*` (only `measure_`/`meter_` capabilities can be chosen as device indicator).
const STRING_VALUES = new Set(['stroohm_last_session_date']);

const capId = (key) => (STRING_VALUES.has(key) ? key : `measure_${key}`);

module.exports = { capId };
