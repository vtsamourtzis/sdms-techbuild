/**
 * @file server.js
 * @description Express web server for the Secure Document Management System.
 *
 * Because all SDMS persistence is in-memory, live User objects are kept in a
 * userRegistry Map on the server (userID -> User instance). This avoids any
 * re-hydration problem with private password hashes — the same object used at
 * registration is used for every subsequent login check.
 *
 * Routes
 *   GET/POST /login            Credential check -> OTP dispatch
 *   GET/POST /verify-otp       Complete MFA -> session token
 *   GET      /logout           Destroy session
 *   GET/POST /register         Create user account
 *   GET      /dashboard        Document list + lock status
 *   GET      /search           Keyword + category search
 *   GET/POST /upload           Upload via SecurityProxy
 *   POST     /reserve/:id      Lock document
 *   POST     /release/:id      Release lock 
 *   GET      /reports          Activity report (Manager/Supervisor)
 *   GET      /audit            Full audit log  (Manager/Supervisor)
 *   GET      /maintenance      Toggle view     (Manager/Supervisor)
 *   POST     /maintenance/enable|disable
 */

'use strict';

const path    = require('path');
const crypto  = require('crypto');
const express = require('express');
const session = require('express-session');
const flash   = require('connect-flash');
const multer  = require('multer');

// ── SDMS backend ─────────────────────────────────────────────────────────────
const SessionManager     = require('../src/auth/session-manager');
const MFAProvider        = require('../src/auth/mfa-provider');
const AuditLog           = require('../src/audit/audit-log');
const DocumentRepository = require('../src/documents/document-repository');
const DocumentFactory    = require('../src/documents/document-factory');
const DocumentLock       = require('../src/documents/document-lock');
const { SecurityProxy }  = require('../src/security/security-proxy');
const Report             = require('../src/reports/report');
const Engineer           = require('../src/auth/engineer');
const Manager            = require('../src/auth/manager');
const Supervisor         = require('../src/auth/supervisor');

// ── Compose backend ───────────────────────────────────────────────────────────
const auditLog    = new AuditLog();
const mfaProvider = new MFAProvider();
const sessionMgr  = new SessionManager(mfaProvider, auditLog);
const docRepo     = new DocumentRepository();
const docLock     = new DocumentLock();
const proxy       = new SecurityProxy(docRepo, auditLog);
const report      = new Report(auditLog);

// In-memory maintenance flag — persists for the lifetime of the process
let maintenanceMode = false;

// In-memory user registry — avoids re-hydrating private #passwordHash fields.
const userRegistry  = new Map(); // userID -> User instance
const emailRegistry = new Map(); // email  -> userID

// Notification feed — populated by the Observer on DocumentLock
const notifications = [];
docLock.addObserver(({ docID, type, lockedByUserID }) => {
  const verb = type === 'locked' ? 'reserved' : 'released';
  notifications.push({
    message: `Document ${docID.slice(0, 8)}… ${verb} by ${lockedByUserID.slice(0, 8)}…`,
    at: new Date().toISOString(),
  });
  if (notifications.length > 50) notifications.shift();
});

// ── Multer (memory, 50 MB cap) ────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },
});

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'sdms-demo-secret-5cm505',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 2 * 60 * 60 * 1000 },
}));
app.use(flash());

// Inject flash + session + maintenanceMode into every view
app.use((req, res, next) => {
  res.locals.flash           = { error: req.flash('error'), success: req.flash('success'), info: req.flash('info'), warn: req.flash('warn') };
  res.locals.session         = req.session;
  res.locals.maintenanceMode = maintenanceMode;
  next();
});

// ── Middleware ────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (req.session.userID && req.session.token) return next();
  req.flash('error', 'Please sign in to continue.');
  res.redirect('/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.session.role)) return next();
    req.flash('error', 'You do not have permission to access that page.');
    res.redirect('/dashboard');
  };
}

// Block engineers when maintenance mode is active
function checkMaintenance(req, res, next) {
  if (maintenanceMode && req.session.role === 'engineer') {
    req.flash('error', 'The system is currently under maintenance. Please try again later.');
    return res.redirect('/login');
  }
  next();
}

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect(req.session.userID ? '/dashboard' : '/login'));

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

app.get('/register', (req, res) => {
  if (req.session.userID) return res.redirect('/dashboard');
  res.render('register', { title: 'Register' });
});

app.post('/register', (req, res) => {
  const { email, password, confirmPassword, role } = req.body;
  if (!email || !password || !role) { req.flash('error', 'All fields are required.'); return res.redirect('/register'); }
  if (password !== confirmPassword)  { req.flash('error', 'Passwords do not match.'); return res.redirect('/register'); }
  if (!['engineer', 'manager', 'supervisor'].includes(role)) { req.flash('error', 'Invalid role.'); return res.redirect('/register'); }
  if (emailRegistry.has(email)) { req.flash('error', 'An account with that email already exists.'); return res.redirect('/register'); }
  if (password.length < 8) { req.flash('error', 'Password must be at least 8 characters.'); return res.redirect('/register'); }

  try {
    const userID = crypto.randomUUID();
    let user;
    if      (role === 'engineer')   user = new Engineer(userID, email, password);
    else if (role === 'manager')    user = new Manager(userID, email, password);
    else                            user = new Supervisor(userID, email, password);

    userRegistry.set(userID, user);
    emailRegistry.set(email, userID);
    auditLog.record(userID, 'REGISTER', `New ${role} account: ${email}`);
    req.flash('success', 'Account created. Please sign in.');
    res.redirect('/login');
  } catch (err) {
    req.flash('error', err.message);
    res.redirect('/register');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN — step 1
// ─────────────────────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.session.userID) return res.redirect('/dashboard');
  res.render('login', { title: 'Sign In' });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) { req.flash('error', 'Email and password are required.'); return res.redirect('/login'); }

  const userID = emailRegistry.get(email);
  if (!userID) { req.flash('error', 'Invalid email or password.'); return res.redirect('/login'); }

  const user   = userRegistry.get(userID);
  const result = sessionMgr.initiateLogin(user, password);
  if (!result.success) { req.flash('error', result.message); return res.redirect('/login'); }

  req.session.pendingUserID = userID;
  req.session.pendingEmail  = email;
  req.flash('info', `OTP sent to ${email}. Check the server terminal.`);
  res.redirect('/verify-otp');
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN — step 2 (OTP)
// ─────────────────────────────────────────────────────────────────────────────

app.get('/verify-otp', (req, res) => {
  if (!req.session.pendingUserID) return res.redirect('/login');
  res.render('verify-otp', { title: 'Verify OTP', email: req.session.pendingEmail });
});

app.post('/verify-otp', (req, res) => {
  const { otp }  = req.body;
  const userID   = req.session.pendingUserID;
  if (!userID || !otp) { req.flash('error', 'Session expired. Please sign in again.'); return res.redirect('/login'); }

  const user   = userRegistry.get(userID);
  const result = sessionMgr.completeLogin(user, otp);
  if (!result.success) { req.flash('error', result.message); return res.redirect('/verify-otp'); }

  req.session.userID = userID;
  req.session.token  = result.sessionToken;
  req.session.role   = user.role;
  req.session.email  = user.email;
  delete req.session.pendingUserID;
  delete req.session.pendingEmail;
  req.flash('success', 'Signed in successfully.');
  res.redirect('/dashboard');
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────────────────────────

app.get('/logout', (req, res) => {
  const user = userRegistry.get(req.session.userID);
  if (user) sessionMgr.logout(user);
  req.session.destroy(() => res.redirect('/login'));
});

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

app.get('/dashboard', requireAuth, checkMaintenance, (req, res) => {
  res.render('dashboard', {
    title:         'Dashboard',
    documents:     docRepo.listAll(),
    docLock,
    notifications: notifications.slice().reverse().slice(0, 10),
    role:          req.session.role,
    userID:        req.session.userID,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────────────────────────────────────

app.get('/search', requireAuth, checkMaintenance, (req, res) => {
  const q        = (req.query.q || '').trim();
  const category = req.query.category || '';
  const results  = q ? docRepo.search(q, category || null) : [];
  res.render('search', {
    title:            'Search',
    q,
    selectedCategory: category,
    categories:       DocumentFactory.getCategories(),
    results,
    docLock,
    role:             req.session.role,
    userID:           req.session.userID,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD
// ─────────────────────────────────────────────────────────────────────────────

app.get('/upload', requireAuth, requireRole('engineer', 'manager'), checkMaintenance, (req, res) => {
  res.render('upload', { title: 'Upload', categories: DocumentFactory.getCategories() });
});

app.post('/upload', requireAuth, requireRole('engineer', 'manager'), checkMaintenance, upload.single('file'), (req, res) => {
  const { category, title, classificationLevel } = req.body;
  const file = req.file;
  if (!file || !category || !title) { req.flash('error', 'File, category, and title are all required.'); return res.redirect('/upload'); }

  try {
    const doc = DocumentFactory.createDocument(category, {
      title,
      ownerID:             req.session.userID,
      filePath:            file.originalname,
      classificationLevel: classificationLevel || undefined,
    });
    const fileObj = { name: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, content: file.buffer.toString('base64') };
    const metaObj = { title, category, classificationLevel: doc.classificationLevel };
    proxy.upload(req.session.userID, fileObj, metaObj);
    req.flash('success', `"${title}" uploaded and encrypted.`);
    res.redirect('/dashboard');
  } catch (err) {
    req.flash('error', `Upload failed: ${err.message}`);
    res.redirect('/upload');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RESERVE / RELEASE
// ─────────────────────────────────────────────────────────────────────────────

app.post('/reserve/:docID', requireAuth, requireRole('engineer', 'manager'), (req, res) => {
  try {
    docLock.lock(req.params.docID, req.session.userID);
    auditLog.record(req.session.userID, 'LOCK', 'Document reserved', req.params.docID);
    req.flash('success', 'Document reserved for editing.');
  } catch (err) { req.flash('error', err.message); }
  res.redirect('back');
});

app.post('/release/:docID', requireAuth, requireRole('engineer', 'manager'), (req, res) => {
  try {
    docLock.unlock(req.params.docID, req.session.userID);
    auditLog.record(req.session.userID, 'UNLOCK', 'Lock released', req.params.docID);
    req.flash('success', 'Lock released.');
  } catch (err) { req.flash('error', err.message); }
  res.redirect('back');
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS
// ─────────────────────────────────────────────────────────────────────────────

app.get('/reports', requireAuth, requireRole('manager', 'supervisor'), (req, res) => {
  const fromDate = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
  const toDate   = req.query.to   ? new Date(req.query.to)   : new Date();
  res.render('reports', {
    title:  'Reports',
    report: report.generate(req.session.userID, fromDate, toDate),
    from:   fromDate.toISOString().split('T')[0],
    to:     toDate.toISOString().split('T')[0],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────────

app.get('/audit', requireAuth, requireRole('manager', 'supervisor'), (req, res) => {
  res.render('audit', { title: 'Audit Log', entries: auditLog.getAllEntries().slice().reverse() });
});

// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE
// ─────────────────────────────────────────────────────────────────────────────

app.get('/maintenance', requireAuth, requireRole('manager', 'supervisor'), (req, res) => {
  res.render('maintenance', { title: 'Maintenance', maintenanceMode });
});

app.post('/maintenance/enable', requireAuth, requireRole('manager', 'supervisor'), (req, res) => {
  maintenanceMode = true;
  auditLog.record(req.session.userID, 'MAINTENANCE_ON', 'Maintenance mode enabled');
  req.flash('warn', 'Maintenance mode enabled. Engineers cannot log in.');
  res.redirect('/maintenance');
});

app.post('/maintenance/disable', requireAuth, requireRole('manager', 'supervisor'), (req, res) => {
  maintenanceMode = false;
  auditLog.record(req.session.userID, 'MAINTENANCE_OFF', 'Maintenance mode disabled');
  req.flash('success', 'Maintenance mode disabled. System is operational.');
  res.redirect('/maintenance');
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nSDMS running at http://localhost:${PORT}`);
  console.log(`  Register:    http://localhost:${PORT}/register`);
  console.log(`  OTP codes printed here in dev mode\n`);
});

module.exports = app;
