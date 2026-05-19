/**
 * @file user.test.js
 * @description Unit tests for User, Engineer, Manager, Supervisor classes.
 * Verifies: password hashing, session management, role-based permissions (polymorphism).
 */

'use strict';

const Engineer   = require('../../src/auth/engineer');
const Manager    = require('../../src/auth/manager');
const Supervisor = require('../../src/auth/supervisor');

describe('User hierarchy', () => {

  // ─── Password verification ────────────────────────────────────────────────────

  describe('verifyPassword()', () => {
    test('returns true for correct password', () => {
      const eng = new Engineer('U-001', 'a@b.com', 'MyPass99');
      expect(eng.verifyPassword('MyPass99')).toBe(true);
    });

    test('returns false for wrong password', () => {
      const eng = new Engineer('U-001', 'a@b.com', 'MyPass99');
      expect(eng.verifyPassword('wrong')).toBe(false);
    });

    test('plaintext password is not accessible on the object', () => {
      const eng = new Engineer('U-001', 'a@b.com', 'MyPass99');
      // Confirm there is no public property leaking the password
      const publicKeys = Object.keys(eng);
      expect(publicKeys).not.toContain('password');
      expect(publicKeys).not.toContain('passwordHash');
    });
  });

  // ─── Session management ───────────────────────────────────────────────────────

  describe('createSession() / validateSession() / logout()', () => {
    test('createSession returns a token and validateSession accepts it', () => {
      const eng = new Engineer('U-001', 'a@b.com', 'pass');
      const token = eng.createSession();

      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
      expect(eng.validateSession(token)).toBe(true);
    });

    test('calling createSession again replaces the old token (single session)', () => {
      const eng = new Engineer('U-001', 'a@b.com', 'pass');
      const oldToken = eng.createSession();
      const newToken = eng.createSession();

      // Old token must be invalid — single active session
      expect(eng.validateSession(oldToken)).toBe(false);
      expect(eng.validateSession(newToken)).toBe(true);
    });

    test('logout invalidates the session token', () => {
      const eng = new Engineer('U-001', 'a@b.com', 'pass');
      const token = eng.createSession();
      eng.logout();

      expect(eng.validateSession(token)).toBe(false);
    });

    test('validateSession returns false for wrong token', () => {
      const eng = new Engineer('U-001', 'a@b.com', 'pass');
      eng.createSession();
      expect(eng.validateSession('bad-token')).toBe(false);
    });
  });

  // ─── Role-based permissions (Polymorphism) ────────────────────────────────────

  describe('hasPermission() — Engineer', () => {
    const eng = new Engineer('U-001', 'a@b.com', 'pass');

    test('can upload, download, search, reserve', () => {
      ['upload', 'download', 'search', 'reserve'].forEach(action => {
        expect(eng.hasPermission(action)).toBe(true);
      });
    });

    test('cannot viewReports', () => {
      expect(eng.hasPermission('viewReports')).toBe(false);
    });
  });

  describe('hasPermission() — Manager', () => {
    const mgr = new Manager('U-002', 'b@b.com', 'pass');

    test('can do everything an engineer can plus viewReports', () => {
      ['upload', 'download', 'search', 'reserve', 'viewReports'].forEach(action => {
        expect(mgr.hasPermission(action)).toBe(true);
      });
    });
  });

  describe('hasPermission() — Supervisor', () => {
    const sup = new Supervisor('U-003', 'c@b.com', 'pass');

    test('can only viewReports', () => {
      expect(sup.hasPermission('viewReports')).toBe(true);
    });

    test('cannot upload, download, search, or reserve', () => {
      ['upload', 'download', 'search', 'reserve'].forEach(action => {
        expect(sup.hasPermission(action)).toBe(false);
      });
    });
  });

  // ─── toPublicProfile() ────────────────────────────────────────────────────────

  describe('toPublicProfile()', () => {
    test('does not expose password or session token', () => {
      const eng = new Engineer('U-001', 'a@b.com', 'pass');
      const profile = eng.toPublicProfile();

      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('sessionToken');
      expect(profile).toHaveProperty('userID', 'U-001');
      expect(profile).toHaveProperty('role', 'engineer');
    });
  });
});
