# SDMS Coding Conventions

## Language & Runtime
- JavaScript (ES2020+), Node.js 18+
- No framework dependencies for core logic — plain OOP classes

## Naming
- **Classes**: PascalCase — `DocumentLock`, `AuditLog`
- **Methods / functions**: camelCase — `verifyOTP()`, `reserveDocument()`
- **Constants**: UPPER_SNAKE_CASE — `MAX_LOGIN_ATTEMPTS`, `SESSION_TTL_MS`
- **Files**: kebab-case matching the class name — `audit-log.js`, `security-proxy.js`

## File Structure
```
src/
  auth/           → User, MFAProvider, SessionManager
  documents/      → Document, DocumentLock
  security/       → SecurityProxy, AccessControlService
  audit/          → AuditLog
  reports/        → Report
tests/
  unit/           → one file per class
  integration/    → end-to-end flow tests
docs/             → SDS, SIS, SES documents
```

## Class Design
- One class per file
- Constructor receives only what it needs (dependency injection)
- Private state via `#privateField` syntax (ES2022)
- No global state — all state lives in class instances

## Documentation
- Every class has a JSDoc block explaining its responsibility
- Every public method has `@param` and `@returns` JSDoc tags
- Inline comments explain *why*, not *what*

## OOP Principles Applied
- **Encapsulation**: private fields (`#`) for internal state
- **Inheritance**: `Engineer` and `Manager` extend `User`
- **Polymorphism**: `hasPermission()` overridden per role subclass
- **Abstraction**: `AccessControlService` hides policy details from callers

## Design Patterns Used
| Pattern | Where applied |
|---------|--------------|
| Proxy | `SecurityProxy` wraps all file operations |
| Observer | `DocumentLock` notifies watchers on state change |
| Strategy | `AccessControlService` swaps permission policies |
| Repository | `DocumentRepository` abstracts storage operations |

## Error Handling
- Throw typed errors (`AuthError`, `AccessDeniedError`, `ValidationError`)
- Never swallow errors silently — always log to `AuditLog`

## Testing
- Jest for unit and integration tests
- Each unit test file mirrors its source file: `audit-log.test.js` → `audit-log.js`
- Arrange / Act / Assert structure for every test case
