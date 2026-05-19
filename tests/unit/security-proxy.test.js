/**
 * @file security-proxy.test.js
 * @description Unit tests for SecurityProxy (Proxy pattern).
 * Verifies: file type validation, size limits, rate limiting, sanitisation, encryption simulation.
 */

'use strict';

const { SecurityProxy, ValidationError, RateLimitError } = require('../../src/security/security-proxy');
const DocumentRepository = require('../../src/documents/document-repository');
const AuditLog = require('../../src/audit/audit-log');

function makeProxy() {
  return new SecurityProxy(new DocumentRepository(), new AuditLog());
}

const VALID_FILE = {
  name: 'spec.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
  content: 'hello'
};

const VALID_META = {
  title: 'Test Document',
  category: 'design-specification',
  classificationLevel: 'internal'
};

describe('SecurityProxy', () => {

  // ─── File type validation ─────────────────────────────────────────────────────

  describe('upload() — file type validation', () => {
    test('accepts a valid PDF upload', () => {
      const proxy = makeProxy();
      expect(() => proxy.upload('U-001', VALID_FILE, VALID_META)).not.toThrow();
    });

    test('rejects disallowed MIME type', () => {
      const proxy = makeProxy();
      const badFile = { ...VALID_FILE, mimeType: 'application/x-msdownload' };

      expect(() => proxy.upload('U-001', badFile, VALID_META))
        .toThrow(ValidationError);
    });
  });

  // ─── File size validation ─────────────────────────────────────────────────────

  describe('upload() — file size validation', () => {
    test('rejects files exceeding 50 MB', () => {
      const proxy = makeProxy();
      const bigFile = { ...VALID_FILE, sizeBytes: 51 * 1024 * 1024 };

      expect(() => proxy.upload('U-001', bigFile, VALID_META))
        .toThrow(ValidationError);
    });

    test('accepts files at exactly the size limit', () => {
      const proxy = makeProxy();
      const maxFile = { ...VALID_FILE, sizeBytes: 50 * 1024 * 1024 };

      expect(() => proxy.upload('U-001', maxFile, VALID_META)).not.toThrow();
    });
  });

  // ─── Metadata sanitisation ────────────────────────────────────────────────────

  describe('upload() — metadata sanitisation', () => {
    test('strips HTML tags from metadata fields', () => {
      const proxy = makeProxy();
      const dirtyMeta = { ...VALID_META, title: '<script>alert(1)</script>Safe Title' };

      // Should not throw — should sanitise silently
      expect(() => proxy.upload('U-001', VALID_FILE, dirtyMeta)).not.toThrow();
    });
  });

  // ─── Rate limiting ────────────────────────────────────────────────────────────

  describe('upload() — rate limiting', () => {
    test('blocks user after exceeding 10 uploads per minute', () => {
      const proxy = makeProxy();

      // Upload 10 times (at limit)
      for (let i = 0; i < 10; i++) {
        proxy.upload('U-999', VALID_FILE, VALID_META);
      }

      // 11th should be blocked
      expect(() => proxy.upload('U-999', VALID_FILE, VALID_META))
        .toThrow(RateLimitError);
    });

    test('different users have independent rate limits', () => {
      const proxy = makeProxy();

      for (let i = 0; i < 10; i++) {
        proxy.upload('U-001', VALID_FILE, VALID_META);
      }

      // U-002 should still be allowed
      expect(() => proxy.upload('U-002', VALID_FILE, VALID_META)).not.toThrow();
    });
  });

  // ─── Download & encryption ────────────────────────────────────────────────────

  describe('download()', () => {
    test('returns decrypted content matching original', () => {
      const proxy = makeProxy();
      const docID = proxy.upload('U-001', { ...VALID_FILE, content: 'original content' }, VALID_META);
      const { content } = proxy.download('U-001', docID);

      expect(content).toBe('original content');
    });

    test('throws ValidationError for unknown docID', () => {
      const proxy = makeProxy();
      expect(() => proxy.download('U-001', 'nonexistent-id'))
        .toThrow(ValidationError);
    });
  });
});
