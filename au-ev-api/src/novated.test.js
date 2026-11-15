import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { incomeTax, totalTax, payment, novatedLease, ASSUMPTIONS } from '../public/js/novated.js';

describe('incomeTax (FY2026-27 resident)', () => {
  it('applies brackets and LITO', () => {
    assert.equal(incomeTax(18200), 0);
    // 45,000: 4,020 - LITO 325 = 3,695
    assert.equal(incomeTax(45000), 3695);
    // 100,000: 4,020 + 30% of 55,000 = 20,520 (no LITO)
    assert.equal(incomeTax(100000), 20520);
    // 200,000: 51,370 + 45% of 10,000 = 55,870
    assert.equal(incomeTax(200000), 55870);
  });

  it('adds a 2% Medicare levy', () => {
    assert.equal(totalTax(100000), 22520);
  });
});

describe('payment', () => {
  it('fully amortises with no balloon and zero interest', () => {
    assert.equal(payment(12000, 0, 0, 12), 1000);
  });
  it('leaves exactly the balloon outstanding', () => {
    const r = 0.08 / 12;
    const pmt = payment(50000, 14065, 8, 60);
    let bal = 50000;
    for (let i = 0; i < 60; i++) bal = bal * (1 + r) - pmt;
    assert.ok(Math.abs(bal - 14065) < 0.01);
  });
});

describe('novatedLease', () => {
  const base = { salary: 100000, price: 60000, termYears: 5, kmPerYear: 15000, kwhPer100km: 15 };

  it('treats a BEV under the LCT threshold as fully pre-tax (FBT exempt)', () => {
    const r = novatedLease(base);
    assert.equal(r.inputs.fbtExempt, true);
    assert.equal(r.annual.postTax, 0);
    assert.ok(r.annual.taxSaving > 0);
    // Saving must be roughly preTax x marginal rate (32%)
    assert.ok(Math.abs(r.annual.taxSaving - r.annual.preTax * 0.32) < 50);
    assert.equal(r.vehicle.residual, Math.round((60000 - 60000 / 11) * ASSUMPTIONS.residualPct[5]));
    assert.ok(r.outOfPocket.weekly > 0 && r.outOfPocket.weekly < r.comparison.afterTaxWeekly);
  });

  it('caps the GST credit at the car limit', () => {
    const r = novatedLease({ ...base, price: 90000 });
    assert.equal(r.vehicle.gstCredit, Math.round(ASSUMPTIONS.carLimit / 11));
  });

  it('uses a post-tax ECM contribution above the LCT threshold', () => {
    const r = novatedLease({ ...base, price: 120000 });
    assert.equal(r.inputs.fbtExempt, false);
    assert.equal(r.annual.postTax, 24000);
  });

  it('higher salaries save more per week', () => {
    const low = novatedLease({ ...base, salary: 60000 });
    const high = novatedLease({ ...base, salary: 200000 });
    assert.ok(high.outOfPocket.weekly < low.outOfPocket.weekly);
  });
});
