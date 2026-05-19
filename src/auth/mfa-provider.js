/**
 * @file mfa-provider.js
 * @description Manages generation and verification of email-based OTPs.
 * OTPs are 6-digit codes, expire after TTL_MS, and are single-use.
 *
 * In a real deployment, generateCode() would call an email API.
 * Here we simulate delivery and keep the code in memory for testing.
 */

'use strict';

const crypto = require('crypto');

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const OTP_LENGTH = 6;

class MFAProvider {
  // Map of userID → { code, expiresAt } — one pending OTP per user
  #pendingOTPs = new Map();

  /**
   * Generates a 6-digit OTP for the given user and "sends" it via email.
   * Replaces any existing pending OTP for that user.
   * @param {string} userID
   * @param {string} email   - destination address (used by real email service)
   * @returns {string} the OTP code (returned here for testability)
   */
  generateCode(userID, email) {
    // Produce a cryptographically random 6-digit code
    const code = crypto.randomInt(0, 10 ** OTP_LENGTH)
      .toString()
      .padStart(OTP_LENGTH, '0');

    this.#pendingOTPs.set(userID, {
      code,
      expiresAt: Date.now() + OTP_TTL_MS
    });

    // In production: emailService.send(email, `Your OTP is ${code}`)
    console.log(`[MFAProvider] OTP for ${userID}: ${code} (simulated email to ${email})`);

    return code; // returned so tests can verify without mocking email
  }

  /**
   * Verifies a submitted OTP against the stored pending code.
   * OTP is consumed on successful verification (single-use).
   * @param {string} userID
   * @param {string} submittedCode
   * @returns {boolean} true if valid and not expired
   */
  verifyCode(userID, submittedCode) {
    const record = this.#pendingOTPs.get(userID);

    if (!record) return false;                     // No pending OTP
    if (Date.now() > record.expiresAt) {           // Expired
      this.#pendingOTPs.delete(userID);
      return false;
    }
    if (record.code !== submittedCode) return false; // Wrong code

    // Consume OTP — single use
    this.#pendingOTPs.delete(userID);
    return true;
  }

  /**
   * Checks whether a pending (unexpired) OTP exists for a user.
   * @param {string} userID
   * @returns {boolean}
   */
  hasPendingOTP(userID) {
    const record = this.#pendingOTPs.get(userID);
    return !!record && Date.now() <= record.expiresAt;
  }
}

module.exports = MFAProvider;
