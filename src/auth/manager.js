/**
 * @file manager.js
 * @description Manager subclass — same document permissions as Engineer
 * plus the ability to view activity reports.
 *
 */

'use strict';

const User = require('./user');

const MANAGER_PERMISSIONS = new Set([
  'upload',
  'download',
  'search',
  'reserve',
  'updateMetadata',
  'viewReports'   // Managers can access activity reports
]);

class Manager extends User {
  constructor(userID, email, password) {
    super(userID, email, password, 'manager');
  }

  /**
   * @param {string} action
   * @returns {boolean}
   */
  hasPermission(action) {
    return MANAGER_PERMISSIONS.has(action);
  }
}

module.exports = Manager;
