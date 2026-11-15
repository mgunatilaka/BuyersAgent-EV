/**
 * Builds data/au-bev-catalog.json from the raw evdbau CSV extracts plus the
 * reference rules in ./reference.js.
 *
 *   npm run build:catalog
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATA_AS_OF, LCT_FUEL_EFFICIENT_THRESHOLD, P_PLATE_LIMIT_KW_PER_TONNE, STATES, LEARNER_NOTE,
  originFor, estimateDepreciation, reviewLinks
} from './reference.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const RAW_VARIANTS = path.join(DATA_DIR, 'raw', 'evdbau-variants-2026-11.csv');
const RAW_BATTERY = path.join(DATA_DIR, 'raw', 'evdbau-battery-2026-11.csv');
const OUT = path.join(DATA_DIR, 'au-bev-catalog.json');

// ---------------------------------------------------------------- CSV parsing
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);

// ---------------------------------------------------------------- status & naming
function classify(raw) {
  const v = raw.variant;
  const priced = num(raw.price_aud) !== null;
  const upcomingTag = /upcoming|20\d\dQ\d/i.test(v);
  const rangeYears = /\(\d{4}-\d{4}\)/.test(v);
  if (!priced && (upcomingTag || /\(202[7-9]\)/.test(v))) return 'upcoming';
  if (!priced) return 'previous';
  if (upcomingTag) return 'arriving';
  return 'on-sale';
}

function cleanVariant(raw) {
  return raw.variant
    .replace(/\s*\((?:\d{4}(?:-\d{4})?|20\d\dQ\d(?: upcoming)?)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- features
const FEATURE_PATTERNS = {
  heatedSeats: /heated (?:and (?:power-adjustable |ventilated )?)?(?:front )?(?:seats|front)|heated front|heated seats/i,
  ventilatedSeats: /ventilat/i,
  massageSeats: /massag/i,
  hud: /head-up|heads-up|\bhud\b|ar active driving display/i,
  camera360: /360|surround[- ]view|around view|area view|surround view/i,
  panoramicRoof: /panoramic|glass roof|vision roof|sunroof/i,
  heatPump: /heat pump|heat-pump/i,
  wirelessPhoneProjection: /wireless (?:and wired )?(?:apple )?carplay|wireless carplay|wired and wireless carplay/i,
  premiumAudio: /bose|harman|sennheiser|yamaha|bowers|burmester|mark levinson|jbl|sony|canton|infinity|akg|dynaudio|devialet|1000w|\b1[0-9]-speaker|\b2[0-9]-speaker|\b2[0-9] speakers/i,
  powerTailgate: /power(?:ed)? tailgate|hands-free (?:power |electric )?tailgate|gesture tailgate|power boot|hands-free boot/i,
  digitalMirror: /digital (?:rear-view|rear view|centre|side|exterior)/i,
  airSuspension: /air suspension/i
};

function parseFeatures(text) {
  const out = {};
  for (const [key, re] of Object.entries(FEATURE_PATTERNS)) out[key] = re.test(text) ? true : null;
  const v2l = text.match(/V2L\s*([\d.]+)\s*kW/i);
  out.v2lKw = v2l ? Number(v2l[1]) : /V2L/i.test(text) ? true : null;
  return out;
}

// ---------------------------------------------------------------- licence rules
function licenceFlags(powerKw, kerbKg) {
  const ratio = powerKw && kerbKg ? Math.round((powerKw / (kerbKg / 1000)) * 10) / 10 : null;
  const byState = {};
  for (const [code, s] of Object.entries(STATES)) {
    let status;
    if (!s.pPlate.restricted) status = 'allowed';
    else if (ratio === null) status = 'unknown';
    else if (ratio > P_PLATE_LIMIT_KW_PER_TONNE + 5) status = 'banned';
    else if (ratio > P_PLATE_LIMIT_KW_PER_TONNE - 5) status = 'borderline';
    else status = 'allowed';
    byState[code] = { status, appliesTo: s.pPlate.appliesTo };
  }
  return { kwPerTonne: ratio, basis: 'kerb weight (tare mass is usually similar for EVs)', byState };
}

// ---------------------------------------------------------------- state costs
function stateCosts(price, basis) {
  const out = {};
  for (const [code, s] of Object.entries(STATES)) {
    if (!price) { out[code] = null; continue; }
    if (basis === 'driveaway') {
      out[code] = { quotedDriveAway: price, note: 'Advertised drive-away price (usually national).' };
      continue;
    }
    const duty = Math.round(s.duty(price));
    out[code] = {
      listPrice: price,
      stampDuty: duty,
      regoCtp: s.regoCtp,
      estDriveAwayExDelivery: price + duty + s.regoCtp,
      dutyStatus: s.dutyStatus,
      regoStatus: s.regoStatus
    };
  }
  return out;
}

// ---------------------------------------------------------------- ratings
const clamp = (x, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, x));
const scale = (x, lo, hi) => (x === null || x === undefined ? null : clamp(((x - lo) / (hi - lo)) * 10));

export const RATING_WEIGHTS = {
  value: 20, range: 15, efficiency: 10, charging: 10, practicality: 15, safety: 10, resale: 15, performance: 5
};

function rate(v) {
  const featureCount = Object.values(v.features).filter((f) => f === true || typeof f === 'number').length;
  const parts = {
    value: v.priceAud ? clamp(scale(v.rangeKm / (v.priceAud / 1000), 4, 14) * 0.8 + featureCount * 0.25) : null,
    range: scale(v.rangeKm, 250, 700),
    efficiency: v.efficiencyKwhPer100km ? scale(26 - v.efficiencyKwhPer100km, 4, 14) : null,
    charging: scale(v.charging.dcKw, 50, 350),
    practicality: (() => {
      const cargo = (v.bootL || 0) + (v.frunkL || 0);
      const base = scale(cargo, 250, 900) ?? 4;
      const seats = v.seats >= 7 ? 2 : v.seats >= 5 ? 1 : 0;
      const tow = v.towingBrakedKg >= 1500 ? 1.5 : v.towingBrakedKg >= 750 ? 0.75 : 0;
      return clamp(base * 0.7 + seats + tow);
    })(),
    safety: v.ancap === '5' ? 10 : v.ancap === '4' ? 7 : v.ancap === '3' ? 4 : null,
    resale: scale(v.depreciation.retained3yPct, 32, 62),
    performance: v.zeroTo100s ? scale(11 - v.zeroTo100s, 0, 8) : null
  };
  let total = 0;
  let weight = 0;
  for (const [k, w] of Object.entries(RATING_WEIGHTS)) {
    if (parts[k] === null || parts[k] === undefined) continue;
    total += parts[k] * w;
    weight += w;
  }
  for (const k of Object.keys(parts)) if (parts[k] !== null) parts[k] = Math.round(parts[k] * 10) / 10;
  return { score: weight ? Math.round((total / weight) * 10) : null, breakdown: parts, coveragePct: weight };
}

// ---------------------------------------------------------------- main
export async function buildCatalog() {
  const [variantsCsv, batteryCsv] = await Promise.all([
    fs.readFile(RAW_VARIANTS, 'utf-8'),
    fs.readFile(RAW_BATTERY, 'utf-8')
  ]);
  const battery = new Map(parseCsv(batteryCsv).map((r) => [`${r.make}|${r.model}|${r.variant}`, r]));

  const vehicles = [];
  const counts = { 'on-sale': 0, arriving: 0, upcoming: 0, previous: 0 };
  const seenIds = new Set();

  for (const raw of parseCsv(variantsCsv)) {
    const status = classify(raw);
    counts[status]++;
    if (status === 'previous') continue;

    const b = battery.get(`${raw.make}|${raw.model}|${raw.variant}`) || {};
    const variant = cleanVariant(raw);
    let id = slug(`${raw.make}-${raw.model}-${variant}`);
    while (seenIds.has(id)) id = `${id}-x`;
    seenIds.add(id);

    const priceAud = num(raw.price_aud) !== null ? Math.round(num(raw.price_aud)) : null;
    const basis = /drive/i.test(raw.price_basis) ? 'driveaway' : raw.price_basis ? 'list' : null;
    const usable = num(b.usable_kwh);
    const range = num(raw.wltp_range_km);
    const powerKw = num(raw.power_kw);
    const kerbKg = num(raw.kerb_weight_kg);
    const origin = originFor(raw.make, raw.model);
    const ancap = (raw.ancap.match(/^(\d)/) || [])[1] || (raw.ancap ? raw.ancap : null);

    const v = {
      id,
      make: raw.make,
      model: raw.model,
      variant,
      status,
      priceAud,
      priceBasis: basis,
      bodyType: raw.body_type || null,
      drivetrain: raw.drivetrain || null,
      seats: num(raw.seats),
      rangeKm: range,
      battery: {
        grossKwh: num(raw.battery_kwh),
        usableKwh: usable,
        chemistry: b.battery_chemistry || null
      },
      efficiencyKwhPer100km: range && (usable || num(raw.battery_kwh))
        ? Math.round(((usable || num(raw.battery_kwh)) / range) * 1000) / 10
        : null,
      charging: { dcKw: num(raw.max_dc_kw), acKw: num(raw.max_ac_kw) },
      powerKw,
      torqueNm: num(raw.torque_nm),
      zeroTo100s: num(raw.zero_to_100_s),
      kerbWeightKg: kerbKg,
      towingBrakedKg: num(raw.towing_braked_kg),
      bootL: num(raw.boot_l),
      frunkL: num(raw.frunk_l),
      groundClearanceMm: num(raw.ground_clearance_mm),
      ancap,
      origin,
      fbtExemptEligible: priceAud ? priceAud <= LCT_FUEL_EFFICIENT_THRESHOLD : null,
      features: parseFeatures(raw.key_features || ''),
      keyFeatures: raw.key_features ? raw.key_features.split(';').map((s) => s.trim()).filter(Boolean) : [],
      reviews: reviewLinks(raw.make, raw.model),
      source: { name: 'EV Database Australia (evdbau.com)', url: raw.source_url, retrieved: DATA_AS_OF }
    };
    v.licence = licenceFlags(powerKw, kerbKg);
    v.stateCosts = stateCosts(priceAud, basis);
    v.depreciation = estimateDepreciation(v);
    v.rating = rate(v);
    vehicles.push(v);
  }

  vehicles.sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || (a.priceAud ?? 1e9) - (b.priceAud ?? 1e9));

  const catalog = {
    asOf: DATA_AS_OF,
    counts: { ...counts, included: vehicles.length },
    lctThreshold: LCT_FUEL_EFFICIENT_THRESHOLD,
    pPlateLimitKwPerTonne: P_PLATE_LIMIT_KW_PER_TONNE,
    learnerNote: LEARNER_NOTE,
    ratingWeights: RATING_WEIGHTS,
    states: Object.fromEntries(Object.entries(STATES).map(([code, s]) => [code, {
      name: s.name, dutyNote: s.dutyNote, dutyStatus: s.dutyStatus, dutySource: s.dutySource,
      regoCtp: s.regoCtp, regoStatus: s.regoStatus, regoSource: s.regoSource || null,
      incentives: s.incentives, pPlate: s.pPlate, pPlateCheck: s.pPlateCheck
    }])),
    disclaimers: [
      'Specs and prices: EV Database Australia (evdbau.com), retrieved 15 Nov 2026. Not manufacturer-verified; confirm with the dealer.',
      'Stamp duty uses the list price as the dutiable value. Rego/CTP figures marked "estimate" are approximate. Dealer delivery is excluded.',
      'Depreciation is a brand/segment heuristic, not auction data.',
      'P-plate status uses kerb weight as a proxy for tare mass; always check the official state tool before buying.',
      'Country of manufacture is an editorial reference, not from the source pages.'
    ],
    vehicles
  };

  await fs.writeFile(OUT, JSON.stringify(catalog, null, 2), 'utf-8');
  return catalog;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildCatalog().then((c) => {
    console.log(`Wrote ${c.vehicles.length} variants to ${OUT}`);
    console.log('Status counts:', c.counts);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
