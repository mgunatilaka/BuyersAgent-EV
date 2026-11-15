import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncAustralianEvCatalog, getCatalogState } from './syncService.js';
import { enrichWithLeaseAndScore } from './scoringEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '../public');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files (automatically serves public/index.html at GET /)
app.use(express.static(PUBLIC_DIR));

/**
 * GET /api/v1/evs
 */
app.get('/api/v1/evs', (req, res) => {
  const { vehicles, lastSyncedAt } = getCatalogState();
  const {
    make,
    drivetrain,
    maxPrice,
    minTowballKg,
    minClearanceMm,
    minRangeKm,
    v2l,
    ventilatedSeats,
    hud,
    carplay,
    requireTowing = 'true'
  } = req.query;

  const enforceTowScoring = requireTowing !== 'false';
  let results = vehicles.map((v) => enrichWithLeaseAndScore(v, enforceTowScoring));

  if (make) results = results.filter((v) => v.make.toLowerCase() === make.toLowerCase());
  if (drivetrain) results = results.filter((v) => v.drivetrain.toUpperCase() === drivetrain.toUpperCase());
  if (maxPrice) results = results.filter((v) => v.novatedLease.effectivePriceAud <= Number(maxPrice));
  if (minTowballKg) results = results.filter((v) => v.towballDownloadKg >= Number(minTowballKg));
  if (minClearanceMm) results = results.filter((v) => (v.groundClearanceMm || 0) >= Number(minClearanceMm));
  if (minRangeKm) results = results.filter((v) => (v.wltpRangeKm || 0) >= Number(minRangeKm));
  if (v2l === 'true') results = results.filter((v) => v.features?.v2l === true);
  if (ventilatedSeats === 'true') results = results.filter((v) => v.features?.ventilatedFrontSeats === true);
  if (hud === 'true') results = results.filter((v) => v.features?.headUpDisplay === true);
  if (carplay === 'true') results = results.filter((v) => v.features?.wirelessCarPlay === true);

  results.sort((a, b) => b.evaluation.totalScoreOutOf100 - a.evaluation.totalScoreOutOf100);

  res.json({
    market: 'AU-NSW',
    lastSyncedAt,
    totalResults: results.length,
    vehicles: results
  });
});

/**
 * POST /api/v1/evs
 * Allows the dashboard's "Add / Edit AU Car" modal to upsert vehicles into the live catalog
 */
app.post('/api/v1/evs', (req, res) => {
  const incoming = req.body;
  if (!incoming?.make || !incoming?.model) {
    return res.status(400).json({ error: 'make and model are required' });
  }

  const { vehicles } = getCatalogState();
  const id =
    incoming.id ||
    `${incoming.make}-${incoming.model}-${incoming.variant || 'base'}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');

  const record = { ...incoming, id, source: 'ui-custom' };
  const idx = vehicles.findIndex((v) => v.id === id);
  if (idx >= 0) vehicles[idx] = record;
  else vehicles.push(record);

  res.status(201).json({ status: 'saved', vehicle: enrichWithLeaseAndScore(record, true) });
});

/**
 * GET /api/v1/evs/compare
 */
app.get('/api/v1/evs/compare', (req, res) => {
  const ids = (req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  const { vehicles } = getCatalogState();
  const matched = vehicles
    .filter((v) => ids.includes(v.id))
    .map((v) => enrichWithLeaseAndScore(v, true));

  res.json({ count: matched.length, comparison: matched });
});

/**
 * POST /api/v1/evs/sync
 */
app.post('/api/v1/evs/sync', async (_req, res) => {
  const summary = await syncAustralianEvCatalog();
  res.json({ status: 'synced', ...summary });
});

// Explicit fallback for GET /
app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;
await syncAustralianEvCatalog();
app.listen(PORT, () => {
  console.log(`AU EV Explorer & API running at http://localhost:${PORT}`);
});