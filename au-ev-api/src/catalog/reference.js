/**
 * Reference data used to enrich the raw evdbau variant data.
 *
 * Everything here is either sourced from an official page (marked `confirmed`)
 * or an editorial estimate (marked `estimate` / `unconfirmed`). The UI shows
 * these labels so buyers know what to double-check. Researched 15 Nov 2026.
 */

export const DATA_AS_OF = '2026-11-15';

// FBT exemption for BEVs applies below the LCT fuel-efficient threshold.
// $91,387 is the FY2025-26 figure; confirm the FY2026-27 figure with the ATO.
export const LCT_FUEL_EFFICIENT_THRESHOLD = 91387;
export const P_PLATE_LIMIT_KW_PER_TONNE = 130;

const per = (value, step) => Math.ceil(value / step);

/**
 * Motor vehicle stamp duty for a NEW passenger battery-electric car.
 * `value` is the dutiable value (we use the list/drive-away price as a proxy).
 */
export const STATES = {
  NSW: {
    name: 'New South Wales',
    duty: (v) => (v < 45000 ? per(v, 100) * 3 : 1350 + per(v - 45000, 100) * 5),
    dutyNote: '$3 per $100 up to $44,999; $1,350 + $5 per $100 above $45,000. No EV concession since 1 Jan 2024.',
    dutyStatus: 'confirmed',
    dutySource: 'https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/motor-vehicle-duty',
    regoCtp: 1000,
    regoStatus: 'estimate',
    incentives: 'None current (rebate and duty refund ended 1 Jan 2024).',
    pPlate: { appliesTo: 'P1 and P2 drivers (any age)', rule: '> 130 kW/tonne (power to tare mass) or listed vehicles', restricted: true, under25Only: false },
    pPlateCheck: 'https://www.nsw.gov.au/driving-boating-and-transport/driver-and-rider-licences/driver-licences/p1-and-p2-prohibited-vehicles/search-prohibited-vehicles'
  },
  VIC: {
    name: 'Victoria',
    duty: (v) => per(v, 200) * 8.4,
    dutyNote: 'Green-car rate (incl. all BEVs): $8.40 per $200 at any value.',
    dutyStatus: 'confirmed',
    dutySource: 'https://www.sro.vic.gov.au/about-us/rates-and-statistics/current-rates/motor-vehicle-duty-current-rates',
    regoCtp: 950,
    regoStatus: 'estimate',
    incentives: 'Green-car duty rate. $100 rego discount ended 1 Jan 2026.',
    pPlate: { appliesTo: 'P1 and P2 drivers (any age), vehicles built from 2010', rule: '> 130 kW/tonne or gazetted; lower-performance exemptions possible', restricted: true, under25Only: false },
    pPlateCheck: 'https://www.transport.vic.gov.au/registration-and-licensing/licences/probationary-vehicles-database'
  },
  QLD: {
    name: 'Queensland',
    duty: (v) => (v <= 100000 ? per(v, 100) * 2 : per(v, 100) * 4),
    dutyNote: 'Hybrid/electric: $2 per $100 up to $100,000; $4 per $100 above (applied to the whole value).',
    dutyStatus: 'confirmed',
    dutySource: 'https://www.qld.gov.au/transport/registration/costs/duty/rates',
    regoCtp: 790,
    regoStatus: 'confirmed',
    regoSource: 'https://www.qld.gov.au/transport/registration/costs/fees',
    incentives: 'Concessional duty rate for electric vehicles.',
    pPlate: { appliesTo: 'P1 and P2 drivers under 25', rule: '> 130 kW/tonne (vehicles from 2010) or modified', restricted: true, under25Only: true },
    pPlateCheck: 'https://www.service.transport.qld.gov.au/hpv/public/Welcome.xhtml'
  },
  WA: {
    name: 'Western Australia',
    duty: (v) => {
      if (v <= 25000) return v * 0.0275;
      if (v <= 50000) {
        const rate = Math.round((2.75 + (v - 25000) / 6666.66) * 100) / 100;
        return v * (rate / 100);
      }
      return v * 0.065;
    },
    dutyNote: '2.75% up to $25k; sliding 2.75-6.5% to $50k; 6.5% above $50k. No EV concession.',
    dutyStatus: 'confirmed',
    dutySource: 'https://www.wa.gov.au/organisation/department-of-treasury-and-finance/vehicle-licence-duty',
    regoCtp: 900,
    regoStatus: 'estimate',
    incentives: 'None current ($3,500 ZEV rebate ended 10 May 2025).',
    pPlate: { appliesTo: 'No power restriction', rule: 'No high-powered vehicle rule found', restricted: false, under25Only: false },
    pPlateCheck: 'https://www.transport.wa.gov.au/licensing/drivers-licence'
  },
  SA: {
    name: 'South Australia',
    duty: (v) => {
      if (v <= 1000) return Math.max(5, per(v, 100) * 1);
      if (v <= 2000) return 10 + per(v - 1000, 100) * 2;
      if (v <= 3000) return 30 + per(v - 2000, 100) * 3;
      return 60 + per(v - 3000, 100) * 4;
    },
    dutyNote: '$60 + $4 per $100 above $3,000. No EV concession.',
    dutyStatus: 'confirmed',
    dutySource: 'https://www.revenuesa.sa.gov.au/stamp-duty-vehicles/rates',
    regoCtp: 950,
    regoStatus: 'estimate',
    incentives: 'None current.',
    pPlate: { appliesTo: 'P1 and P2 drivers under 25', rule: '> 130 kW/tonne tare (vehicles from 2010) or modified', restricted: true, under25Only: true },
    pPlateCheck: 'https://mylicence.sa.gov.au/safe-driving-tips/high-powered-vehicles'
  },
  TAS: {
    name: 'Tasmania',
    duty: (v) => {
      if (v <= 600) return 20;
      if (v <= 35000) return v * 0.03;
      if (v <= 40000) return 1050 + (v - 35000) * 0.11;
      return v * 0.04;
    },
    dutyNote: 'Unconfirmed (official site blocked automated reading): ~3% to $35k, 4% above $40k.',
    dutyStatus: 'unconfirmed',
    dutySource: 'https://www.sro.tas.gov.au/duties/motor-vehicle-duty',
    regoCtp: 650,
    regoStatus: 'estimate',
    incentives: 'None current.',
    pPlate: { appliesTo: 'No power restriction', rule: 'No high-powered vehicle rule found', restricted: false, under25Only: false },
    pPlateCheck: 'https://www.transport.tas.gov.au/'
  },
  ACT: {
    name: 'Australian Capital Territory',
    duty: (v) => {
      if (v < 45000) return per(v, 100) * 2.5;
      if (v <= 80000) return 1125 + per(v - 45000, 100) * 4;
      return 2525 + per(v - 80000, 100) * 8;
    },
    dutyNote: 'Zero-emission (AAA) rate: 2.5% under $45k; $1,125 + 4% to $80k; $2,525 + 8% above. Full exemption ended 31 Aug 2025.',
    dutyStatus: 'confirmed',
    dutySource: 'https://www.revenue.act.gov.au/duties/motor-vehicle-duty',
    regoCtp: 1000,
    regoStatus: 'estimate',
    incentives: 'Lowest emissions-based duty band.',
    pPlate: { appliesTo: 'No power restriction', rule: 'No high-powered vehicle rule on Access Canberra pages', restricted: false, under25Only: false },
    pPlateCheck: 'https://www.accesscanberra.act.gov.au/driving-transport-and-parking/licences/probationary-licences'
  },
  NT: {
    name: 'Northern Territory',
    duty: (v) => Math.max(0, v * 0.03 - 1500),
    dutyNote: 'Unconfirmed: 3% standard; EV concession up to $1,500 (reported open until 30 Jun 2027).',
    dutyStatus: 'unconfirmed',
    dutySource: 'https://treasury.nt.gov.au/',
    regoCtp: 800,
    regoStatus: 'estimate',
    incentives: 'EV duty concession up to $1,500 (secondary sources).',
    pPlate: { appliesTo: 'No power restriction', rule: 'No high-powered vehicle rule found', restricted: false, under25Only: false },
    pPlateCheck: 'https://nt.gov.au/driving'
  }
};

export const LEARNER_NOTE =
  'No state was confirmed to restrict learner (L) drivers by vehicle power. Learners must be supervised; check your state before driving a high-powered EV.';

/**
 * Country of manufacture for the Australian-delivered model.
 * Editorial reference (not stated on the source pages). `confidence` is shown in the UI.
 */
export const MODEL_ORIGIN = {
  'BYD|*': ['China', 'high'], 'Denza|*': ['China', 'high'], 'MG|*': ['China', 'high'], 'GWM|*': ['China', 'high'],
  'Leapmotor|*': ['China', 'high'], 'Chery|*': ['China', 'high'], 'Jaecoo|*': ['China', 'high'], 'Geely|*': ['China', 'high'],
  'XPeng|*': ['China', 'high'], 'Zeekr|*': ['China', 'high'], 'Deepal|*': ['China', 'high'], 'GAC|*': ['China', 'high'],
  'Forthing|*': ['China', 'high'], 'LDV|*': ['China', 'high'], 'Farizon|*': ['China', 'high'], 'Smart|*': ['China', 'high'],
  'Lotus|*': ['China', 'high'], 'Tesla|*': ['China', 'high'],
  'Hyundai|Elexio': ['China', 'high'], 'Hyundai|*': ['South Korea', 'medium'],
  'Kia|EV5': ['China', 'high'], 'Kia|*': ['South Korea', 'medium'], 'Genesis|*': ['South Korea', 'high'], 'KGM|*': ['South Korea', 'high'],
  'Toyota|Hilux BEV': ['Thailand', 'high'], 'Toyota|*': ['Japan', 'high'], 'Lexus|*': ['Japan', 'high'], 'Subaru|*': ['Japan', 'high'],
  'Mazda|*': ['China', 'high'], 'Honda|*': ['Japan', 'high'], 'Nissan|*': ['Japan', 'high'], 'Suzuki|*': ['India', 'high'],
  'Volkswagen|Transporter': ['Türkiye', 'high'], 'Volkswagen|*': ['Germany', 'high'], 'Skoda|*': ['Czech Republic', 'high'],
  'Cupra|Tavascan': ['China', 'high'], 'Cupra|Born': ['Germany', 'high'], 'Cupra|Raval': ['Spain', 'medium'], 'Jaguar|*': ['United Kingdom', 'medium'],'Renault|*': ['France', 'high'], 'Peugeot|E-Partner': ['Spain', 'medium'], 'Peugeot|*': ['France', 'medium'],
  'Alfa Romeo|*': ['Poland', 'high'], 'Mini|Countryman': ['Germany', 'high'], 'Mini|*': ['China', 'high'],
  'Ford|Mustang Mach-E': ['Mexico', 'high'], 'Ford|E-Transit': ['Türkiye', 'high'], 'Ford|Transit City': ['China', 'high'],
  'BMW|iX3': ['Hungary', 'high'], 'BMW|iX4': [null, 'unknown'], 'BMW|*': ['Germany', 'high'],
  'Mercedes-Benz|eVito': ['Spain', 'high'], 'Mercedes-Benz|G-Class': ['Austria', 'high'], 'Mercedes-Benz|GLB': [null, 'unknown'], 'Mercedes-Benz|*': ['Germany', 'medium'],
  'Audi|*': ['Germany', 'high'], 'Porsche|Cayenne': ['Slovakia', 'high'], 'Porsche|*': ['Germany', 'high'],
  'Volvo|EX40': ['Belgium', 'high'], 'Volvo|EX60': ['Sweden', 'medium'], 'Volvo|EX90': ['USA', 'medium'], 'Volvo|*': ['China', 'medium'],
  'Polestar|*': ['China', 'medium'], 'Rolls-Royce|*': ['United Kingdom', 'high'],
  'Cadillac|Optiq': [null, 'unknown'], 'Cadillac|*': ['USA', 'medium']
};

export function originFor(make, model) {
  const hit = MODEL_ORIGIN[`${make}|${model}`] || MODEL_ORIGIN[`${make}|*`];
  return hit ? { country: hit[0], confidence: hit[1] } : { country: null, confidence: 'unknown' };
}

/**
 * Estimated share of value retained after 3 years (private sale, average km).
 * Heuristic by brand; NOT auction data. Shown in the UI as an estimate.
 */
const BRAND_RETAINED_3Y = {
  Tesla: 58, Toyota: 60, Lexus: 55, Subaru: 55, Porsche: 55, 'Rolls-Royce': 55, Kia: 52, Hyundai: 50, Mazda: 50,
  Volkswagen: 50, Mini: 50, Suzuki: 50, Skoda: 48, BMW: 48, BYD: 48, Honda: 48, Volvo: 47, Audi: 46,
  'Mercedes-Benz': 45, MG: 45, Genesis: 45, Nissan: 45, Ford: 45, Cupra: 45, LDV: 45, Zeekr: 42, Geely: 42,
  GWM: 42, KGM: 42, Polestar: 42, Renault: 42, Peugeot: 42, Smart: 40, XPeng: 40, Leapmotor: 40, Chery: 40,
  Jaecoo: 40, Deepal: 40, Denza: 40, Cadillac: 40, 'Alfa Romeo': 40, Farizon: 40, GAC: 38, Lotus: 38, Forthing: 35
};

export function estimateDepreciation(v) {
  let retained = BRAND_RETAINED_3Y[v.make] ?? 42;
  const notes = [`brand baseline ${retained}%`];
  const price = v.priceAud || 0;
  if (price > 150000) { retained -= 5; notes.push('price > $150k: -5'); }
  else if (price > 100000) { retained -= 3; notes.push('price > $100k: -3'); }
  if (['Van', 'Ute'].includes(v.bodyType)) { retained += 4; notes.push('commercial demand: +4'); }
  if (v.rangeKm >= 550) { retained += 2; notes.push('range >= 550 km: +2'); }
  if (v.rangeKm && v.rangeKm < 300) { retained -= 3; notes.push('range < 300 km: -3'); }
  if (v.battery?.chemistry === 'LFP') { retained += 1; notes.push('LFP longevity: +1'); }
  if (v.charging?.dcKw && v.charging.dcKw < 80) { retained -= 2; notes.push('slow DC (< 80 kW): -2'); }
  retained = Math.max(30, Math.min(70, retained));
  const retained5y = Math.round(retained * 0.72);
  return {
    retained3yPct: retained,
    retained5yPct: retained5y,
    value3yAud: price ? Math.round((price * retained) / 100) : null,
    lossPerYearAud: price ? Math.round((price * (100 - retained)) / 100 / 3) : null,
    method: 'estimate',
    notes
  };
}

/** Links to independent reviews and the ANCAP record (search links, so they never go stale). */
export function reviewLinks(make, model) {
  const q = encodeURIComponent(`${make} ${model}`);
  const g = (site) => `https://www.google.com/search?q=${encodeURIComponent(`site:${site} ${make} ${model} review`)}`;
  return [
    { label: 'CarExpert', url: g('carexpert.com.au') },
    { label: 'Drive', url: g('drive.com.au') },
    { label: 'WhichCar', url: g('whichcar.com.au') },
    { label: 'CarsGuide', url: g('carsguide.com.au') },
    { label: 'EV Central', url: g('evcentral.com.au') },
    { label: 'YouTube reviews', url: `https://www.youtube.com/results?search_query=${q}+review+australia` },
    { label: 'ANCAP safety', url: `https://www.google.com/search?q=${encodeURIComponent(`site:ancap.com.au ${make} ${model}`)}` }
  ];
}
