/**
 * @file security-proxy.js
 * @description Intercepts all document upload and download operations.
 * Implements the Proxy design pattern: wraps the real document operation
 * and enforces security checks (validation, sanitisation, rate limiting,
 * encryption) before allowing the operation to proceed.
 *
 * SRP: This class only handles security enforcement; storage is delegated.
 */

'use strict';

// Allowed MIME types for document uploads
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
]);

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

// Rate limiting: track upload counts per user per minute
const RATE_WINDOW_MS = 60 * 1000;
const MAX_UPLOADS_PER_WINDOW = 10;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class RateLimitError extends Error {
  constructor(userID) {
    super(`Rate limit exceeded for user "${userID}". Try again shortly.`);
    this.name = 'RateLimitError';
  }
}

class SecurityProxy {
  #uploadCounts = new Map(); // userID → { count, windowStart }

  /**
   * @param {DocumentRepository} documentRepository - the real storage service (proxied)
   * @param {AuditLog}           auditLog           - audit logger
   */
  constructor(documentRepository, auditLog) {
    this.documentRepository = documentRepository;
    this.auditLog = auditLog;
  }

  // ─── Proxy: Upload ────────────────────────────────────────────────────────────

  /**
   * Intercepts an upload request, validates and sanitises, then delegates.
   * @param {string} userID
   * @param {object} file       - { name, mimeType, sizeBytes, content }
   * @param {object} metadata   - { title, category, classificationLevel }
   * @returns {string} docID of saved document
   * @throws {ValidationError | RateLimitError}
   */
  upload(userID, file, metadata) {
    // 1. Rate limiting check
    this.#checkRateLimit(userID);

    // 2. File type validation
    if (!ALLOWED_MIME_TYPES.has(file.mimeType)) {
      this.auditLog.record(userID, 'UPLOAD_BLOCKED', `disallowed type: ${file.mimeType}`);
      throw new ValidationError(`File type "${file.mimeType}" is not permitted.`);
    }

    // 3. File size validation
    if (file.sizeBytes > MAX_FILE_SIZE_BYTES) {
      this.auditLog.record(userID, 'UPLOAD_BLOCKED', `file too large: ${file.sizeBytes} bytes`);
      throw new ValidationError(`File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`);
    }

    // 4. Metadata sanitisation — strip any script-like content
    const sanitisedMetadata = this.#sanitiseMetadata(metadata);

    // 5. Simulate encryption of file content before storage
    const encryptedContent = this.#encryptContent(file.content);

    // 6. Delegate to real document repository
    const docID = this.documentRepository.save(userID, { ...file, content: encryptedContent }, sanitisedMetadata);

    // 7. Audit the successful upload with timestamp
    this.auditLog.record(userID, 'UPLOAD_SUCCESS', `file: ${file.name}`, docID);
    this.#incrementUploadCount(userID);

    return docID;
  }

  // ─── Proxy: Download ──────────────────────────────────────────────────────────

  /**
   * Intercepts a download request, decrypts content, and returns it.
   * @param {string} userID
   * @param {string} docID
   * @returns {object} { metadata, content }
   */
  download(userID, docID) {
    const stored = this.documentRepository.retrieve(docID);
    if (!stored) throw new ValidationError(`Document "${docID}" not found.`);

    // Decrypt content on retrieval
    const decryptedContent = this.#decryptContent(stored.content);

    // Audit download with timestamp
    this.auditLog.record(userID, 'DOWNLOAD_SUCCESS', `docID: ${docID}`, docID);

    return { metadata: stored.metadata, content: decryptedContent };
  }

  // ─── Private: Security helpers ────────────────────────────────────────────────

  /**
   * Removes HTML tags and script patterns from metadata strings.
   * In production this would use a proper sanitisation library.
   * @param {object} metadata
   * @returns {object} sanitised metadata
   */
  #sanitiseMetadata(metadata) {
    const sanitise = (str) =>
      typeof str === 'string'
        ? str.replace(/<[^>]*>/g, '').replace(/[<>"']/g, '').trim()
        : str;

    return Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => [k, sanitise(v)])
    );
  }

  /**
   * Simulates AES-256 encryption of file content.
   * In production: use Node crypto with a real key management service.
   * @param {string|Buffer} content
   * @returns {string} base64-encoded "encrypted" content
   */
  #encryptContent(content) {
    // Simulation: base64 encode represents the encrypted payload
    return Buffer.from(content ?? '').toString('base64') + ':encrypted';
  }

  /**
   * Reverses the simulated encryption.
   * @param {string} encryptedContent
   * @returns {string}
   */
  #decryptContent(encryptedContent) {
    const payload = encryptedContent.replace(':encrypted', '');
    return Buffer.from(payload, 'base64').toString('utf-8');
  }

  /**
   * Enforces upload rate limit per user per time window.
   * @param {string} userID
   * @throws {RateLimitError}
   */
  #checkRateLimit(userID) {
    const now = Date.now();
    const record = this.#uploadCounts.get(userID);

    if (!record || (now - record.windowStart) > RATE_WINDOW_MS) {
      // New window — reset counter
      this.#uploadCounts.set(userID, { count: 0, windowStart: now });
      return;
    }

    if (record.count >= MAX_UPLOADS_PER_WINDOW) {
      this.auditLog.record(userID, 'RATE_LIMIT_EXCEEDED', `uploads: ${record.count}`);
      throw new RateLimitError(userID);
    }
  }

  #incrementUploadCount(userID) {
    const record = this.#uploadCounts.get(userID);
    if (record) record.count += 1;
  }
}

module.exports = { SecurityProxy, ValidationError, RateLimitError };
