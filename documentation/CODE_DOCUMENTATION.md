# SDMS — Developer Guide

> **Audience:** developers onboarding to the codebase, reviewers, or maintainers.
> This guide covers architecture, every module's public API, data flow, design patterns, testing, and the constraints of the current in-memory implementation.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Layout](#2-repository-layout)
3. [Technology Stack](#3-technology-stack)
4. [Architecture Overview](#4-architecture-overview)
5. [Module Reference](#5-module-reference)
   - 5.1 [DataStore — Singleton](#51-datastore--singleton)
   - 5.2 [User / Engineer / Manager / Supervisor — Strategy](#52-user--engineer--manager--supervisor--strategy)
   - 5.3 [MFAProvider](#53-mfaprovider)
   - 5.4 [SessionManager](#54-sessionmanager)
   - 5.5 [AuditLog](#55-auditlog)
   - 5.6 [Document](#56-document)
   - 5.7 [DocumentFactory — Factory Method](#57-documentfactory--factory-method)
   - 5.8 [DocumentRepository — Repository](#58-documentrepository--repository)
   - 5.9 [DocumentLock — Observer](#59-documentlock--observer)
   - 5.10 [SecurityProxy — Proxy](#510-securityproxy--proxy)
   - 5.11 [AccessControlService](#511-accesscontrolservice)
   - 5.12 [Report](#512-report)
6. [Web Layer (`web/`)](#6-web-layer-web)
   - 6.1 [server.js — Route Map](#61-serverjs--route-map)
   - 6.2 [Middleware Chain](#62-middleware-chain)
   - 6.3 [In-Memory Registries](#63-in-memory-registries)
   - 6.4 [EJS Views](#64-ejs-views)
7. [Authentication Flow (Step-by-Step)](#7-authentication-flow-step-by-step)
8. [Document Upload Flow (Step-by-Step)](#8-document-upload-flow-step-by-step)
9. [Design Patterns — Code Markers](#9-design-patterns--code-markers)
10. [Error Handling](#10-error-handling)
11. [Testing](#11-testing)
12. [Configuration & Environment](#12-configuration--environment)
13. [Known Limitations & Production Gaps](#13-known-limitations--production-gaps)

---

## 1. Project Overview

The **Secure Document Management System (SDMS)** is a Node.js/Express web application designed for engineering organisations. It enforces:

- Two-factor authentication (password + OTP) before granting any session
- Role-based access control (Engineer, Manager, Supervisor)
- Document upload with MIME validation, size limits, and simulated AES-256 encryption
- Document reservation/locking to prevent concurrent edits
- Tamper-evident audit logging of every security event
- Activity report generation (Manager/Supervisor only)
- Maintenance mode that locks out engineers without destroying their accounts

All persistence is **in-memory** (JavaScript `Map` objects). No database, no file system writes. The process is the database; restarting clears all state.

---

## 2. Repository Layout

```
sdms-techbuild/
├── src/                        # Core business logic (no Express dependency)
│   ├── index.js                # Wiring demo — shows all components in action
│   ├── audit/
│   │   └── audit-log.js        # Central event logger
│   ├── auth/
│   │   ├── user.js             # Base User class (private #passwordHash)
│   │   ├── engineer.js         # Engineer subclass — document permissions
│   │   ├── manager.js          # Manager subclass — document + report permissions
│   │   ├── supervisor.js       # Supervisor subclass — report-only permissions
│   │   ├── mfa-provider.js     # OTP generation and verification
│   │   └── session-manager.js  # Login orchestration + lockout
│   ├── data/
│   │   └── data-store.js       # Singleton in-memory store (generic collections)
│   ├── documents/
│   │   ├── document.js         # Document entity + version history
│   │   ├── document-factory.js # Factory Method — creates validated Documents
│   │   ├── document-lock.js    # Observer — reservation with TTL
│   │   └── document-repository.js  # Repository — storage abstraction
│   ├── reports/
│   │   └── report.js           # Activity report generator
│   └── security/
│       ├── access-control-service.js  # Strategy — delegates to User.hasPermission()
│       └── security-proxy.js          # Proxy — validates before every upload/download
│
├── web/                        # Express web server and views
│   ├── server.js               # All routes, middleware, in-memory registries
│   └── views/
│       ├── partials/
│       │   ├── head.ejs        # <head> + <body> open; supports authPage flag
│       │   ├── foot.ejs        # Closes </body></html>
│       │   ├── sidebar.ejs     # Role-aware navigation sidebar
│       │   ├── flash.ejs       # Flash message renderer
│       │   └── nav.ejs         # (legacy — replaced by sidebar)
│       ├── login.ejs
│       ├── register.ejs
│       ├── verify-otp.ejs
│       ├── dashboard.ejs
│       ├── upload.ejs
│       ├── search.ejs
│       ├── reports.ejs
│       ├── audit.ejs
│       └── maintenance.ejs
│
├── web/public/css/
│   └── style.css               # Single-file stylesheet (light sidebar, teal accent)
│
├── tests/
│   ├── unit/
│   │   ├── user.test.js
│   │   ├── audit-log.test.js
│   │   ├── document-lock.test.js
│   │   └── security-proxy.test.js
│   └── integration/
│       ├── auth-flow.test.js
│       └── document-upload-flow.test.js
│
├── docs/
│   ├── DESIGN_PATTERNS_NOTES.md
│   ├── DEMO_WALKTHROUGH.md
│   └── DEVELOPER_GUIDE.md      ← this file
│
├── package.json
└── README.md
```

---

## 3. Technology Stack

| Concern | Library | Version |
|---|---|---|
| Web framework | express | ^5.2.1 |
| Templating | ejs | ^5.0.2 |
| Session management | express-session | ^1.19.0 |
| Flash messages | connect-flash | ^0.1.1 |
| File upload | multer | ^2.1.1 |
| Testing | jest | ^29.7.0 |
| Runtime | Node.js | ≥18 (uses `#private` fields, `crypto.randomInt`) |

No build step. No TypeScript. No ORM. No environment variables required to start.

---

## 4. Architecture Overview

```
Browser
  │
  ▼
web/server.js  (Express)
  │  requireAuth      — checks session.userID + session.token
  │  requireRole()    — checks session.role against allowed set
  │  checkMaintenance — blocks 'engineer' when maintenanceMode === true
  │
  ├──► SessionManager  ──► MFAProvider    (OTP generation/verification)
  │                   ──► User            (password verify, session token)
  │                   ──► AuditLog        (event recording)
  │
  ├──► SecurityProxy   ──► DocumentRepository  (storage)
  │         │          ──► AuditLog            (every upload/download logged)
  │         │
  │    [rate limit → MIME check → size check → sanitise → encrypt → save]
  │
  ├──► DocumentFactory  (creates validated Document instances)
  │
  ├──► DocumentLock     (per-document lock; Observer pattern)
  │         └──► notifications[]  (in-memory feed, max 50)
  │
  └──► Report  ──► AuditLog.queryByDateRange()
```

**Key architectural decision:** the web layer (`server.js`) keeps its own `userRegistry: Map<userID, User>` and `emailRegistry: Map<email, userID>`. This is because `User` stores its password hash in a JavaScript `#private` field — it cannot be reconstructed from serialised data without the original plaintext. The live object created at registration is reused for every login check.

---

## 5. Module Reference

### 5.1 DataStore — Singleton

**File:** `src/data/data-store.js`

A generic key-value store organised into named collections. Shared across the entire process via the Singleton pattern.

```js
// Always the same instance
const dataStore = require('./data/data-store');

dataStore.insert('users', { id: 'u1', email: 'a@b.com' });
dataStore.findById('users', 'u1');
dataStore.findOne('users', r => r.email === 'a@b.com');
dataStore.findAll('users', r => r.isActive);
dataStore.update('users', 'u1', { lastLoginAt: new Date() });
dataStore.delete('users', 'u1');
dataStore.deleteWhere('users', r => !r.isActive);

// Settings helpers
dataStore.getSetting('maintenance_mode', false);
dataStore.setSetting('maintenance_mode', true);

// Test utility — wipes all collections and re-seeds defaults
dataStore.resetForTests();
```

**Collections seeded on boot:** `users`, `documents`, `auditLogs`, `notifications`, `settings`.

> **Note:** `server.js` does **not** use `DataStore` for users. It maintains its own `userRegistry` Map to preserve live `User` objects with their private `#passwordHash` fields intact.

---

### 5.2 User / Engineer / Manager / Supervisor — Strategy

**Files:** `src/auth/user.js`, `src/auth/engineer.js`, `src/auth/manager.js`, `src/auth/supervisor.js`

`User` is the base class. It encapsulates credentials using JavaScript private fields (`#passwordHash`, `#sessionToken`) so no external code can access raw secrets.

#### Constructor

```js
// Never instantiate User directly — use a subclass
const user = new Engineer(userID, email, password);
const user = new Manager(userID, email, password);
const user = new Supervisor(userID, email, password);
```

All three subclasses call `super(userID, email, password, role)`. The password is hashed with SHA-256 immediately and the plaintext is discarded.

#### Public API

| Method | Returns | Description |
|---|---|---|
| `verifyPassword(plaintext)` | `boolean` | Compares against stored SHA-256 hash |
| `createSession()` | `string` | Generates a 64-hex session token; replaces any prior session (RE-4) |
| `validateSession(token)` | `boolean` | Checks token matches the active session |
| `logout()` | `void` | Sets internal session token to `null` |
| `hasPermission(action)` | `boolean` | **Overridden per subclass** (Strategy pattern) |
| `toPublicProfile()` | `object` | Safe representation — no hash, no token |

#### Permission matrix

| Action | Engineer | Manager | Supervisor |
|---|---|---|---|
| `upload` | ✓ | ✓ | — |
| `download` | ✓ | ✓ | — |
| `search` | ✓ | ✓ | — |
| `reserve` | ✓ | ✓ | — |
| `updateMetadata` | ✓ | ✓ | — |
| `viewReports` | — | ✓ | ✓ |

`hasPermission()` is the Strategy hook — `AccessControlService.authorise()` calls it without knowing which subclass it is talking to.

---

### 5.3 MFAProvider

**File:** `src/auth/mfa-provider.js`

Generates and verifies 6-digit, 5-minute OTPs. One pending OTP per user at a time (stored in a private `#pendingOTPs: Map`).

```js
const mfa = new MFAProvider();

const code = mfa.generateCode(userID, email);
// Prints to console in dev mode:
// [MFAProvider] OTP for <userID>: 483920 (simulated email to <email>)

mfa.verifyCode(userID, '483920'); // → true (and consumes the OTP)
mfa.verifyCode(userID, '483920'); // → false (already consumed)

mfa.hasPendingOTP(userID); // → false
```

**TTL:** 5 minutes (`OTP_TTL_MS = 5 * 60 * 1000`). Expired OTPs are cleaned up on the next `verifyCode()` call.

**Production gap:** `generateCode()` currently only `console.log`s the code. In production, replace the `console.log` with a call to an email API (e.g. SendGrid, AWS SES).

---

### 5.4 SessionManager

**File:** `src/auth/session-manager.js`

Orchestrates the two-step login sequence and enforces account lockout after 5 consecutive failed passwords.

```js
const sessionMgr = new SessionManager(mfaProvider, auditLog);

// Step 1 — password check + OTP dispatch
const r1 = sessionMgr.initiateLogin(user, password);
// r1 = { success: true|false, message: string }

// Step 2 — OTP verification + session creation
const r2 = sessionMgr.completeLogin(user, otpCode);
// r2 = { success: true|false, sessionToken?: string, message: string }

// Logout
sessionMgr.logout(user);
```

**Lockout behaviour:**
- After 5 failed `initiateLogin()` calls for the same `userID`, the account is locked for 15 minutes.
- Lock state is stored in the private `#failedAttempts: Map<userID, { count, lockedUntil }>`.
- A successful `completeLogin()` clears the failure record for that user.

**Audit events emitted:** `LOGIN_BLOCKED`, `LOGIN_FAILED`, `OTP_DISPATCHED`, `OTP_FAILED`, `LOGIN_SUCCESS`, `LOGOUT`.

---

### 5.5 AuditLog

**File:** `src/audit/audit-log.js`

Append-only event log. Every security-relevant action in the system goes through here.

```js
const log = new AuditLog();

// Record an event
log.record(userID, 'UPLOAD_SUCCESS', 'file: design-spec.pdf', docID);
// Signature: record(userID, actionType, detail, targetID = null)

// Query
log.queryByUser(userID);           // → entry[]
log.queryByDocument(docID);        // → entry[]
log.queryByDateRange(from, to);    // → entry[] (Date objects)
log.getAllEntries();                // → entry[] (copy — callers cannot mutate)

// Retention enforcement (call from a scheduler in production)
log.purgeExpiredEntries();         // Removes entries older than 90 days
```

**Entry shape:**

```js
{
  logID:      string,   // UUID
  timestamp:  string,   // ISO 8601
  userID:     string,
  actionType: string,   // e.g. 'UPLOAD_SUCCESS'
  detail:     string,
  targetID:   string | null
}
```

**Known action types:** `REGISTER`, `LOGIN_FAILED`, `LOGIN_BLOCKED`, `OTP_DISPATCHED`, `OTP_FAILED`, `LOGIN_SUCCESS`, `LOGOUT`, `UPLOAD_SUCCESS`, `UPLOAD_BLOCKED`, `DOWNLOAD_SUCCESS`, `RATE_LIMIT_EXCEEDED`, `LOCK`, `UNLOCK`, `ACCESS_DENIED`, `ACCESS_GRANTED`, `AUTH_FAILED`, `MAINTENANCE_ON`, `MAINTENANCE_OFF`, `LOG_PURGE`.

---

### 5.6 Document

**File:** `src/documents/document.js`

The core entity. Tracks metadata and an append-only private version history (`#versionHistory`).

```js
const { Document, VALID_CATEGORIES } = require('./document');

// Direct construction (use DocumentFactory instead in application code)
const doc = new Document(title, category, ownerID, filePath, classLevel);

doc.updateMetadata({ title: 'Rev 2', classificationLevel: 'restricted' }, userID);
doc.archive();
doc.getVersionHistory(); // → [{ version, at, by }, ...]
doc.toMetadata();        // → public object (no private internals)
```

**Valid categories:** `design-specification`, `report`, `test-plan`, `compliance-record`, `meeting-minutes`, `other`.

**Valid classification levels:** `public`, `internal`, `confidential`, `restricted`.

**Default classification level:** `internal` (overridden per-category by `DocumentFactory`).

---

### 5.7 DocumentFactory — Factory Method

**File:** `src/documents/document-factory.js`

The single entry point for creating `Document` objects. Applies category-specific rules (default classification, `requiresOwnerApproval` flag) before construction.

```js
const DocumentFactory = require('./document-factory');

// Create a document
const doc = DocumentFactory.createDocument('design-specification', {
  title:               'Cooling System Rev 3',
  ownerID:             userID,
  filePath:            'cooling-rev3.pdf',
  classificationLevel: 'restricted'  // optional — falls back to category default
});
// doc.classificationLevel === 'restricted'
// doc.requiresOwnerApproval === true

// List all categories (for UI dropdowns)
DocumentFactory.getCategories();
// → [{ value, label, defaultClassification, requiresOwnerApproval }, ...]
```

**Category defaults:**

| Category | Default classification | Requires approval |
|---|---|---|
| `design-specification` | `confidential` | yes |
| `compliance-record` | `confidential` | yes |
| `report` | `internal` | no |
| `test-plan` | `internal` | no |
| `meeting-minutes` | `internal` | no |
| `other` | `internal` | no |

**Throws `Error`** if the category is not in `VALID_CATEGORIES` or if `title`/`ownerID` are missing.

---

### 5.8 DocumentRepository — Repository

**File:** `src/documents/document-repository.js`

Abstracts storage. `SecurityProxy` calls this after all security checks pass. The implementation is in-memory (`#store: Map<docID, { metadata: Document, content: string }>`); swap this class for a database-backed version without changing any callers.

```js
const repo = new DocumentRepository();

// Save (called by SecurityProxy after encryption)
const docID = repo.save(ownerID, fileObj, metadataObj);
// fileObj    = { name, mimeType, sizeBytes, content }  ← content already encrypted
// metadataObj = { title, category, classificationLevel }

// Retrieve
const { metadata, content } = repo.retrieve(docID);   // null if not found

// Search
const results = repo.search('cooling', 'design-specification');
// keyword matched against title (case-insensitive), category optional

// List all (for dashboard)
const all = repo.listAll();  // → toMetadata() objects, excluding archived

// Existence check
repo.exists(docID);  // → boolean
```

---

### 5.9 DocumentLock — Observer

**File:** `src/documents/document-lock.js`

Per-document lock with a 30-minute TTL and auto-expiry. Notifies registered observers on every state change.

> **Important:** In the current web layer (`server.js`), there is **one shared `DocumentLock` instance** for the entire system (not one per document). The lock/unlock routes pass the `docID` as an argument rather than creating separate `DocumentLock` instances. This is a simplification; a production system would maintain a `Map<docID, DocumentLock>`.

```js
const lock = new DocumentLock(docID);

// Observer registration
lock.addObserver((event) => {
  // event = { docID, type: 'locked'|'unlocked'|'expired', lockedByUserID }
  console.log(event);
});
lock.removeObserver(callback);

// Lock operations
const r = lock.lock(userID);     // { success, message }
const r = lock.unlock(userID);   // { success, message }
// Only the lock owner or 'SYSTEM' can unlock.

// State queries
lock.isLocked();   // → boolean (checks TTL; auto-releases expired locks)
lock.getLockInfo(); // → { lockedByUserID, lockedAt, expiresAt } | null
```

**Observer error isolation:** each observer callback is wrapped in `try/catch` — one failing observer does not affect others.

**Lock TTL:** 30 minutes (`LOCK_TTL_MS = 30 * 60 * 1000`). TTL is enforced lazily on `isLocked()` and `getLockInfo()` calls.

---

### 5.10 SecurityProxy — Proxy

**File:** `src/security/security-proxy.js`

Wraps `DocumentRepository`. All uploads and downloads **must** go through this class. It enforces the following pipeline before delegating to the repository:

```
upload(userID, file, metadata)
  │
  ├─ 1. Rate limit check         (10 uploads / 60 s per user)
  ├─ 2. MIME type validation      (allowlist — see below)
  ├─ 3. File size validation      (max 50 MB)
  ├─ 4. Metadata sanitisation     (strips HTML tags and < > " ' chars)
  ├─ 5. Content encryption        (simulated AES-256 — base64 + ':encrypted' marker)
  ├─ 6. Delegate to repository    (DocumentRepository.save)
  └─ 7. Audit log                 (UPLOAD_SUCCESS or UPLOAD_BLOCKED)
```

```js
const { SecurityProxy, ValidationError, RateLimitError } = require('./security-proxy');
const proxy = new SecurityProxy(documentRepository, auditLog);

// Upload
const docID = proxy.upload(userID, fileObj, metaObj);
// fileObj = { name, mimeType, sizeBytes, content }
// metaObj = { title, category, classificationLevel }
// Throws ValidationError or RateLimitError on failure

// Download
const { metadata, content } = proxy.download(userID, docID);
// content is decrypted before being returned
```

**Allowed MIME types:**
- `application/pdf`
- `application/msword`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/vnd.ms-excel`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `text/plain`

> **Note:** `multer` in `server.js` also accepts `.png`, `.jpg`, `.jpeg`, `.csv` at the HTTP layer, but the proxy will block these at the MIME check. If you want to allow images, add their MIME types to `ALLOWED_MIME_TYPES` in `security-proxy.js`.

---

### 5.11 AccessControlService

**File:** `src/security/access-control-service.js`

Implements the Strategy pattern for authorisation decisions. Delegates the actual permission check to `user.hasPermission(action)` — it never inspects the role string directly.

```js
const { AccessControlService, AccessDeniedError } = require('./access-control-service');
const acs = new AccessControlService(auditLog);

// Throwing version — use in controllers
acs.authorise(user, sessionToken, 'upload', docID);
// Throws AccessDeniedError if:
//   a) session token is invalid, OR
//   b) user.hasPermission('upload') returns false

// Non-throwing version — use for UI conditionals (no audit noise)
acs.canPerform(user, 'viewReports'); // → boolean
```

**Default-deny:** any action string not in a subclass's permission set is denied.

---

### 5.12 Report

**File:** `src/reports/report.js`

Queries `AuditLog.queryByDateRange()` and aggregates results into a report object. Accessible only to Manager and Supervisor roles (enforced upstream by `requireRole` middleware).

```js
const report = new Report(auditLog);

const result = report.generate(
  generatedByUserID,
  new Date('2025-01-01'),
  new Date('2025-01-31'),
  { actionType: 'UPLOAD_SUCCESS' }  // optional filter
);

// result shape:
{
  reportID:     string,
  generatedBy:  string,
  generatedAt:  string,
  period:       { from, to },
  filters:      object,
  totalEvents:  number,
  summary:      { [actionType]: count },
  entries:      AuditEntry[]
}
```

---

## 6. Web Layer (`web/`)

### 6.1 server.js — Route Map

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/` | — | — | Redirect to `/dashboard` or `/login` |
| `GET` | `/register` | — | — | Registration form |
| `POST` | `/register` | — | — | Create account; redirect to `/login` |
| `GET` | `/login` | — | — | Login form (step 1) |
| `POST` | `/login` | — | — | Validate password → dispatch OTP → `/verify-otp` |
| `GET` | `/verify-otp` | pending | — | OTP entry form |
| `POST` | `/verify-otp` | pending | — | Verify OTP → create session → `/dashboard` |
| `GET` | `/logout` | ✓ | any | Destroy session → `/login` |
| `GET` | `/dashboard` | ✓ + maint | any | Document list + notifications |
| `GET` | `/search` | ✓ + maint | any | Keyword + category search |
| `GET` | `/upload` | ✓ + maint | eng, mgr | Upload form |
| `POST` | `/upload` | ✓ + maint | eng, mgr | Handle multipart upload via SecurityProxy |
| `POST` | `/reserve/:docID` | ✓ | eng, mgr | Lock document |
| `POST` | `/release/:docID` | ✓ | eng, mgr | Release lock |
| `GET` | `/reports` | ✓ | mgr, sup | Activity report with date-range filter |
| `GET` | `/audit` | ✓ | mgr, sup | Full audit log (newest first) |
| `GET` | `/maintenance` | ✓ | mgr, sup | Maintenance mode status page |
| `POST` | `/maintenance/enable` | ✓ | mgr, sup | Enable maintenance mode |
| `POST` | `/maintenance/disable` | ✓ | mgr, sup | Disable maintenance mode |

**Auth column:** `✓` = `requireAuth`; `pending` = checked via `req.session.pendingUserID`; `+ maint` = also passes through `checkMaintenance`.

---

### 6.2 Middleware Chain

```
Every request:
  express.urlencoded()
  express.json()
  express.static()
  express-session
  connect-flash
  res.locals injector   → flash, session, maintenanceMode available in all views

Protected routes additionally apply (in order):
  requireAuth           → checks session.userID && session.token
  requireRole(...roles) → checks session.role is in allowed set
  checkMaintenance      → if maintenanceMode && role === 'engineer' → redirect /login
```

---

### 6.3 In-Memory Registries

Declared at the top of `server.js` and live for the process lifetime:

```js
const userRegistry  = new Map(); // userID → User instance
const emailRegistry = new Map(); // email  → userID
let   maintenanceMode = false;
const notifications   = [];      // max 50 entries, oldest dropped
```

**Why not DataStore?** `DataStore` stores plain objects; reconstructing a `User` from a plain object would require the plaintext password (to re-hash). Keeping the live `User` instance avoids this problem entirely.

---

### 6.4 EJS Views

All views include `partials/head` (opens `<html>`, `<head>`, and `<body>`) and `partials/foot` (closes them). Auth pages pass `{ authPage: true }` to `head.ejs`, which adds `class="auth-page"` to `<body>`, triggering the centred card layout.

**Sidebar** (`partials/sidebar.ejs`) renders conditionally based on `session.role`:
- Upload link hidden for `supervisor`
- Reports, Audit, Maintenance links hidden for `engineer`
- Avatar shows first letter of `session.email`

**Flash messages** (`partials/flash.ejs`) render four channels: `error` (red), `success` (green), `info` (blue), `warn` (amber). These are populated via `req.flash()` and consumed once per page render.

---

## 7. Authentication Flow (Step-by-Step)

```
1.  Browser  POST /login  { email, password }
2.  server.js: emailRegistry.get(email) → userID
3.  server.js: userRegistry.get(userID) → User instance
4.  SessionManager.initiateLogin(user, password)
      └── user.verifyPassword(password)         → SHA-256 compare
      └── if fail: recordFailure; after 5 → lockout 15 min
      └── if pass: mfaProvider.generateCode(userID, email)
                   → OTP printed to console
5.  session.pendingUserID = userID; redirect /verify-otp
6.  Browser  POST /verify-otp  { otp }
7.  SessionManager.completeLogin(user, otp)
      └── mfaProvider.verifyCode(userID, otp)   → TTL + code check; single-use
      └── user.createSession()                   → random 64-hex token
      └── auditLog.record(LOGIN_SUCCESS)
8.  session.userID = userID
    session.token  = sessionToken
    session.role   = user.role
    delete session.pendingUserID
9.  redirect /dashboard
```

---

## 8. Document Upload Flow (Step-by-Step)

```
1.  Browser  POST /upload  multipart { title, category, classificationLevel, file }
2.  multer.single('file')  → req.file = { originalname, mimetype, size, buffer }
3.  DocumentFactory.createDocument(category, { title, ownerID, filePath, classificationLevel })
      └── validates category, applies default classification
      └── returns new Document instance (docID assigned here)
4.  Build fileObj  = { name, mimeType, sizeBytes, content: buffer.toString('base64') }
    Build metaObj  = { title, category, classificationLevel: doc.classificationLevel }
5.  SecurityProxy.upload(userID, fileObj, metaObj)
      ├── checkRateLimit()           → 10 uploads/min per user
      ├── MIME allowlist check       → throw ValidationError if not allowed
      ├── size check                 → throw ValidationError if > 50 MB
      ├── sanitiseMetadata()         → strip HTML/script chars from strings
      ├── encryptContent()           → base64 + ':encrypted' marker (simulated)
      └── DocumentRepository.save() → stores { metadata: Document, content: encrypted }
6.  auditLog.record(userID, 'UPLOAD_SUCCESS', file.name, docID)
7.  req.flash('success'); redirect /dashboard
```

---

## 9. Design Patterns — Code Markers

| Pattern | File | Marker |
|---|---|---|
| **Singleton** | `src/data/data-store.js` | `DataStore.getInstance()` |
| **Proxy** | `src/security/security-proxy.js` | `SecurityProxy.upload(userID, fileObj, metaObj)` |
| **Factory Method** | `src/documents/document-factory.js` | `DocumentFactory.createDocument(category, data)` |
| **Strategy** | `src/security/access-control-service.js` | `user.hasPermission(action)` inside `authorise()` |
| **Observer** | `src/documents/document-lock.js` | `lock.addObserver(callback)` / `#notify(type, userID)` |
| **Repository** | `src/documents/document-repository.js` | `DocumentRepository.save / retrieve / search / listAll` |

See `docs/DESIGN_PATTERNS_NOTES.md` for decision rationale, alternatives considered, and requirement mapping.

---

## 10. Error Handling

| Error class | Thrown by | Caught where |
|---|---|---|
| `ValidationError` | `SecurityProxy` | `server.js` upload route `try/catch` → flash error |
| `RateLimitError` | `SecurityProxy` | `server.js` upload route `try/catch` → flash error |
| `AccessDeniedError` | `AccessControlService` | Not currently used in `server.js` (route-level `requireRole` is used instead) |
| `Error` (generic) | `DocumentFactory`, `Document`, `DocumentLock` | `server.js` `try/catch` → flash error |

All error messages from `catch (err)` blocks are surfaced to the user as `req.flash('error', err.message)`. Stack traces are not exposed to the browser.

---

## 11. Testing

```bash
npm test              # all tests + coverage report
npm run test:unit     # unit tests only
npm run test:integration  # integration tests only
```

Coverage is collected from `src/**/*.js` (the business logic layer). `web/server.js` is excluded from coverage because it is an integration boundary.

### Test files

| File | What it covers |
|---|---|
| `tests/unit/user.test.js` | Password hashing, session token lifecycle, `hasPermission` per subclass |
| `tests/unit/audit-log.test.js` | Record, query by user/doc/date, purge |
| `tests/unit/document-lock.test.js` | Lock/unlock, TTL expiry, Observer notification, concurrent lock rejection |
| `tests/unit/security-proxy.test.js` | MIME rejection, size rejection, rate limiting, metadata sanitisation |
| `tests/integration/auth-flow.test.js` | Full login sequence: password fail → lockout, OTP flow end-to-end |
| `tests/integration/document-upload-flow.test.js` | Upload → retrieve → Observer notification chain |

### Writing new tests

All tests are pure Jest with no test database. Because the business logic layer has no Express dependency, you can instantiate classes directly:

```js
const AuditLog      = require('../../src/audit/audit-log');
const MFAProvider   = require('../../src/auth/mfa-provider');
const SessionManager = require('../../src/auth/session-manager');
const Engineer       = require('../../src/auth/engineer');

describe('login lockout', () => {
  let auditLog, mfa, sessionMgr, user;
  beforeEach(() => {
    auditLog   = new AuditLog();
    mfa        = new MFAProvider();
    sessionMgr = new SessionManager(mfa, auditLog);
    user       = new Engineer('u1', 'a@b.com', 'Pass1234');
  });
  // ...
});
```

---

## 12. Configuration & Environment

No `.env` file is required. The following values are hardcoded and should be externalised before production deployment:

| Constant | File | Current value | Notes |
|---|---|---|---|
| Session secret | `web/server.js:89` | `'sdms-demo-secret-5cm505'` | Must be a strong random string |
| Session TTL | `web/server.js:92` | `2 * 60 * 60 * 1000` (2 h) | |
| OTP TTL | `src/auth/mfa-provider.js:9` | `5 * 60 * 1000` (5 min) | |
| OTP length | `src/auth/mfa-provider.js:10` | `6` digits | |
| Lockout threshold | `src/auth/session-manager.js:12` | `5` attempts | |
| Lockout duration | `src/auth/session-manager.js:13` | `15 * 60 * 1000` (15 min) | |
| Upload rate limit | `src/security/security-proxy.js:23–24` | 10 / 60 s | |
| Max upload size | `src/security/security-proxy.js:20` | 50 MB | Also set in `multer` config |
| Lock TTL | `src/documents/document-lock.js:9` | 30 min | |
| Audit retention | `src/audit/audit-log.js:11` | 90 days | |
| HTTP port | `web/server.js:368` | `process.env.PORT \|\| 3000` | Only value already env-aware |

---

## 13. Known Limitations & Production Gaps

**Persistence:** all state lives in process memory. A server restart loses every user account, document, and audit entry. Replace `DocumentRepository` and `AuditLog` with database-backed implementations.

**Password hashing:** SHA-256 is used for speed in this demo. Production must use `bcrypt` or `argon2` with a cost factor tuned to ~200–300 ms per hash.

**OTP delivery:** OTPs are only printed to the server console. Wire `mfa-provider.js:generateCode()` to a real email API before any real use.

**Encryption:** `SecurityProxy` simulates encryption with base64 encoding plus an `:encrypted` marker. Replace `#encryptContent` / `#decryptContent` with AES-256-GCM using a key stored in a secrets manager (AWS KMS, HashiCorp Vault, etc.).

**Session store:** `express-session` defaults to an in-memory store that does not support clustering and leaks memory over time. Use `connect-redis` or `connect-pg-simple` in production.

**HTTPS:** the server binds to plain HTTP. All production deployments must terminate TLS at the load balancer or use `https.createServer()`.

**CSRF protection:** forms are not protected against Cross-Site Request Forgery. Add `csurf` (or the `csrf` package for Express 5) to all state-mutating POST routes.

**One shared DocumentLock:** `server.js` creates a single `DocumentLock` instance and uses it for all documents by passing `docID` to `lock()` / `unlock()`. The `DocumentLock` class is designed to be per-document; `server.js` should maintain a `Map<docID, DocumentLock>` for correctness at scale.

**Notification feed:** the `notifications[]` array in `server.js` is populated by the Observer on the single shared `DocumentLock`. In a multi-document setup this feed would need to be moved to a proper pub/sub or WebSocket layer.
