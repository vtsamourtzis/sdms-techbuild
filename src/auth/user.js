/**
 * @file user.js
 * @description Base User class for the SDMS.
 * Encapsulates identity, credentials, and session state.
 * Engineer and Manager subclasses override hasPermission()
 * to implement role-specific access policies.
 *
 * OOP principles: Encapsulation (#fields), Inheritance (subclasses),
 *                 Abstraction (hasPermission interface).
 */

'use strict';

const crypto = require('crypto');

class User {
  // Private fields — external code cannot read raw credentials
  #passwordHash;
  #sessionToken = null;

  /**
   * @param {string} userID     - Unique identifier (stored encrypted in DB)
   * @param {string} email      - User email (stored encrypted in DB)
   * @param {string} password   - Plaintext password (hashed immediately, never stored)
   * @param {string} role       - 'engineer' | 'manager' | 'supervisor'
   */
  constructor(userID, email, password, role) {
    this.userID = userID;
    this.email = email;
    this.role = role;
    this.isActive = true;
    this.createdAt = new Date();
    this.lastLoginAt = null;

    // Password is hashed on construction — plaintext never persisted
    this.#passwordHash = this.#hashPassword(password);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Hashes a plaintext password with SHA-256.
   * In production this would use bcrypt/argon2.
   * @param {string} plaintext
   * @returns {string} hex digest
   */
  #hashPassword(plaintext) {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
  }

  // ─── Public methods ──────────────────────────────────────────────────────────

  /**
   * Validates provided password against stored hash.
   * @param {string} plaintext
   * @returns {boolean}
   */
  verifyPassword(plaintext) {
    return this.#hashPassword(plaintext) === this.#passwordHash;
  }

  /**
   * Creates a new session token for this user.
   * Enforces single active session: old token is replaced.
   * @returns {string} new session token
   */
  createSession() {
    // Replace any existing session — single active session policy
    this.#sessionToken = crypto.randomBytes(32).toString('hex');
    this.lastLoginAt = new Date();
    return this.#sessionToken;
  }

  /**
   * Validates a token against the active session.
   * @param {string} token
   * @returns {boolean}
   */
  validateSession(token) {
    return this.#sessionToken !== null && this.#sessionToken === token;
  }

  /**
   * Clears the active session (logout).
   */
  logout() {
    this.#sessionToken = null;
  }

  /**
   * Role-based permission check.
   * Overridden in Engineer and Manager subclasses.
   * Default-deny: base User has no permissions.
   * @param {string} action - e.g. 'upload', 'download', 'viewReports'
   * @returns {boolean}
   */
  hasPermission(action) {
    // Base class denies everything — subclasses grant specific permissions
    return false;
  }

  /**
   * @returns {object} Safe public representation (no password hash, no token)
   */
  toPublicProfile() {
    return {
      userID: this.userID,
      email: this.email,
      role: this.role,
      isActive: this.isActive,
      lastLoginAt: this.lastLoginAt
    };
  }
}

module.exports = User;
