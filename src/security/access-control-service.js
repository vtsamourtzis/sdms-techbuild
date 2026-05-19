/**
 * @file access-control-service.js
 * @description Enforces role-based access control for all document operations.
 * Implements the Strategy pattern: the permission-checking algorithm is
 * encapsulated and delegated to the User's own hasPermission() method,
 * keeping this service decoupled from role-specific logic.
 *
 * Default-deny: any action not explicitly permitted is rejected.
 *
 *      Low coupling: only depends on the User interface, not concrete subclasses.
 */

'use strict';

class AccessDeniedError extends Error {
  constructor(userID, action) {
    super(`Access denied: user "${userID}" is not permitted to perform "${action}"`);
    this.name = 'AccessDeniedError';
    this.userID = userID;
    this.action = action;
  }
}

class AccessControlService {
  /**
   * @param {AuditLog} auditLog - injected audit logger
   */
  constructor(auditLog) {
    this.auditLog = auditLog;
  }

  /**
   * Checks whether the user holds an active session.
   * Must pass before any action is checked.
   * @param {User}   user
   * @param {string} sessionToken
   * @returns {boolean}
   */
  isAuthenticated(user, sessionToken) {
    return user.validateSession(sessionToken);
  }

  /**
   * Authorises an action. Throws AccessDeniedError if denied.
   * Logs both approvals and denials to the audit trail.
   *
   * @param {User}   user         - the requesting user
   * @param {string} sessionToken - active session token
   * @param {string} action       - the action being requested
   * @param {string} [targetID]   - optional resource ID for the log
   * @throws {AccessDeniedError}
   */
  authorise(user, sessionToken, action, targetID = null) {
    // Step 1: Verify active session before checking permissions
    if (!this.isAuthenticated(user, sessionToken)) {
      this.auditLog.record(user.userID, 'AUTH_FAILED', 'invalid session token', targetID);
      throw new AccessDeniedError(user.userID, action);
    }

    // Step 2: Delegate permission check to the user's role strategy
    if (!user.hasPermission(action)) {
      this.auditLog.record(user.userID, 'ACCESS_DENIED', `action: ${action}`, targetID);
      throw new AccessDeniedError(user.userID, action);
    }

    // Authorised — log the approved action
    this.auditLog.record(user.userID, 'ACCESS_GRANTED', `action: ${action}`, targetID);
  }

  /**
   * Non-throwing version — returns true/false without logging.
   * Useful for UI conditional rendering without triggering audit noise.
   * @param {User}   user
   * @param {string} action
   * @returns {boolean}
   */
  canPerform(user, action) {
    return user.hasPermission(action);
  }
}

module.exports = { AccessControlService, AccessDeniedError };
