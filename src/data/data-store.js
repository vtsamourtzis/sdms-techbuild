/**
 * @file data-store.js
 * @description Implements the Singleton design pattern for shared in-memory persistence.
 *
 * - Only one DataStore instance ever exists in the process.
 * - All services (AuthService, DocumentService, AuditLog, etc.) access the
 *   same collections through DataStore.getInstance().
 * - getInstance() is the code marker: it always returns the same object.
 *
 * Why it fits SDMS: Multiple independent services (auth, documents, audit, reports)
 * all need to read and write to the same data. Without a Singleton, each service
 * could create its own Map and never see each other's data. The Singleton ensures
 * there is exactly one source of truth for the entire running application.
 *
 */

'use strict';

const crypto = require('crypto');

class DataStore {
  // The single shared instance (class-level, not instance-level)
  static #instance = null;

  // In-memory collections: each is a Map of id -> record
  #collections = new Map([
    ['users',         new Map()],
    ['documents',     new Map()],
    ['auditLogs',     new Map()],
    ['notifications', new Map()],
    ['settings',      new Map()],
  ]);

  /**
   * Private constructor — prevents external instantiation.
   * Use DataStore.getInstance() instead.
   */
  constructor() {
    if (DataStore.#instance) {
      throw new Error('Use DataStore.getInstance() to access the data store.');
    }
    // Seed default settings
    this.#collections.get('settings').set('maintenance_mode', { key: 'maintenance_mode', value: false });
  }

  /**
   * Returns the single shared DataStore instance.
   * Creates it on first call; returns the cached instance on all subsequent calls.
   * @returns {DataStore}
   */
  static getInstance() {
    if (!DataStore.#instance) {
      DataStore.#instance = new DataStore();
    }
    return DataStore.#instance;
  }

  // ─── Generic collection operations ──────────────────────────────────────────

  /**
   * Inserts a record into a collection. Auto-assigns an id if not provided.
   * @param {string} collectionName
   * @param {object} record
   * @returns {object} the stored record (with id and timestamps)
   */
  insert(collectionName, record) {
    const col = this.#getCol(collectionName);
    const now = new Date().toISOString();
    const stored = {
      id: record.id || crypto.randomUUID(),
      createdAt: record.createdAt || now,
      updatedAt: now,
      ...record,
    };
    col.set(stored.id, stored);
    return { ...stored };
  }

  /**
   * Finds a record by its id.
   * @param {string} collectionName
   * @param {string} id
   * @returns {object|null}
   */
  findById(collectionName, id) {
    const record = this.#getCol(collectionName).get(id);
    return record ? { ...record } : null;
  }

  /**
   * Finds the first record matching a predicate function.
   * @param {string} collectionName
   * @param {Function} predicate
   * @returns {object|null}
   */
  findOne(collectionName, predicate) {
    for (const record of this.#getCol(collectionName).values()) {
      if (predicate(record)) return { ...record };
    }
    return null;
  }

  /**
   * Returns all records in a collection matching an optional predicate.
   * @param {string} collectionName
   * @param {Function} [predicate]
   * @returns {object[]}
   */
  findAll(collectionName, predicate = () => true) {
    return [...this.#getCol(collectionName).values()]
      .filter(predicate)
      .map(r => ({ ...r }));
  }

  /**
   * Updates a record by id with a partial patch.
   * @param {string} collectionName
   * @param {string} id
   * @param {object} patch
   * @returns {object|null} updated record or null if not found
   */
  update(collectionName, id, patch) {
    const col = this.#getCol(collectionName);
    const existing = col.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    col.set(id, updated);
    return { ...updated };
  }

  /**
   * Deletes a record by id.
   * @param {string} collectionName
   * @param {string} id
   * @returns {boolean} true if deleted, false if not found
   */
  delete(collectionName, id) {
    return this.#getCol(collectionName).delete(id);
  }

  /**
   * Deletes all records matching a predicate.
   * @param {string} collectionName
   * @param {Function} predicate
   * @returns {number} count of deleted records
   */
  deleteWhere(collectionName, predicate) {
    const col = this.#getCol(collectionName);
    let count = 0;
    for (const [id, record] of col.entries()) {
      if (predicate(record)) { col.delete(id); count++; }
    }
    return count;
  }

  // ─── Settings helpers ────────────────────────────────────────────────────────

  getSetting(key, fallback = null) {
    const record = this.#collections.get('settings').get(key);
    return record ? record.value : fallback;
  }

  setSetting(key, value) {
    this.#collections.get('settings').set(key, { key, value, updatedAt: new Date().toISOString() });
  }

  // ─── Test utility ────────────────────────────────────────────────────────────

  /**
   * Clears all collections and resets settings to defaults.
   * Used by test suite beforeEach hooks.
   */
  resetForTests() {
    for (const col of this.#collections.values()) col.clear();
    this.#collections.get('settings').set('maintenance_mode', { key: 'maintenance_mode', value: false });
  }

  // ─── Private helper ─────────────────────────────────────────────────────────

  #getCol(name) {
    const col = this.#collections.get(name);
    if (!col) throw new Error(`Unknown collection: "${name}"`);
    return col;
  }
}

// Export the singleton instance directly — callers just require() and use it
module.exports = DataStore.getInstance();
module.exports.DataStore = DataStore;
