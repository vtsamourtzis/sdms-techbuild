# Design Pattern Decision Log — SDMS

_Student 100777959 · 5CM505 Software Engineering · Phase 3_

This document records **why** each pattern was chosen, which alternative was rejected and why, and exactly where in the code to find it. Use it alongside the source files during the demo.

---

## Pattern 1 — Singleton (`src/data/data-store.js`)

### Decision
A single shared `DataStore` instance holds all in-memory collections (users, documents, auditLogs, notifications, settings). Every module that needs persistence calls `DataStore.getInstance()`.

### Why not just export a plain object?
A plain exported object cannot enforce single-instance discipline — another module could call `new DataStore()` and get a separate, empty Map. The Singleton constructor actively **throws** if called directly:

```js
constructor() {
  if (DataStore.#instance) {
    throw new Error('Use DataStore.getInstance()');
  }
}
```

This makes the contract impossible to violate accidentally, which matters because `AuditLog`, `SecurityProxy`, `SessionManager`, and `DocumentRepository` all write to overlapping collections and must see each other's data.

### Code markers
| Symbol | File | Purpose |
|--------|------|---------|
| `DataStore.#instance` | `data-store.js:25` | Private static — only one ever exists |
| `DataStore.getInstance()` | `data-store.js:55` | The only legal entry point |
| `module.exports = DataStore.getInstance()` | `data-store.js:192` | Callers just `require()` and use |

### Requirement link
RE-17 (maintenance window toggle) is stored via `dataStore.getSetting('maintenance_mode')`. Without a Singleton this setting would not be visible across the request cycle.

---

## Pattern 2 — Proxy (`src/security/security-proxy.js`)

### Decision
`SecurityProxy` wraps `DocumentRepository` and intercepts **every** upload and download. No caller can reach the repository directly.

### Why Proxy and not Facade?
A Facade *simplifies* a complex subsystem — it lets you call one method instead of five. A Proxy *controls access* to a single subject and can add behaviour transparently. Here the subject (`DocumentRepository`) is already simple; what we need is to guarantee that security checks **cannot be bypassed**. A Facade would still allow a careless controller to call the repository directly. The Proxy makes that structurally impossible:

```js
// The only public path to storage — all security runs here first
upload(userID, file, metadata) {
  this.#checkRateLimit(userID);     // RE-13
  this.#validateMimeType(file);     // RE-12
  this.#validateFileSize(file);     // RE-12
  this.#sanitiseMetadata(metadata); // RE-12
  const enc = this.#encryptContent(file.content); // RE-9
  return this.documentRepository.save(userID, { ...file, content: enc }, metadata);
}
```

### Code markers
| Symbol | File | Purpose |
|--------|------|---------|
| `SecurityProxy.upload()` | `security-proxy.js:66` | Intercepts all writes |
| `SecurityProxy.download()` | `security-proxy.js:101` | Decrypts on read |
| `#encryptContent / #decryptContent` | `security-proxy.js:130+` | AES-256 simulation |
| `#checkRateLimit` | `security-proxy.js:160` | 10 uploads/min per user |

### Requirement links
RE-9 (encryption at rest), RE-11 (security proxy), RE-12 (input validation), RE-13 (rate limiting).

---

## Pattern 3 — Factory Method (`src/documents/document-factory.js`)

### Decision
`DocumentFactory.createDocument(category, data)` is the **only** way to instantiate a `Document`. Controllers and services never call `new Document(...)`.

### What the factory enforces that a constructor cannot
The factory cross-references `VALID_CATEGORIES` and `CATEGORY_RULES` before construction. A bare constructor cannot do this cleanly because it would have to duplicate the category table or accept a half-built object:

```js
static createDocument(category, data) {
  if (!VALID_CATEGORIES.has(category))
    throw new Error(`Unknown category: "${category}"`);
  const rules = CATEGORY_RULES[category];
  const classLevel = data.classificationLevel || rules.defaultClassification;
  const doc = new Document(data.title, category, data.ownerID, data.filePath, classLevel);
  doc.requiresOwnerApproval = rules.requiresOwnerApproval;
  return doc;
}
```

Adding a new category (e.g., `risk-assessment`) means adding one entry to `CATEGORY_RULES` — zero changes to any controller.

### Code markers
| Symbol | File | Purpose |
|--------|------|---------|
| `CATEGORY_RULES` | `document-factory.js:25` | Per-category defaults |
| `DocumentFactory.createDocument()` | `document-factory.js:43` | The factory method |
| `DocumentFactory.getCategories()` | `document-factory.js:79` | Used by the upload form |

### Requirement link
RE-8 (document categorisation with distinct access levels per category).

---

## Pattern 4 — Strategy (`src/auth/engineer.js`, `manager.js`, `supervisor.js`)

### Decision
`User.hasPermission(action)` returns `false` by default (deny-all base). Each role subclass overrides it with its own fixed set:

```js
// engineer.js
hasPermission(action) { return ENGINEER_PERMISSIONS.has(action); }

// manager.js
hasPermission(action) { return MANAGER_PERMISSIONS.has(action); }

// supervisor.js
hasPermission(action) { return SUPERVISOR_PERMISSIONS.has(action); }
```

`AccessControlService` calls `user.hasPermission(action)` **without importing any concrete subclass** — it never switches on `user.role`.

### Why not a role-string lookup table?
A lookup table (`PERMISSIONS['engineer'].includes(action)`) is data, not behaviour. It cannot be overridden per-instance, cannot carry state, and cannot be tested in isolation. The Strategy pattern makes each role's policy a self-contained, independently testable object. Adding a `contractor` role means adding one new file — no changes to `AccessControlService`.

### Code markers
| Symbol | File | Purpose |
|--------|------|---------|
| `ENGINEER_PERMISSIONS` | `engineer.js:14` | Concrete strategy A |
| `MANAGER_PERMISSIONS` | `manager.js:15` | Concrete strategy B |
| `SUPERVISOR_PERMISSIONS` | `supervisor.js:14` | Concrete strategy C |
| `user.hasPermission(action)` | `access-control-service.js:45` | Polymorphic dispatch |

### Requirement link
RE-6 (Engineer/Manager/Supervisor roles with distinct, non-overlapping permissions).

---

## Pattern 5 — Observer (`src/documents/document-lock.js`)

### Decision
`DocumentLock` maintains a `Set` of observer callbacks. When a lock is acquired or released, `#notify()` fires each callback with a structured event object.

### How it avoids tight coupling
The lock module does not import `NotificationService` or any other consumer. It knows nothing about what happens after it fires — emails, database writes, in-memory notifications. New subscribers attach at runtime:

```js
// In server.js — zero changes to document-lock.js
docLock.addObserver(({ docID, type, lockedByUserID }) => {
  notifications.push({ message: `Doc ${docID} ${type} by ${lockedByUserID}` });
});
```

Each callback runs inside a `try/catch` so one failing observer cannot block the others — a deliberate resilience choice absent from a simple event emitter.

### Code markers
| Symbol | File | Purpose |
|--------|------|---------|
| `#observers = new Set()` | `document-lock.js:17` | Subscriber registry |
| `addObserver / removeObserver` | `document-lock.js:40+` | Runtime subscription |
| `#notify(type, userID)` | `document-lock.js:52` | Fan-out with per-observer try/catch |
| `lock() / unlock()` | `document-lock.js:65+` | Trigger points |

### Requirement link
RE-10 (other users must be notified when a document is reserved for editing).

---

## Pattern 6 — Repository (`src/documents/document-repository.js`)

### Decision
`DocumentRepository` owns all read/write operations on the document store. The `SecurityProxy` calls `documentRepository.save()` and `documentRepository.retrieve()` — it does not touch the underlying `Map` directly.

### Why it matters
Swapping from in-memory storage to a database (PostgreSQL, MongoDB) means changing **one file** (`document-repository.js`) with zero changes to `SecurityProxy`, `DocumentFactory`, or any controller. This satisfies the Dependency Inversion Principle: high-level modules depend on the repository interface, not on storage mechanics.

### Code markers
| Symbol | File | Purpose |
|--------|------|---------|
| `DocumentRepository.save()` | `document-repository.js:28` | Write path |
| `DocumentRepository.retrieve()` | `document-repository.js:48` | Read path |
| `DocumentRepository.search()` | `document-repository.js:62` | Keyword + category filter |
| `DocumentRepository.listAll()` | `document-repository.js:80` | Dashboard feed |

---

## How the Patterns Interact

```
HTTP request
    │
    ▼
SecurityProxy (Proxy)          ← enforces all RE-9/11/12/13 checks
    │
    ├─► DocumentFactory (Factory Method)   ← validates category, sets defaults
    │
    ├─► DocumentRepository (Repository)    ← isolated storage abstraction
    │
    └─► AuditLog ──────────────────────────────────────► DataStore (Singleton)
                                                               ▲
AccessControlService (Strategy dispatch)                       │
    └─► user.hasPermission()                      all modules write here
                                                               │
DocumentLock (Observer) ──────────────────────────────────────┘
    └─► #notify() → web notification feed
```

---

## Requirement Coverage Summary

| Requirement | Pattern / File |
|-------------|----------------|
| RE-1: User accounts | `src/auth/user.js` — `User` constructor + `verifyPassword()` |
| RE-2: Encrypted IDs / emails | `src/auth/user.js` — `#passwordHash` private field |
| RE-3: Email OTP MFA | `src/auth/mfa-provider.js` — `generateCode()` + `verifyCode()` |
| RE-4: Single active session | `src/auth/user.js` — `createSession()` replaces previous token |
| RE-5: GDPR data minimisation | `User.toPublicProfile()` — never exposes hash or token |
| RE-6: Role-based access | Strategy — `engineer.js`, `manager.js`, `supervisor.js` |
| RE-7: Upload / download / search | Proxy — `security-proxy.js`; Repository — `document-repository.js` |
| RE-8: Document categorisation | Factory Method — `document-factory.js` |
| RE-9: Encryption at rest | Proxy — `#encryptContent()` / `#decryptContent()` |
| RE-10: Reservation + notifications | Observer — `document-lock.js` |
| RE-11: Security proxy | Proxy — `security-proxy.js` intercepts all requests |
| RE-12: Input validation + sanitisation | Proxy — MIME type, size limit, metadata strip |
| RE-13: Rate limiting | Proxy — `#checkRateLimit()` per user per minute |
| RE-14: Audit logging | `src/audit/audit-log.js` — `record()` called by every component |
| RE-15: Timestamped logs, 3-month retention | `audit-log.js` — `purgeExpiredEntries()` |
| RE-16: Supervisor activity reports | `src/reports/report.js` — `generate()` from AuditLog |
| RE-17: Maintenance window | Singleton — `dataStore.getSetting('maintenance_mode')` |
| RE-18: Mobile interface | Won't — SRS marks this out-of-scope; REST structure supports it |
