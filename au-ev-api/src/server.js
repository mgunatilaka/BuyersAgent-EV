import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Admin & Resend HTTPS Email API configuration (set in Render Environment Variables)
const AUTHORIZED_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'mhettivi@hotmail.com').trim().toLowerCase();
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'BuyersAgent EV <onboarding@resend.dev>';

// In-memory store for active one-time PINs (keyed by lowercase email)
const activeOtpStore = new Map();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Serve static frontend files from ../public
app.use(express.static(path.join(__dirname, '../public')));

/**
 * Health check endpoint for Render
 */
app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Step 1: Generate a cryptographically random 6-digit PIN and email it via Resend HTTPS API
 */
app.post('/api/v1/admin/send-otp', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();

    if (!email || email !== AUTHORIZED_ADMIN_EMAIL) {
      return res.status(403).json({
        error: 'Access denied: Email does not match the authorized Site Admin address.'
      });
    }

    // Generate cryptographically secure 6-digit PIN on the server
    const pin = String(crypto.randomInt(100000, 1000000));
    const expiresAt = Date.now() + 10 * 60 * 1000; // Valid for 10 minutes

    activeOtpStore.set(email, {
      pin,
      expiresAt,
      attempts: 0
    });

    if (!RESEND_API_KEY) {
      console.warn('[Admin OTP] RESEND_API_KEY not configured. Generated PIN:', pin);
      return res.status(503).json({
        error: 'Email service (RESEND_API_KEY) is not configured on the server.'
      });
    }

    // Dispatch email over HTTPS port 443 via Resend API
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [AUTHORIZED_ADMIN_EMAIL],
        subject: `Your BuyersAgent EV Admin PIN: ${pin}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="margin: 0 0 12px; color: #0f172a; font-size: 18px;">Australian EV Explorer — Site Admin Verification</h2>
            <p style="margin: 0 0 16px; color: #475569; font-size: 14px; line-height: 1.5;">
              Use the one-time 6-digit PIN below to unlock Site Admin mode and manage the Supabase EV database:
            </p>
            <div style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px; text-align: center; font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #059669;">
              ${pin}
            </div>
            <p style="margin: 16px 0 0; color: #64748b; font-size: 12px;">
              This code expires in <strong>10 minutes</strong>. If you did not request this login, you can safely ignore this email.
            </p>
          </div>
        `
      })
    });

    if (!emailResponse.ok) {
      const errDetail = await emailResponse.text();
      console.error('[Resend API Error]', emailResponse.status, errDetail);
      return res.status(502).json({
        error: `Email delivery provider returned HTTP ${emailResponse.status}.`
      });
    }

    return res.status(200).json({
      ok: true,
      message: `One-time PIN sent to ${AUTHORIZED_ADMIN_EMAIL}`
    });
  } catch (err) {
    console.error('[Admin OTP Send Error]', err);
    return res.status(500).json({ error: 'Internal server error while dispatching OTP email.' });
  }
});

/**
 * Step 2: Verify the 6-digit PIN submitted by the admin user
 */
app.post('/api/v1/admin/verify-otp', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const submittedPin = String(req.body?.pin || '').trim();

  if (email !== AUTHORIZED_ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Unauthorized admin email.' });
  }

  const record = activeOtpStore.get(email);
  if (!record) {
    return res.status(400).json({ error: 'No active PIN found. Please request a new code.' });
  }

  if (Date.now() > record.expiresAt) {
    activeOtpStore.delete(email);
    return res.status(400).json({ error: 'PIN has expired. Please request a new code.' });
  }

  record.attempts += 1;
  if (record.attempts > 5) {
    activeOtpStore.delete(email);
    return res.status(429).json({ error: 'Too many failed attempts. Please request a new PIN.' });
  }

  if (submittedPin !== record.pin) {
    return res.status(401).json({ error: 'Incorrect 6-digit PIN. Please check your email.' });
  }

  // Valid PIN — clear from store so it cannot be reused
  activeOtpStore.delete(email);
  return res.status(200).json({ ok: true, admin: true });
});

// Fallback to index.html for root requests
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`AU EV Explorer & API running at http://localhost:${PORT}`);
});