/**
 * @file report.js
 * @description Generates activity reports for Supervisors from audit log data.
 * Aggregates audit events into a structured summary by date range and filter.
 *
 * Low coupling: only depends on AuditLog interface.
 */

'use strict';

const crypto = require('crypto');

class Report {
  #entries = [];

  /**
   * @param {AuditLog} auditLog - the system audit log to query
   */
  constructor(auditLog) {
    this.auditLog = auditLog;
  }

  /**
   * Generates an activity report for a given date range.
   * @param {string} generatedByUserID - must be a supervisor (checked upstream by ACS)
   * @param {Date}   from
   * @param {Date}   to
   * @param {object} [filters]         - { actionType?, userID? }
   * @returns {object} report summary
   */
  generate(generatedByUserID, from, to, filters = {}) {
    let entries = this.auditLog.queryByDateRange(from, to);

    // Apply optional filters
    if (filters.actionType) {
      entries = entries.filter(e => e.actionType === filters.actionType);
    }
    if (filters.userID) {
      entries = entries.filter(e => e.userID === filters.userID);
    }

    this.#entries = entries;

    return {
      reportID: crypto.randomUUID(),
      generatedBy: generatedByUserID,
      generatedAt: new Date().toISOString(),
      period: { from: from.toISOString(), to: to.toISOString() },
      filters,
      totalEvents: entries.length,
      summary: this.#buildSummary(entries),
      entries
    };
  }

  /**
   * Builds an aggregated summary: event counts by action type.
   * @param {object[]} entries
   * @returns {object} { actionType: count }
   * @private
   */
  #buildSummary(entries) {
    return entries.reduce((acc, entry) => {
      acc[entry.actionType] = (acc[entry.actionType] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Returns the raw entries of the last generated report.
   * @returns {object[]}
   */
  getEntries() {
    return [...this.#entries];
  }
}

module.exports = Report;
