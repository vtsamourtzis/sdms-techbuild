/**
 * @file engineer.js
 * @description Engineer subclass — inherits from User, overrides hasPermission()
 * to grant document operations (upload, download, search, reserve).
 *
 */

'use strict';

const User = require('./user');

// Actions permitted for the Engineer role
const ENGINEER_PERMISSIONS = new Set([
  'upload',
  'download',
  'search',
  'reserve',
  'updateMetadata'
]);

class Engineer extends User {
  constructor(userID, email, password) {
    super(userID, email, password, 'engineer');
  }

  /**
   * Engineers can perform document operations but cannot view activity reports.
   * @param {string} action
   * @returns {boolean}
   */
  hasPermission(action) {
    return ENGINEER_PERMISSIONS.has(action);
  }
}

module.exports = Engineer;
