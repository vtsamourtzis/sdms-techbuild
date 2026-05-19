# Demo Walkthrough — SDMS

Step-by-step guide covering every requirement and design pattern.

## Start the server

```bash
npm install
npm start
```

Open **http://localhost:3000** — keep the terminal visible for OTP codes.

---

## 1. Register three accounts

Go to `/register` and create:

| Email | Role | Password |
|-------|------|----------|
| `engineer@tb.com` | Engineer | `Password1!` |
| `manager@tb.com` | Manager | `Password1!` |
| `supervisor@tb.com` | Supervisor | `Password1!` |

---

## 2. Sign in as Engineer (MFA flow)

1. `/login` → enter `engineer@tb.com` / `Password1!`
2. Check the terminal for the 6-digit OTP → enter it
3. You land on the Dashboard

_Patterns: Singleton (DataStore), Strategy (Engineer.hasPermission), Observer setup_

---

## 3. Upload a document

1. Sidebar → **Upload**
2. Title: `Cooling System Design Rev 1`, Category: `Design Specification`
3. Attach any file → **Upload**

_Patterns: Factory Method (category validation + confidential default), Proxy (MIME check, size limit, encryption, rate limit), Repository (save)_

---

## 4. Reserve the document

Click **Reserve** on the dashboard row.
Status changes to **Reserved** and a notification appears in the sidebar.

_Pattern: Observer (DocumentLock notifies the feed)_

---

## 5. Search documents

Sidebar → **Search Documents** → type a keyword or filter by category.

_Requirement: RE-7_

---

## 6. Sign in as Manager → enable Maintenance Mode

1. Sign out → log in as `manager@tb.com`
2. Sidebar → **Maintenance** → **Enable Maintenance Mode**
3. Sign out → try to log in as `engineer@tb.com` → access blocked

_Requirement: RE-17 · Pattern: Singleton (flag read across request cycle)_

---

## 7. View Reports and Audit Log

As Manager (after disabling maintenance):

- Sidebar → **Activity Reports** — adjust date range, see event summary tiles
- Sidebar → **Audit Log** — every timestamped event, colour-coded by outcome

_Requirements: RE-14, RE-15, RE-16_

---

## 8. Sign in as Supervisor (read-only)

Log in as `supervisor@tb.com`.
Upload and Reserve buttons are absent — only Reports and Audit Log are accessible.

_Pattern: Strategy (Supervisor.hasPermission returns false for upload/reserve)_
