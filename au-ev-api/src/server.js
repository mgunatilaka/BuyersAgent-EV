import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Supabase credentials configured via Render / hosting Environment Variables
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve static frontend files from ../public
app.use(express.static(path.join(__dirname, '../public')));

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
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

/**
 * GET /api/v1/evs
 * Fetch all custom/updated EV records persisted in Supabase
 */
app.get('/api/v1/evs', async (_req, res) => {
  if (!hasSupabaseConfig()) {
    return res.status(200).json({
      supabaseConnected: false,
      vehicles: []
    });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/custom_evs?select=payload`, {
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
 * POST /api/v1/evs
 * Create or update a single EV record in Supabase
 */
app.post('/api/v1/evs', async (req, res) => {
  const record = req.body;
  if (!record || !record.id || !record.make || !record.model) {
    return res.status(400).json({ error: 'Invalid EV payload: id, make, and model are required.' });
  }

  if (!hasSupabaseConfig()) {
    return res.status(503).json({
      error: 'SUPABASE_URL and SUPABASE_SERVICE_KEY are not set in server environment variables.'
    });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/custom_evs`, {
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
 * POST /api/v1/evs/seed
 * Bulk upsert an array of EV records into Supabase
 */
app.post('/api/v1/evs/seed', async (req, res) => {
  const vehicles = Array.isArray(req.body?.vehicles) ? req.body.vehicles : [];
  if (vehicles.length === 0) {
    return res.status(400).json({ error: 'Request body must include a non-empty vehicles array.' });
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

    const response = await fetch(`${SUPABASE_URL}/rest/v1/custom_evs`, {
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

// Fallback to index.html for root requests
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`AU EV Explorer & API running at http://localhost:${PORT} (Supabase: ${hasSupabaseConfig() ? 'Connected' : 'Not configured'})`);
});