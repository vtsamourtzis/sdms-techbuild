/**
 * @file auth-flow.test.js
 * @description Integration test for the full authentication flow.
 * Tests the interaction between User, MFAProvider, SessionManager, and AuditLog.
 *
 * Verifies: password check → OTP dispatch → OTP verify → session creation → single session policy.
 */

'use strict';

const Engineer       = require('../../src/auth/engineer');
const MFAProvider    = require('../../src/auth/mfa-provider');
const SessionManager = require('../../src/auth/session-manager');
const AuditLog       = require('../../src/audit/audit-log');

describe('Integration: Authentication Flow', () => {
  let user, mfa, auditLog, sessionMgr;

  beforeEach(() => {
    user       = new Engineer('U-001', 'alice@techbuild.com', 'CorrectPass99');
    mfa        = new MFAProvider();
    auditLog   = new AuditLog();
    sessionMgr = new SessionManager(mfa, auditLog);
  });

  test('full happy path: correct password + valid OTP → session token issued', () => {
    // Step 1: initiate login
    const step1 = sessionMgr.initiateLogin(user, 'CorrectPass99');
    expect(step1.success).toBe(true);

    // Step 2: get OTP (simulate receiving email)
    const otp = mfa.generateCode(user.userID, user.email);

    // Step 3: complete login
    const step2 = sessionMgr.completeLogin(user, otp);
    expect(step2.success).toBe(true);
    expect(typeof step2.sessionToken).toBe('string');

    // Session should now be valid
    expect(user.validateSession(step2.sessionToken)).toBe(true);
  });

  test('wrong password → login blocked, audit entry recorded', () => {
    const result = sessionMgr.initiateLogin(user, 'WrongPassword');
    expect(result.success).toBe(false);

    const logs = auditLog.queryByUser('U-001');
    expect(logs.some(e => e.actionType === 'LOGIN_FAILED')).toBe(true);
  });

  test('invalid OTP → login fails, no session created', () => {
    sessionMgr.initiateLogin(user, 'CorrectPass99');
    mfa.generateCode(user.userID, user.email);

    const result = sessionMgr.completeLogin(user, '000000');
    expect(result.success).toBe(false);
    expect(result.sessionToken).toBeUndefined();
  });

  test('second login replaces first session (single session policy)', () => {
    // First login
    sessionMgr.initiateLogin(user, 'CorrectPass99');
    let otp = mfa.generateCode(user.userID, user.email);
    const first = sessionMgr.completeLogin(user, otp);
    const firstToken = first.sessionToken;

    // Second login
    sessionMgr.initiateLogin(user, 'CorrectPass99');
    otp = mfa.generateCode(user.userID, user.email);
    const second = sessionMgr.completeLogin(user, otp);
    const secondToken = second.sessionToken;

    // Old token must be invalid
    expect(user.validateSession(firstToken)).toBe(false);
    expect(user.validateSession(secondToken)).toBe(true);
  });

  test('account locked after 5 failed attempts', () => {
    for (let i = 0; i < 5; i++) {
      sessionMgr.initiateLogin(user, 'wrong');
    }
    const result = sessionMgr.initiateLogin(user, 'CorrectPass99');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/locked/i);
  });

  test('logout invalidates session', () => {
    sessionMgr.initiateLogin(user, 'CorrectPass99');
    const otp = mfa.generateCode(user.userID, user.email);
    const { sessionToken } = sessionMgr.completeLogin(user, otp);

    sessionMgr.logout(user);
    expect(user.validateSession(sessionToken)).toBe(false);

    const logs = auditLog.queryByUser('U-001');
    expect(logs.some(e => e.actionType === 'LOGOUT')).toBe(true);
  });
});
