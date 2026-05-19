/**
 * @file supervisor.js
 * @description Supervisor subclass — governance role.
 * Can only view activity reports; cannot perform document operations.
 *
 */

'use strict';

const User = require('./user');

const SUPERVISOR_PERMISSIONS = new Set([
  'viewReports'
]);

class Supervisor extends User {
  constructor(userID, email, password) {
    super(userID, email, password, 'supervisor');
  }

  /**
   * @param {string} action
   * @returns {boolean}
   */
  hasPermission(action) {
    return SUPERVISOR_PERMISSIONS.has(action);
  }
}

module.exports = Supervisor;
