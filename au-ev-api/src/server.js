import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SESSION_COOKIE = 'ba_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 1 code per minute
const OTP_MAX_ATTEMPTS = 5;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;
const STRING_FIELD_LIMITS = {
  make: 60,
  model: 80,
  variant: 120,
  bodyType: 60,
  drivetrain: 10,
  notes: 2000
};
const MAX_SEED_VEHICLES = 500;

function hmac(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Create a signed admin session token of the form `<expiresAtMs>.<hmac>`.
 * Exported so tests can mint a session without going through the email flow.
 */
export function signAdminSession(secret, ttlMs = SESSION_TTL_MS) {
  const expiresAt = String(Date.now() + ttlMs);
  return `${expiresAt}.${hmac(secret, `admin:${expiresAt}`)}`;
}

function verifyAdminSession(secret, token) {
  if (!token || typeof token !== 'string') return false;
  const [expiresAt, sig] = token.split('.');
  if (!expiresAt || !sig || !/^\d+$/.test(expiresAt)) return false;
  if (Date.now() > Number(expiresAt)) return false;
  return safeEqual(sig, hmac(secret, `admin:${expiresAt}`));
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/**
 * Returns an error string if the vehicle record is invalid, otherwise null.
 * Client-side escaping is the primary XSS defence; this keeps junk out of the DB.
 */
export function validateVehicle(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return 'Invalid EV payload: expected an object.';
  }
  if (!record.id || !record.make || !record.model) {
    return 'Invalid EV payload: id, make, and model are required.';
  }
  if (typeof record.id !== 'string' || !ID_PATTERN.test(record.id)) {
    return 'Invalid EV payload: id must be lowercase letters, numbers and dashes (max 120 chars).';
  }
  for (const [field, max] of Object.entries(STRING_FIELD_LIMITS)) {
    const value = record[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || value.length > max) {
      return `Invalid EV payload: ${field} must be a string of at most ${max} characters.`;
    }
  }
  return null;
}

/**
 * Factory function creating the configured Express app.
 * Accepts optional dependency overrides so unit/integration tests can inject
 * custom fetch mocks or environment values without mutating global state.
 */
export function createApp({
  supabaseUrl = process.env.SUPABASE_URL || '',
  supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '',
  adminEmail = process.env.ADMIN_EMAIL || '',
  resendApiKey = process.env.RESEND_API_KEY || '',
  resendFromEmail = process.env.RESEND_FROM_EMAIL || 'BuyersAgent EV <onboarding@resend.dev>',
  sessionSecret = process.env.SESSION_SECRET || '',
  fetchImpl = globalThis.fetch
} = {}) {
  const app = express();
  const SUPABASE_URL = supabaseUrl.trim().replace(/\/+$/, '');
  const SUPABASE_KEY = supabaseKey.trim();
  const ADMIN_EMAIL = adminEmail.trim().toLowerCase();
  const RESEND_API_KEY = resendApiKey.trim();
  // Without a configured secret, sessions are signed with a per-process random key
  // (admins are simply logged out when the server restarts).
  const SESSION_SECRET = sessionSecret.trim() || crypto.randomBytes(32).toString('hex');

  // In-memory one-time PIN store: { pin, expiresAt, attempts, sentAt }
  let activeOtp = null;

  // Render (and most hosts) terminate TLS at a proxy
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Public read API may be used cross-origin; cookies are SameSite=Strict so
  // cross-site requests can never carry the admin session.
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // Serve static frontend files from ../public
  app.use(express.static(path.join(__dirname, '../public')));

  function hasSupabaseConfig() {
    return Boolean(SUPABASE_URL && SUPABASE_KEY);
  }

  function isAdmin(req) {
    return verifyAdminSession(SESSION_SECRET, readCookie(req, SESSION_COOKIE));
  }

  function requireAdmin(req, res, next) {
    if (!isAdmin(req)) {
      return res.status(401).json({ error: 'Admin login required.' });
    }
    return next();
  }

  function setSessionCookie(req, res, token, maxAgeMs) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      path: '/',
      maxAge: maxAgeMs
    });
  }

  /**
   * Health check endpoint for Render
   */
  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      supabaseConfigured: hasSupabaseConfig(),
      timestamp: new Date().toISOString()
    });
  });

  // ==========================================================================
  // Admin authentication (email one-time PIN via Resend -> signed HttpOnly cookie)
  // ==========================================================================

  app.get('/api/v1/admin/session', (req, res) => {
    res.status(200).json({ admin: isAdmin(req), loginEnabled: Boolean(ADMIN_EMAIL) });
  });

  app.post('/api/v1/admin/send-otp', async (req, res) => {
    if (!ADMIN_EMAIL) {
      return res.status(503).json({ error: 'Admin login is not configured (ADMIN_EMAIL is not set).' });
    }
    if (!RESEND_API_KEY) {
      return res.status(503).json({ error: 'Email service (RESEND_API_KEY) is not configured on the server.' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();

    // Only the configured admin address may sign in; anything else is rejected outright.
    if (!email || !safeEqual(email, ADMIN_EMAIL)) {
      return res.status(403).json({ error: 'Access denied: this email is not authorised for admin access.' });
    }

    if (activeOtp && Date.now() - activeOtp.sentAt < OTP_RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'A code was just sent. Please wait a minute before requesting another.' });
    }

    const pin = String(crypto.randomInt(100000, 1000000));
    activeOtp = { pin, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0, sentAt: Date.now() };

    try {
      const emailResponse = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: resendFromEmail,
          to: [ADMIN_EMAIL],
          subject: `Your BuyersAgent EV admin code: ${pin}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
              <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 18px;">Australian EV Explorer: admin sign-in</h2>
              <p style="margin: 0 0 16px; color: #475569; font-size: 14px; line-height: 1.5;">Use this one-time code to sign in as site admin:</p>
              <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px; text-align: center; font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #059669;">${pin}</div>
              <p style="margin: 16px 0 0; color: #64748b; font-size: 12px;">This code expires in <strong>10 minutes</strong>. If you did not request it, you can ignore this email.</p>
            </div>
          `
        })
      });

      if (!emailResponse.ok) {
        const errDetail = await emailResponse.text();
        console.error('[Resend API Error]', emailResponse.status, errDetail);
        activeOtp = null;
        return res.status(502).json({ error: `Email provider returned HTTP ${emailResponse.status}.` });
      }

      return res.status(200).json({ ok: true, message: 'A 6-digit code has been sent to the admin email.' });
    } catch (err) {
      console.error('[Admin OTP Send Error]', err);
      activeOtp = null;
      return res.status(500).json({ error: 'Could not send the sign-in email.' });
    }
  });

  app.post('/api/v1/admin/verify-otp', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const submittedPin = String(req.body?.pin || '').trim();

    if (!ADMIN_EMAIL || !email || !safeEqual(email, ADMIN_EMAIL)) {
      return res.status(403).json({ error: 'Access denied: this email is not authorised for admin access.' });
    }
    if (!activeOtp) {
      return res.status(401).json({ error: 'Invalid or expired code. Please request a new one.' });
    }

    if (Date.now() > activeOtp.expiresAt) {
      activeOtp = null;
      return res.status(401).json({ error: 'Invalid or expired code. Please request a new one.' });
    }

    activeOtp.attempts += 1;
    if (activeOtp.attempts > OTP_MAX_ATTEMPTS) {
      activeOtp = null;
      return res.status(429).json({ error: 'Too many failed attempts. Please request a new code.' });
    }

    if (!safeEqual(submittedPin, activeOtp.pin)) {
      return res.status(401).json({ error: 'Incorrect code. Please check your email.' });
    }

    activeOtp = null; // single use
    setSessionCookie(req, res, signAdminSession(SESSION_SECRET), SESSION_TTL_MS);
    return res.status(200).json({ ok: true, admin: true });
  });

  app.post('/api/v1/admin/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
    res.status(200).json({ ok: true });
  });

  // ==========================================================================
  // EV catalog
  // ==========================================================================

  /**
   * GET /api/v1/evs
   * Fetch all custom/updated EV records persisted in Supabase (public, read-only)
   */
  app.get('/api/v1/evs', async (_req, res) => {
    if (!hasSupabaseConfig()) {
      return res.status(200).json({
        supabaseConnected: false,
        vehicles: []
      });
    }

    try {
      const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/custom_evs?select=payload`, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Supabase GET Error]', response.status, errText);
        return res.status(502).json({
          supabaseConnected: false,
          error: `Supabase returned HTTP ${response.status}`,
          vehicles: []
        });
      }

      const rows = await response.json();
      const vehicles = rows.map((r) => r?.payload).filter((v) => v && v.id);

      return res.status(200).json({
        supabaseConnected: true,
        count: vehicles.length,
        vehicles
      });
    } catch (err) {
      console.error('[Supabase GET Exception]', err);
      return res.status(500).json({
        supabaseConnected: false,
        error: err.message,
        vehicles: []
      });
    }
  });

  /**
   * POST /api/v1/evs  (admin only)
   * Create or update a single EV record in Supabase
   */
  app.post('/api/v1/evs', requireAdmin, async (req, res) => {
    const record = req.body;
    const validationError = validateVehicle(record);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (!hasSupabaseConfig()) {
      return res.status(503).json({
        error: 'SUPABASE_URL and SUPABASE_SERVICE_KEY are not set in server environment variables.'
      });
    }

    try {
      const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/custom_evs`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          id: record.id,
          payload: record,
          updated_at: new Date().toISOString()
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Supabase POST Error]', response.status, errText);
        return res.status(502).json({ error: `Supabase save failed: HTTP ${response.status}` });
      }

      return res.status(200).json({ ok: true, id: record.id });
    } catch (err) {
      console.error('[Supabase POST Exception]', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/v1/evs/seed  (admin only)
   * Bulk upsert an array of EV records into Supabase
   */
  app.post('/api/v1/evs/seed', requireAdmin, async (req, res) => {
    const vehicles = Array.isArray(req.body?.vehicles) ? req.body.vehicles : [];
    if (vehicles.length === 0) {
      return res.status(400).json({ error: 'Request body must include a non-empty vehicles array.' });
    }
    if (vehicles.length > MAX_SEED_VEHICLES) {
      return res.status(400).json({ error: `At most ${MAX_SEED_VEHICLES} vehicles can be seeded at once.` });
    }
    for (const [i, ev] of vehicles.entries()) {
      const validationError = validateVehicle(ev);
      if (validationError) {
        return res.status(400).json({ error: `vehicles[${i}]: ${validationError}` });
      }
    }

    if (!hasSupabaseConfig()) {
      return res.status(503).json({
        error: 'SUPABASE_URL and SUPABASE_SERVICE_KEY are not set in server environment variables.'
      });
    }

    try {
      const rows = vehicles.map((ev) => ({
        id: ev.id,
        payload: ev,
        updated_at: new Date().toISOString()
      }));

      const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/custom_evs`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify(rows)
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[Supabase Seed Error]', response.status, errText);
        return res.status(502).json({ error: `Supabase bulk seed failed: HTTP ${response.status}` });
      }

      return res.status(200).json({ ok: true, count: rows.length });
    } catch (err) {
      console.error('[Supabase Seed Exception]', err);
      return res.status(500).json({ error: err.message });
    }
  });

  // Unknown API routes return JSON 404 instead of the HTML page
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Fallback to index.html for root/unknown routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  return app;
}

// Start HTTP server only when executed directly (not imported by tests)
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  // Load au-ev-api/.env for local development. On Render there is no .env file
  // and the dashboard's environment variables are used instead. Values already
  // set in the environment are never overwritten.
  const envFile = path.join(__dirname, '../.env');
  if (fs.existsSync(envFile)) {
    process.loadEnvFile(envFile);
    console.log('[Config] Loaded environment from .env');
  }

  const PORT = process.env.PORT || 3000;
  const app = createApp();
  if (!process.env.SESSION_SECRET) {
    console.warn('[Auth] SESSION_SECRET is not set: admin sessions will reset on every restart.');
  }
  if (!process.env.ADMIN_EMAIL) {
    console.warn('[Auth] ADMIN_EMAIL is not set: admin login (and all catalog writes) are disabled.');
  }
  app.listen(PORT, () => {
    const configured = Boolean((process.env.SUPABASE_URL || '').trim() && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '').trim());
    console.log(`AU EV Explorer & API running at http://localhost:${PORT} (Supabase: ${configured ? 'Connected' : 'Not configured'})`);
  });
}
