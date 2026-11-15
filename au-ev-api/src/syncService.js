import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_PATH = path.join(__dirname, '../data/au-market-overlay.json');
const GITHUB_RELEASE_API = 'https://api.github.com/repos/open-ev-data/open-ev-data-dataset/releases/latest';

let cachedVehicles = [];
let lastSyncedAt = null;

function normalizeOpenEvRecord(raw) {
  const auMarket = raw.markets?.find((m) => m.country === 'AU' || m.region === 'AU');
  return {
    id: raw.id || `${raw.make}-${raw.model}-${raw.trim || 'base'}`.toLowerCase().replace(/\s+/g, '-'),
    make: raw.make,
    model: raw.model,
    variant: raw.trim || raw.variant || 'Standard',
    year: raw.year || 2026,
    drivetrain: raw.powertrain?.drivetrain?.toUpperCase() || 'RWD',
    nswDriveAwayPrice: auMarket?.msrp ? Math.round(auMarket.msrp * 1.07) : null,
    demoDriveAwayPrice: null,
    powerKw: raw.powertrain?.power_kw || null,
    torqueNm: raw.powertrain?.torque_nm || null,
    zeroToHundredSec: raw.performance?.acceleration_0_100_kmh || null,
    batteryKwh: raw.battery?.usable_capacity_kwh || raw.battery?.nominal_capacity_kwh || null,
    wltpRangeKm: raw.range?.wltp_km || null,
    maxDcKw: raw.charging?.dc_max_kw || null,
    maxAcKw: raw.charging?.ac_max_kw || 11,
    groundClearanceMm: raw.dimensions?.ground_clearance_mm || null,
    brakedTowingKg: raw.towing?.braked_kg || 0,
    towballDownloadKg: raw.towing?.tongue_weight_kg || 0,
    bootLitres: raw.cargo?.trunk_volume_l || null,
    frunkLitres: raw.cargo?.frunk_volume_l || 0,
    wheelSizeInch: raw.wheels?.front_diameter_in || 19,
    features: {
      v2l: Boolean(raw.charging?.v2l),
      v2lWatts: raw.charging?.v2l_power_kw ? raw.charging.v2l_power_kw * 1000 : 0,
      ventilatedFrontSeats: Boolean(raw.features?.ventilated_seats),
      massagingSeats: Boolean(raw.features?.massaging_seats),
      headUpDisplay: Boolean(raw.features?.hud),
      panoramicRoof: Boolean(raw.features?.panoramic_roof),
      wirelessCarPlay: Boolean(raw.features?.apple_carplay),
      gloveBox: raw.features?.glove_box ?? true,
      offRoadMode: raw.features?.off_road_mode || null
    },
    source: 'open-ev-data'
  };
}

export async function syncAustralianEvCatalog() {
  const overlayRaw = await fs.readFile(OVERLAY_PATH, 'utf-8');
  const auOverlay = JSON.parse(overlayRaw).map((v) => ({ ...v, source: 'au-market-overlay' }));

  let remoteAuVehicles = [];
  try {
    const releaseRes = await fetch(GITHUB_RELEASE_API, {
      headers: { 'User-Agent': 'au-ev-catalog-api' }
    });
    if (releaseRes.ok) {
      const release = await releaseRes.json();
      const jsonAsset = release.assets?.find((a) => a.name.endsWith('.json'));
      if (jsonAsset?.browser_download_url) {
        const dataRes = await fetch(jsonAsset.browser_download_url);
        const dataset = await dataRes.json();
        const vehicles = Array.isArray(dataset) ? dataset : dataset.vehicles || [];

        remoteAuVehicles = vehicles
          .filter((v) => v.markets?.some((m) => m.country === 'AU' || m.region === 'AU'))
          .map(normalizeOpenEvRecord);
      }
    }
  } catch (err) {
    console.warn('OpenEV upstream sync skipped, using AU local overlay:', err.message);
  }

  // Merge: local AU overlay overrides matching make+model+variant records from upstream
  const mergedMap = new Map();
  for (const item of remoteAuVehicles) {
    const key = `${item.make}|${item.model}|${item.variant}`.toLowerCase();
    mergedMap.set(key, item);
  }
  for (const item of auOverlay) {
    const key = `${item.make}|${item.model}|${item.variant}`.toLowerCase();
    mergedMap.set(key, item);
  }

  cachedVehicles = Array.from(mergedMap.values());
  lastSyncedAt = new Date().toISOString();
  return { count: cachedVehicles.length, lastSyncedAt };
}

export function getCatalogState() {
  return { vehicles: cachedVehicles, lastSyncedAt };
}