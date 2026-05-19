/**
 * @file document-factory.js
 * @description Implements the Factory Method design pattern for document creation.
 *
 * - Controllers and services never construct Document objects directly.
 * - All creation goes through DocumentFactory.createDocument(category, data).
 * - The factory validates the category, applies category-specific rules,
 *   and returns a fully initialised Document instance.
 *
 * Why it fits SDMS: document categorisation is required (design specifications,
 * reports, etc.). Different categories can have different validation rules and
 * access policies. Centralising creation here ensures no document is ever stored
 * with an invalid or missing category, and makes it trivial to add new categories
 * in the future without changing callers.
 *
 */

'use strict';

const { Document, VALID_CATEGORIES } = require('./document');

// Category-specific rules applied at creation time
const CATEGORY_RULES = {
  'design-specification': { defaultClassification: 'confidential', requiresOwnerApproval: true },
  'report':               { defaultClassification: 'internal',     requiresOwnerApproval: false },
  'test-plan':            { defaultClassification: 'internal',     requiresOwnerApproval: false },
  'compliance-record':    { defaultClassification: 'confidential', requiresOwnerApproval: true },
  'meeting-minutes':      { defaultClassification: 'internal',     requiresOwnerApproval: false },
  'other':                { defaultClassification: 'internal',     requiresOwnerApproval: false },
};

class DocumentFactory {
  /**
   * Creates and returns a validated Document instance.
   *
   * @param {string} category  - must be one of VALID_CATEGORIES
   * @param {object} data      - { title, ownerID, filePath, classificationLevel? }
   * @returns {Document}       - fully initialised Document
   * @throws {Error}           - if category is unknown or required fields are missing
   */
  static createDocument(category, data) {
    // Validate category before constructing anything
    if (!VALID_CATEGORIES.has(category)) {
      throw new Error(
        `Unknown document category: "${category}". ` +
        `Valid categories are: ${[...VALID_CATEGORIES].join(', ')}.`
      );
    }

    if (!data.title || !data.ownerID) {
      throw new Error('Document requires at least a title and an ownerID.');
    }

    // Apply category-specific default classification if not explicitly provided
    const rules = CATEGORY_RULES[category];
    const classLevel = data.classificationLevel || rules.defaultClassification;

    const doc = new Document(
      data.title,
      category,
      data.ownerID,
      data.filePath || '',
      classLevel
    );

    // Attach category metadata for downstream use
    doc.requiresOwnerApproval = rules.requiresOwnerApproval;

    return doc;
  }

  /**
   * Returns the list of valid categories and their rules.
   * Useful for rendering category dropdowns in the UI.
   * @returns {object[]}
   */
  static getCategories() {
    return [...VALID_CATEGORIES].map(cat => ({
      value: cat,
      label: cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      defaultClassification: CATEGORY_RULES[cat].defaultClassification,
      requiresOwnerApproval: CATEGORY_RULES[cat].requiresOwnerApproval,
    }));
  }
}

module.exports = DocumentFactory;
