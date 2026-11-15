const LCT_EV_THRESHOLD_AUD = 91387;
const ATO_5YR_RESIDUAL_RATE = 0.2813;

export function enrichWithLeaseAndScore(vehicle, requireTowing = true) {
  const effectivePrice = vehicle.demoDriveAwayPrice || vehicle.nswDriveAwayPrice;
  const fbtExempt = effectivePrice <= LCT_EV_THRESHOLD_AUD;
  const year5BalloonAud = Math.round(effectivePrice * ATO_5YR_RESIDUAL_RATE);

  // 1. Resale & Lease Economics (25%)
  let resaleScore = effectivePrice <= 55000 ? 9.0 : effectivePrice <= 77000 ? 8.0 : 6.5;
  if (['Toyota', 'Tesla'].includes(vehicle.make)) resaleScore = Math.min(10, resaleScore + 1.0);
  if (!fbtExempt) resaleScore = 2.0;

  // 2. Practicality, Towing & Utility (20%)
  let practicalityScore = 6.0;
  if (requireTowing && vehicle.towballDownloadKg === 0) {
    practicalityScore = 1.0;
  } else {
    if (vehicle.towballDownloadKg >= 150) practicalityScore += 2.0;
    else if (vehicle.towballDownloadKg >= 100) practicalityScore += 1.0;

    const totalCargo = (vehicle.bootLitres || 0) + (vehicle.frunkLitres || 0);
    if (totalCargo >= 600) practicalityScore += 1.5;
    else if (totalCargo >= 500) practicalityScore += 0.5;

    if (vehicle.groundClearanceMm >= 200) practicalityScore += 0.5;
  }
  practicalityScore = Math.min(10, practicalityScore);

  // 3. Range & Charging (15%)
  let rangeScore = vehicle.wltpRangeKm >= 580 ? 9.5 : vehicle.wltpRangeKm >= 480 ? 8.0 : 6.5;
  if (vehicle.maxDcKw >= 200 || vehicle.maxAcKw >= 22) rangeScore = Math.min(10, rangeScore + 0.5);

  // 4. Driver Comfort & Ergonomics (15%)
  let comfortScore = 6.5;
  if (vehicle.features?.ventilatedFrontSeats) comfortScore += 1.5;
  if (vehicle.features?.massagingSeats) comfortScore += 1.0;
  if (vehicle.features?.headUpDisplay) comfortScore += 0.5;
  if (vehicle.features?.wirelessCarPlay) comfortScore += 0.5;
  comfortScore = Math.min(10, comfortScore);

  // 5. Running Costs (10%)
  const runningScore = vehicle.wheelSizeInch <= 19 ? 8.5 : 7.5;

  // 6. Performance & Drivetrain (10%)
  let perfScore = vehicle.drivetrain === 'AWD' ? 8.5 : 6.0;
  if (vehicle.zeroToHundredSec <= 4.6) perfScore += 0.5;
  if (vehicle.features?.offRoadMode) perfScore += 0.5;
  perfScore = Math.min(10, perfScore);

  // 7. Delivery Readiness (5%)
  const deliveryScore = vehicle.demoDriveAwayPrice ? 9.0 : 7.5;

  const totalScore = Number(
    (
      resaleScore * 2.5 +
      practicalityScore * 2.0 +
      rangeScore * 1.5 +
      comfortScore * 1.5 +
      runningScore * 1.0 +
      perfScore * 1.0 +
      deliveryScore * 0.5
    ).toFixed(1)
  );

  return {
    ...vehicle,
    novatedLease: {
      effectivePriceAud: effectivePrice,
      fbtExempt,
      year5ResidualPercent: 28.13,
      year5BalloonAud
    },
    evaluation: {
      totalScoreOutOf100: totalScore,
      breakdown: {
        resaleAndLease: resaleScore,
        practicalityAndTowing: practicalityScore,
        rangeAndCharging: rangeScore,
        comfortAndErgonomics: comfortScore,
        runningCosts: runningScore,
        performanceAndDrivetrain: perfScore,
        deliveryReadiness: deliveryScore
      }
    }
  };
}