'use strict';
const path = require('path');

/**
 * Directory for live mutable state (tracked.json, adaptation_state.json, shadow log).
 * Defaults to <repo>/data (production). Tests set MAYOR_STATE_DIR to a temp dir.
 */
function stateDir() {
  return process.env.MAYOR_STATE_DIR || path.join(__dirname, '..', 'data');
}

module.exports = { stateDir };
