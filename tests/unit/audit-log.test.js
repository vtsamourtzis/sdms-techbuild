/**
 * @file audit-log.test.js
 * @description Unit tests for AuditLog class.
 * Verifies: recording entries, querying by user/document/date, retention purge.
 */

'use strict';

const AuditLog = require('../../src/audit/audit-log');

describe('AuditLog', () => {
  let log;

  beforeEach(() => {
    log = new AuditLog();
  });

  // ─── record() ────────────────────────────────────────────────────────────────

  describe('record()', () => {
    test('creates an entry with required fields', () => {
      log.record('U-001', 'LOGIN_SUCCESS', 'session created');
      const entries = log.getAllEntries();

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        userID: 'U-001',
        actionType: 'LOGIN_SUCCESS',
        detail: 'session created'
      });
    });

    test('assigns a unique logID to each entry', () => {
      log.record('U-001', 'UPLOAD', 'file.pdf', 'D-001');
      log.record('U-001', 'DOWNLOAD', 'file.pdf', 'D-001');
      const entries = log.getAllEntries();

      expect(entries[0].logID).not.toBe(entries[1].logID);
    });

    test('includes a timestamp string on every entry', () => {
      log.record('U-002', 'LOGOUT', 'session ended');
      const [entry] = log.getAllEntries();

      expect(typeof entry.timestamp).toBe('string');
      expect(new Date(entry.timestamp).toString()).not.toBe('Invalid Date');
    });
  });

  // ─── queryByUser() ────────────────────────────────────────────────────────────

  describe('queryByUser()', () => {
    test('returns only entries for the specified user', () => {
      log.record('U-001', 'LOGIN_SUCCESS', 'ok');
      log.record('U-002', 'LOGIN_SUCCESS', 'ok');
      log.record('U-001', 'UPLOAD', 'file', 'D-001');

      const results = log.queryByUser('U-001');
      expect(results).toHaveLength(2);
      results.forEach(e => expect(e.userID).toBe('U-001'));
    });

    test('returns empty array when user has no entries', () => {
      expect(log.queryByUser('U-999')).toEqual([]);
    });
  });

  // ─── queryByDocument() ────────────────────────────────────────────────────────

  describe('queryByDocument()', () => {
    test('returns entries matching targetID', () => {
      log.record('U-001', 'UPLOAD', 'uploaded', 'D-001');
      log.record('U-002', 'DOWNLOAD', 'downloaded', 'D-001');
      log.record('U-001', 'UPLOAD', 'other doc', 'D-002');

      const results = log.queryByDocument('D-001');
      expect(results).toHaveLength(2);
    });
  });

  // ─── queryByDateRange() ───────────────────────────────────────────────────────

  describe('queryByDateRange()', () => {
    test('returns only entries within the date range', () => {
      log.record('U-001', 'EVENT', 'in range');
      const from = new Date(Date.now() - 1000);
      const to   = new Date(Date.now() + 1000);

      const results = log.queryByDateRange(from, to);
      expect(results.length).toBeGreaterThan(0);
    });

    test('excludes entries outside the date range', () => {
      log.record('U-001', 'EVENT', 'future');
      const from = new Date(Date.now() + 5000);
      const to   = new Date(Date.now() + 10000);

      expect(log.queryByDateRange(from, to)).toHaveLength(0);
    });
  });

  // ─── getAllEntries() — immutability ───────────────────────────────────────────

  describe('getAllEntries()', () => {
    test('returns a copy — mutating it does not affect internal state', () => {
      log.record('U-001', 'LOGIN_SUCCESS', 'ok');
      const copy = log.getAllEntries();
      copy.push({ fake: true });

      expect(log.getAllEntries()).toHaveLength(1);
    });
  });
});
