/**
 * Novated lease estimator (Australia, FY2026-27). Browser + Node ES module.
 *
 * ESTIMATE ONLY — not financial or tax advice. Assumes an Australian resident
 * with no other salary sacrifice, HELP debt or Medicare levy surcharge.
 */

export const ASSUMPTIONS = {
  financialYear: '2026-27',
  // Resident rates from 1 July 2026 (second bracket cut to 15%).
  brackets: [
    { over: 190000, base: 51370, rate: 0.45 },
    { over: 135000, base: 31020, rate: 0.37 },
    { over: 45000, base: 4020, rate: 0.30 },
    { over: 18200, base: 0, rate: 0.15 }
  ],
  medicareRate: 0.02,
  // Car limit caps the GST credit the lessor can claim on the vehicle (FY2025-26 figure; confirm with ATO).
  carLimit: 69674,
  lctThreshold: 91387,
  // ATO minimum residual values by lease term (years).
  residualPct: { 1: 0.6563, 2: 0.5625, 3: 0.4688, 4: 0.375, 5: 0.2813 },
  statutoryFbtRate: 0.2
};

export function incomeTax(income) {
  const inc = Math.max(0, income);
  const b = ASSUMPTIONS.brackets.find((x) => inc > x.over);
  const tax = b ? b.base + (inc - b.over) * b.rate : 0;
  return Math.max(0, tax - lowIncomeOffset(inc));
}

export function lowIncomeOffset(income) {
  if (income <= 37500) return 700;
  if (income <= 45000) return 700 - (income - 37500) * 0.05;
  if (income <= 66667) return 325 - (income - 45000) * 0.015;
  return 0;
}

/** Total tax incl. Medicare levy (flat 2%, ignores low-income phase-in). */
export function totalTax(income) {
  return incomeTax(income) + Math.max(0, income) * ASSUMPTIONS.medicareRate;
}

export function marginalRate(income) {
  const b = ASSUMPTIONS.brackets.find((x) => income > x.over);
  return (b ? b.rate : 0) + ASSUMPTIONS.medicareRate;
}

/** Monthly repayment (in arrears) on `principal` with a `balloon` due at the end. */
export function payment(principal, balloon, annualRatePct, months) {
  const r = annualRatePct / 100 / 12;
  if (r === 0) return (principal - balloon) / months;
  return ((principal - balloon / (1 + r) ** months) * r) / (1 - (1 + r) ** -months);
}

/**
 * @param {object} p
 * @param {number} p.salary            Annual base salary (pre-tax)
 * @param {number} p.price             Vehicle drive-away price incl. GST
 * @param {number} p.termYears         1-5
 * @param {number} p.kmPerYear
 * @param {number} p.kwhPer100km       Vehicle efficiency
 * @param {number} [p.ratePct=8]       Finance interest rate
 * @param {number} [p.centsPerKwh=30]  Average charging cost
 * @param {number} [p.insurance=1800]  Per year, incl. GST
 * @param {number} [p.tyres=300]       Per year, incl. GST
 * @param {number} [p.servicing=300]   Per year, incl. GST
 * @param {number} [p.rego=900]        Per year (no GST)
 * @param {number} [p.adminFee=480]    Provider management fee per year, incl. GST
 * @param {boolean} [p.fbtExempt]      Defaults to price <= LCT threshold (BEV)
 */
export function novatedLease(p) {
  const a = ASSUMPTIONS;
  const term = Math.min(5, Math.max(1, Math.round(p.termYears || 5)));
  const months = term * 12;
  const ratePct = p.ratePct ?? 8;
  const price = Math.max(0, p.price || 0);
  const fbtExempt = p.fbtExempt ?? price <= a.lctThreshold;

  // Vehicle finance (lessor claims GST, capped at the car limit)
  const gstCredit = Math.min(price / 11, a.carLimit / 11);
  const financed = price - gstCredit;
  const residual = financed * a.residualPct[term];
  const monthly = payment(financed, residual, ratePct, months);
  const leaseAnnual = monthly * 12;

  // Running costs (bundled ones are claimed ex-GST through the lease)
  const electricity = ((p.kmPerYear || 15000) * (p.kwhPer100km || 16)) / 100 * ((p.centsPerKwh ?? 30) / 100);
  const gstInclusive = electricity + (p.insurance ?? 1800) + (p.tyres ?? 300) + (p.servicing ?? 300) + (p.adminFee ?? 480);
  const rego = p.rego ?? 900;
  const runningExGst = gstInclusive / 1.1 + rego;
  const runningInclGst = gstInclusive + rego;

  const packageExGst = leaseAnnual + runningExGst;

  // FBT treatment
  let postTax = 0;
  let preTax = packageExGst;
  if (!fbtExempt) {
    // Statutory formula + employee contribution method to reduce FBT to nil.
    postTax = price * a.statutoryFbtRate;
    preTax = Math.max(0, packageExGst - postTax / 1.1);
  }
  const salary = Math.max(0, p.salary || 0);
  const taxSaving = totalTax(salary) - totalTax(Math.max(0, salary - preTax));
  const netAnnual = preTax + postTax - taxSaving;

  // Comparison: same car on a personal loan from after-tax pay, same balloon share.
  const loanResidual = price * a.residualPct[term];
  const loanAnnual = payment(price, loanResidual, ratePct, months) * 12;
  const afterTaxAnnual = loanAnnual + runningInclGst;

  const round = (x) => Math.round(x);
  return {
    inputs: { salary, price, termYears: term, ratePct, kmPerYear: p.kmPerYear || 15000, fbtExempt },
    vehicle: { gstCredit: round(gstCredit), financed: round(financed), residual: round(residual), residualPct: a.residualPct[term], monthly: round(monthly) },
    running: { electricity: round(electricity), annualExGst: round(runningExGst), annualInclGst: round(runningInclGst) },
    annual: { preTax: round(preTax), postTax: round(postTax), taxSaving: round(taxSaving), net: round(netAnnual) },
    outOfPocket: { weekly: round(netAnnual / 52), fortnightly: round(netAnnual / 26), monthly: round(netAnnual / 12) },
    comparison: {
      afterTaxAnnual: round(afterTaxAnnual),
      afterTaxWeekly: round(afterTaxAnnual / 52),
      savingPerWeek: round((afterTaxAnnual - netAnnual) / 52),
      savingOverTerm: round((afterTaxAnnual - netAnnual) * term)
    },
    marginalRatePct: Math.round(marginalRate(salary) * 100),
    takeHomeBefore: round(salary - totalTax(salary)),
    takeHomeAfter: round(salary - preTax - postTax - totalTax(Math.max(0, salary - preTax)))
  };
}
