'use strict';

/** Pick the user's language from {en, fr, nl}, falling back to English. */
const pick = (homey, t) => t[homey.i18n.getLanguage()] || t.en;

module.exports = { pick };
