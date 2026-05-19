/**
 * @file session-manager.js
 * @description Coordinates the full authentication flow: password check,
 * OTP challenge, and session creation. Enforces single active session
 * and tracks failed login attempts for rate limiting.
 *
 * Orchestrates User, MFAProvider, and AuditLog.
 * Low coupling: depends on interfaces, not concrete implementations.
 */

'use strict';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

class SessionManager {
  // Map: userID -> { count, lockedUntil }
  #failedAttempts = new Map();

  /**
   * @param {MFAProvider} mfaProvider
   * @param {AuditLog}    auditLog
   */
  constructor(mfaProvider, auditLog) {
    this.mfaProvider = mfaProvider;
    this.auditLog = auditLog;
  }

  /**
   * Step 1 of login: validate password and dispatch OTP.
   * @param {User}   user
   * @param {string} password
   * @returns {{ success: boolean, message: string }}
   */
  initiateLogin(user, password) {
    if (this.#isLocked(user.userID)) {
      this.auditLog.record(user.userID, 'LOGIN_BLOCKED', 'account locked');
      return { success: false, message: 'Account temporarily locked. Try again later.' };
    }

    if (!user.verifyPassword(password)) {
      this.#recordFailure(user.userID);
      this.auditLog.record(user.userID, 'LOGIN_FAILED', 'invalid password');
      return { success: false, message: 'Invalid credentials.' };
    }

    // Password valid: dispatch OTP
    this.mfaProvider.generateCode(user.userID, user.email);
    this.auditLog.record(user.userID, 'OTP_DISPATCHED', 'MFA challenge initiated');
    return { success: true, message: 'OTP sent to registered email.' };
  }

  /**
   * Step 2 of login: verify OTP and create session.
   * @param {User}   user
   * @param {string} submittedOTP
   * @returns {{ success: boolean, sessionToken?: string, message: string }}
   */
  completeLogin(user, submittedOTP) {
    if (!this.mfaProvider.verifyCode(user.userID, submittedOTP)) {
      this.auditLog.record(user.userID, 'OTP_FAILED', 'invalid or expired OTP');
      return { success: false, message: 'Invalid or expired OTP.' };
    }

    // OTP valid: create session, replacing any existing one
    const sessionToken = user.createSession();
    this.#clearFailures(user.userID);
    this.auditLog.record(user.userID, 'LOGIN_SUCCESS', 'session created');
    return { success: true, sessionToken, message: 'Authenticated successfully.' };
  }

  /**
   * Terminates the user's active session.
   * @param {User} user
   */
  logout(user) {
    user.logout();
    this.auditLog.record(user.userID, 'LOGOUT', 'session terminated');
  }

  // --- Private helpers ---

  /**
   * Returns true only when a lock is explicitly set AND still active.
   * Key fix: returns false without deleting when lockedUntil is null,
   * so the failure counter is preserved between checks.
   * @param {string} userID
   * @returns {boolean}
   */
  #isLocked(userID) {
    const record = this.#failedAttempts.get(userID);
    if (!record || !record.lockedUntil) return false;
    if (Date.now() < record.lockedUntil) return true;
    // Lock has expired: clear and allow retry
    this.#failedAttempts.delete(userID);
    return false;
  }

  /**
   * Increments failure count and sets lock once MAX_LOGIN_ATTEMPTS is reached.
   * @param {string} userID
   */
  #recordFailure(userID) {
    const record = this.#failedAttempts.get(userID) || { count: 0, lockedUntil: null };
    record.count += 1;
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
      record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    }
    this.#failedAttempts.set(userID, record);
  }

  /**
   * Clears the failure record on successful login.
   * @param {string} userID
   */
  #clearFailures(userID) {
    this.#failedAttempts.delete(userID);
  }
}

module.exports = SessionManager;
