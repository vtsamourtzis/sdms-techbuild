/**
 * @file document-lock.test.js
 * @description Unit tests for DocumentLock (Observer pattern + reservation logic).
 * Verifies: locking, conflict denial, unlock, observer notifications, expiry.
 */

'use strict';

const DocumentLock = require('../../src/documents/document-lock');

describe('DocumentLock', () => {
  let lock;

  beforeEach(() => {
    lock = new DocumentLock('D-001');
  });

  // ─── lock() ───────────────────────────────────────────────────────────────────

  describe('lock()', () => {
    test('grants a lock when document is free', () => {
      const result = lock.lock('U-001');
      expect(result.success).toBe(true);
      expect(lock.isLocked()).toBe(true);
    });

    test('denies lock when already held by another user', () => {
      lock.lock('U-001');
      const result = lock.lock('U-002');

      expect(result.success).toBe(false);
      expect(result.message).toContain('U-001');
    });

    test('allows same user to re-lock (extend reservation)', () => {
      lock.lock('U-001');
      const result = lock.lock('U-001');
      expect(result.success).toBe(true);
    });
  });

  // ─── unlock() ─────────────────────────────────────────────────────────────────

  describe('unlock()', () => {
    test('lock owner can release the lock', () => {
      lock.lock('U-001');
      const result = lock.unlock('U-001');

      expect(result.success).toBe(true);
      expect(lock.isLocked()).toBe(false);
    });

    test('non-owner cannot release the lock', () => {
      lock.lock('U-001');
      const result = lock.unlock('U-002');

      expect(result.success).toBe(false);
      expect(lock.isLocked()).toBe(true);
    });

    test('SYSTEM can force-release any lock', () => {
      lock.lock('U-001');
      const result = lock.unlock('SYSTEM');

      expect(result.success).toBe(true);
      expect(lock.isLocked()).toBe(false);
    });

    test('unlock on a free document returns failure gracefully', () => {
      const result = lock.unlock('U-001');
      expect(result.success).toBe(false);
    });
  });

  // ─── Observer pattern ─────────────────────────────────────────────────────────

  describe('Observer notifications', () => {
    test('notifies observer when document is locked', () => {
      const events = [];
      lock.addObserver(e => events.push(e));

      lock.lock('U-001');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('LOCKED');
      expect(events[0].lockedByUserID).toBe('U-001');
    });

    test('notifies observer when document is unlocked', () => {
      const events = [];
      lock.addObserver(e => events.push(e));

      lock.lock('U-001');
      lock.unlock('U-001');

      expect(events[1].type).toBe('UNLOCKED');
    });

    test('removed observer is no longer called', () => {
      const events = [];
      const cb = e => events.push(e);

      lock.addObserver(cb);
      lock.removeObserver(cb);
      lock.lock('U-001');

      expect(events).toHaveLength(0);
    });

    test('observer error does not prevent other observers firing', () => {
      const results = [];
      lock.addObserver(() => { throw new Error('observer failure'); });
      lock.addObserver(e => results.push(e));

      // Should not throw, second observer should still fire
      expect(() => lock.lock('U-001')).not.toThrow();
      expect(results).toHaveLength(1);
    });
  });

  // ─── getLockInfo() ────────────────────────────────────────────────────────────

  describe('getLockInfo()', () => {
    test('returns null when not locked', () => {
      expect(lock.getLockInfo()).toBeNull();
    });

    test('returns lock info object when locked', () => {
      lock.lock('U-001');
      const info = lock.getLockInfo();

      expect(info).toHaveProperty('lockedByUserID', 'U-001');
      expect(info).toHaveProperty('lockedAt');
      expect(info).toHaveProperty('expiresAt');
    });

    test('returned info is a copy — mutating it does not affect lock state', () => {
      lock.lock('U-001');
      const info = lock.getLockInfo();
      info.lockedByUserID = 'HACKER';

      expect(lock.getLockInfo().lockedByUserID).toBe('U-001');
    });
  });
});
