/**
 * @file document-lock.js
 * @description Manages document reservation/locking to prevent concurrent edits.
 * Implements the Observer pattern: other users (observers) are notified when
 * a document's lock state changes.
 *
 * notifies them on lock/unlock events.
 *
 */

'use strict';

const LOCK_TTL_MS = 30 * 60 * 1000; // Locks expire after 30 minutes if not released

class DocumentLock {
  #lockState = null;       // { lockedByUserID, lockedAt, expiresAt }
  #observers = new Set();  // Set of callback functions

  /**
   * @param {string} docID - ID of the document being managed
   */
  constructor(docID) {
    this.docID = docID;
  }

  // ─── Observer registration ───────────────────────────────────────────────────

  /**
   * Registers an observer to be notified on lock state changes.
   * @param {Function} callback - fn(event: { docID, type, lockedByUserID })
   */
  addObserver(callback) {
    this.#observers.add(callback);
  }

  /**
   * Removes a registered observer.
   * @param {Function} callback
   */
  removeObserver(callback) {
    this.#observers.delete(callback);
  }

  /**
   * Notifies all observers of a lock event.
   * @param {string} type - 'LOCKED' | 'UNLOCKED' | 'EXPIRED'
   * @param {string} userID
   */
  #notify(type, userID) {
    const event = { docID: this.docID, type, lockedByUserID: userID };
    // Each observer is called independently — one failing won't block others
    for (const observer of this.#observers) {
      try {
        observer(event);
      } catch (err) {
        console.error('[DocumentLock] Observer error:', err.message);
      }
    }
  }

  // ─── Lock operations ─────────────────────────────────────────────────────────

  /**
   * Attempts to lock the document for the requesting user.
   * @param {string} userID
   * @returns {{ success: boolean, message: string }}
   */
  lock(userID) {
    // Check if there is an existing unexpired lock held by someone else
    if (this.isLocked() && this.#lockState.lockedByUserID !== userID) {
      return {
        success: false,
        message: `Document is reserved by user ${this.#lockState.lockedByUserID}.`
      };
    }

    this.#lockState = {
      lockedByUserID: userID,
      lockedAt: new Date(),
      expiresAt: new Date(Date.now() + LOCK_TTL_MS)
    };

    this.#notify('LOCKED', userID);
    return { success: true, message: 'Document reserved successfully.' };
  }

  /**
   * Releases the lock. Only the lock owner (or SYSTEM) can release.
   * @param {string} userID
   * @returns {{ success: boolean, message: string }}
   */
  unlock(userID) {
    if (!this.isLocked()) {
      return { success: false, message: 'Document is not currently reserved.' };
    }

    if (this.#lockState.lockedByUserID !== userID && userID !== 'SYSTEM') {
      return { success: false, message: 'Only the reservation owner can release this document.' };
    }

    const previousOwner = this.#lockState.lockedByUserID;
    this.#lockState = null;
    this.#notify('UNLOCKED', previousOwner);
    return { success: true, message: 'Reservation released.' };
  }

  /**
   * Checks whether the document is currently locked (and lock has not expired).
   * @returns {boolean}
   */
  isLocked() {
    if (!this.#lockState) return false;

    if (Date.now() > this.#lockState.expiresAt.getTime()) {
      // Lock has expired — auto-release and notify
      const expiredOwner = this.#lockState.lockedByUserID;
      this.#lockState = null;
      this.#notify('EXPIRED', expiredOwner);
      return false;
    }

    return true;
  }

  /**
   * Returns current lock state for display (no private internals).
   * @returns {{ lockedByUserID: string, lockedAt: Date, expiresAt: Date } | null}
   */
  getLockInfo() {
    if (!this.isLocked()) return null;
    return { ...this.#lockState }; // shallow copy — prevents external mutation
  }
}

module.exports = DocumentLock;
