/**
 * @file document-repository.js
 * @description Abstracts document storage and retrieval (Repository pattern).
 * SecurityProxy calls this after all security checks pass.
 * All callers interact with the same interface regardless of the
 * underlying storage mechanism (in-memory here; database in production).
 *
 */

'use strict';

const { Document } = require('./document');

class DocumentRepository {
  // In-memory document store: docID → { metadata: Document, content: string }
  #store = new Map();

  /**
   * Saves an encrypted document and its metadata.
   * @param {string} ownerID
   * @param {object} file     - { name, mimeType, sizeBytes, content } (content already encrypted)
   * @param {object} metadata - { title, category, classificationLevel }
   * @returns {string} docID
   */
  save(ownerID, file, metadata) {
    const doc = new Document(
      metadata.title || file.name,
      metadata.category || 'other',
      ownerID,
      file.name,
      metadata.classificationLevel || 'internal'
    );

    this.#store.set(doc.docID, { metadata: doc, content: file.content });
    return doc.docID;
  }

  /**
   * Retrieves a stored document by ID.
   * @param {string} docID
   * @returns {{ metadata: Document, content: string } | null}
   */
  retrieve(docID) {
    return this.#store.get(docID) ?? null;
  }

  /**
   * Searches documents by keyword (title match) and optional category filter.
   * @param {string}  keyword
   * @param {string}  [category]
   * @returns {object[]} array of document metadata objects
   */
  search(keyword, category = null) {
    const results = [];
    for (const { metadata } of this.#store.values()) {
      if (metadata.isArchived) continue;
      const titleMatch = metadata.title.toLowerCase().includes(keyword.toLowerCase());
      const categoryMatch = !category || metadata.category === category;
      if (titleMatch && categoryMatch) results.push(metadata.toMetadata());
    }
    return results;
  }

  /**
   * Returns all document metadata (for admin/report use).
   * @returns {object[]}
   */
  listAll() {
    return [...this.#store.values()].map(({ metadata }) => metadata.toMetadata());
  }

  /**
   * Checks whether a document ID exists in the store.
   * @param {string} docID
   * @returns {boolean}
   */
  exists(docID) {
    return this.#store.has(docID);
  }
}

module.exports = DocumentRepository;
