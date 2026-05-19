/**
 * @file audit-log.js
 * @description Central audit logging for all security-relevant events.
 * Records action type, user, target object, outcome, and timestamp.
 * Logs are retained for 3 months and are read-only after writing.
 *
 * Implements the Repository pattern for log storage abstraction.
 * All system components depend on this class — it must remain low-coupling.
 */

'use strict';

const crypto = require('crypto');

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

class AuditLog {
  // Private in-memory store (would be a database in production)
  #entries = [];

  /**
   * Records an audit event.
   * @param {string} userID       - who performed the action
   * @param {string} actionType   - e.g. 'LOGIN_SUCCESS', 'UPLOAD', 'RESERVE'
   * @param {string} detail       - human-readable detail / outcome
   * @param {string} [targetID]   - optional document/resource ID
   */
  record(userID, actionType, detail, targetID = null) {
    const entry = {
      logID: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userID,
      actionType,
      detail,
      targetID
    };
    this.#entries.push(entry);
  }

  /**
   * Returns all entries for a given user (for report generation).
   * @param {string} userID
   * @returns {object[]}
   */
  queryByUser(userID) {
    return this.#entries.filter(e => e.userID === userID);
  }

  /**
   * Returns all entries for a given document.
   * @param {string} docID
   * @returns {object[]}
   */
  queryByDocument(docID) {
    return this.#entries.filter(e => e.targetID === docID);
  }

  /**
   * Returns all entries within an inclusive date range.
   * @param {Date} from
   * @param {Date} to
   * @returns {object[]}
   */
  queryByDateRange(from, to) {
    return this.#entries.filter(e => {
      const ts = new Date(e.timestamp);
      return ts >= from && ts <= to;
    });
  }

  /**
   * Purges log entries older than 3 months .
   * In production this would run on a scheduled job.
   */
  purgeExpiredEntries() {
    const cutoff = new Date(Date.now() - THREE_MONTHS_MS);
    const before = this.#entries.length;
    this.#entries = this.#entries.filter(e => new Date(e.timestamp) >= cutoff);
    const purged = before - this.#entries.length;
    if (purged > 0) {
      // Record the purge event itself for accountability
      this.record('SYSTEM', 'LOG_PURGE', `Purged ${purged} entries older than 3 months`);
    }
  }

  /**
   * Returns a snapshot of all current entries (for report generation).
   * Returns a copy so callers cannot mutate the internal store.
   * @returns {object[]}
   */
  getAllEntries() {
    return [...this.#entries];
  }
}

module.exports = AuditLog;
