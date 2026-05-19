/**
 * @file document-upload-flow.test.js
 * @description Integration test for the full document upload and access flow.
 * Tests the interaction between AccessControlService, SecurityProxy,
 * DocumentRepository, and AuditLog.
 *
 * Verifies: authenticated upload → encrypted storage → authorised download → audit trail.
 */

'use strict';

const Engineer                        = require('../../src/auth/engineer');
const Supervisor                      = require('../../src/auth/supervisor');
const AuditLog                        = require('../../src/audit/audit-log');
const DocumentRepository              = require('../../src/documents/document-repository');
const { SecurityProxy, ValidationError } = require('../../src/security/security-proxy');
const { AccessControlService, AccessDeniedError } = require('../../src/security/access-control-service');

function setupSystem() {
  const auditLog    = new AuditLog();
  const docRepo     = new DocumentRepository();
  const proxy       = new SecurityProxy(docRepo, auditLog);
  const accessCtrl  = new AccessControlService(auditLog);
  return { auditLog, docRepo, proxy, accessCtrl };
}

const VALID_FILE = {
  name: 'bridge-spec.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  content: 'confidential bridge design content'
};

const VALID_META = {
  title: 'Bridge Design Spec',
  category: 'design-specification',
  classificationLevel: 'confidential'
};

describe('Integration: Document Upload & Download Flow', () => {
  let engineer, supervisor, token, system;

  beforeEach(() => {
    system     = setupSystem();
    engineer   = new Engineer('U-001', 'alice@techbuild.com', 'Pass99');
    supervisor = new Supervisor('U-003', 'bob@techbuild.com', 'SPass99');
    token      = engineer.createSession(); // bypass MFA for integration speed
  });

  test('engineer with valid session can upload a document', () => {
    system.accessCtrl.authorise(engineer, token, 'upload');
    const docID = system.proxy.upload(engineer.userID, VALID_FILE, VALID_META);

    expect(typeof docID).toBe('string');
    expect(docID.length).toBeGreaterThan(0);
  });

  test('upload is recorded in the audit log with timestamp', () => {
    system.accessCtrl.authorise(engineer, token, 'upload');
    const docID = system.proxy.upload(engineer.userID, VALID_FILE, VALID_META);

    const logs = system.auditLog.queryByDocument(docID);
    expect(logs.some(e => e.actionType === 'UPLOAD_SUCCESS')).toBe(true);
    expect(logs[0].timestamp).toBeDefined();
  });

  test('uploaded content is retrievable and decrypts correctly', () => {
    system.accessCtrl.authorise(engineer, token, 'upload');
    const docID = system.proxy.upload(engineer.userID, VALID_FILE, VALID_META);

    system.accessCtrl.authorise(engineer, token, 'download', docID);
    const { content } = system.proxy.download(engineer.userID, docID);

    expect(content).toBe(VALID_FILE.content);
  });

  test('supervisor cannot upload — access denied', () => {
    const supToken = supervisor.createSession();

    expect(() => {
      system.accessCtrl.authorise(supervisor, supToken, 'upload');
    }).toThrow(AccessDeniedError);
  });

  test('unauthenticated request (bad token) is denied', () => {
    expect(() => {
      system.accessCtrl.authorise(engineer, 'bad-token', 'upload');
    }).toThrow(AccessDeniedError);
  });

  test('rejected file type is caught before reaching repository', () => {
    system.accessCtrl.authorise(engineer, token, 'upload');
    const badFile = { ...VALID_FILE, mimeType: 'application/x-executable' };

    expect(() => system.proxy.upload(engineer.userID, badFile, VALID_META))
      .toThrow(ValidationError);

    // Confirm rejection is logged
    const logs = system.auditLog.queryByUser(engineer.userID);
    expect(logs.some(e => e.actionType === 'UPLOAD_BLOCKED')).toBe(true);
  });
});
