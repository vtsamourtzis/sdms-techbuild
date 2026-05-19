/**
 * @file document.js
 * @description Represents a managed engineering document in the SDMS.
 * Tracks metadata, version history, and classification level.
 * Encryption of file content is delegated to SecurityProxy (Single Responsibility).
 *
 */

'use strict';

const crypto = require('crypto');

// Valid categories for document classification
const VALID_CATEGORIES = new Set([
  'design-specification',
  'report',
  'test-plan',
  'compliance-record',
  'meeting-minutes',
  'other'
]);

class Document {
  #versionHistory = [];

  /**
   * @param {string} title           - human-readable document title
   * @param {string} category        - must be one of VALID_CATEGORIES
   * @param {string} ownerID         - userID of the uploader
   * @param {string} filePath        - storage path / reference
   * @param {string} [classLevel]    - 'public' | 'internal' | 'confidential'
   */
  constructor(title, category, ownerID, filePath, classLevel = 'internal') {
    if (!VALID_CATEGORIES.has(category)) {
      throw new Error(`Invalid category: "${category}". Must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
    }

    this.docID = crypto.randomUUID();
    this.title = title;
    this.category = category;
    this.ownerID = ownerID;
    this.filePath = filePath;
    this.classificationLevel = classLevel;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.versionNo = 1;
    this.isArchived = false;
    this.retentionUntil = null; // set by compliance policy if needed

    // Record initial version
    this.#versionHistory.push({ version: 1, at: this.createdAt, by: ownerID });
  }

  /**
   * Updates document metadata and bumps version.
   * @param {object} updates         - { title?, category?, classificationLevel? }
   * @param {string} updatedByUserID
   */
  updateMetadata(updates, updatedByUserID) {
    if (updates.category && !VALID_CATEGORIES.has(updates.category)) {
      throw new Error(`Invalid category: "${updates.category}"`);
    }

    // Apply only provided fields (partial update pattern)
    if (updates.title)               this.title = updates.title;
    if (updates.category)            this.category = updates.category;
    if (updates.classificationLevel) this.classificationLevel = updates.classificationLevel;

    this.versionNo += 1;
    this.updatedAt = new Date();
    this.#versionHistory.push({ version: this.versionNo, at: this.updatedAt, by: updatedByUserID });
  }

  /**
   * Marks the document as archived (soft delete).
   * Archived documents are retained but not accessible to regular users.
   */
  archive() {
    this.isArchived = true;
    this.updatedAt = new Date();
  }

  /**
   * Returns the full version history (read-only copy).
   * @returns {object[]}
   */
  getVersionHistory() {
    return [...this.#versionHistory];
  }

  /**
   * @returns {object} Public metadata representation
   */
  toMetadata() {
    return {
      docID: this.docID,
      title: this.title,
      category: this.category,
      ownerID: this.ownerID,
      classificationLevel: this.classificationLevel,
      versionNo: this.versionNo,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      isArchived: this.isArchived
    };
  }
}

module.exports = { Document, VALID_CATEGORIES };
