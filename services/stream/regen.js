/**
 * Regeneration model — computes fatigue, elasticity, crystallization
 * from D events over multi-day windows.
 */

export function computeRegeneration(deyEvents, windowDays = 7) {
  if (deyEvents.length === 0) return { fatigue: 0, elasticity: 0.5, crystallization: {} };

  // Fatigue: rolling average of intensity over the window
  const intensities = deyEvents.map(e => e.ctx?.intensity || 0);
  const avgIntensity = intensities.reduce((s, v) => s + v, 0) / intensities.length;
  const fatigue = Math.min(avgIntensity * 1.5, 1); // Scale up slightly

  // Elasticity: how quickly intensity drops after peaks
  // Find peaks (i > 0.7) and measure decay rate after them
  let elasticity = 0.5;
  const peaks = [];
  for (let i = 1; i < intensities.length - 1; i++) {
    if (intensities[i] > 0.7 && intensities[i] > intensities[i-1] && intensities[i] > intensities[i+1]) {
      peaks.push(i);
    }
  }
  if (peaks.length > 0) {
    let totalDecay = 0;
    for (const peakIdx of peaks) {
      // Measure how many samples until intensity drops below 0.4
      let decay = 0;
      for (let j = peakIdx + 1; j < intensities.length && intensities[j] > 0.4; j++) {
        decay++;
      }
      totalDecay += decay;
    }
    const avgDecay = totalDecay / peaks.length;
    // Faster decay = higher elasticity (recovers quickly)
    elasticity = Math.max(0, Math.min(1, 1 - (avgDecay / 20)));
  }

  // Crystallization: per-project consistency (how often same project appears in sustained blocks)
  const projCounts = {};
  for (const e of deyEvents) {
    const proj = e.ctx?.proj || e.ctx?.prof || 'general';
    projCounts[proj] = (projCounts[proj] || 0) + 1;
  }
  const total = deyEvents.length;
  const crystallization = {};
  for (const [proj, count] of Object.entries(projCounts)) {
    crystallization[proj] = Math.round((count / total) * 100) / 100;
  }

  return { fatigue: Math.round(fatigue * 100) / 100, elasticity: Math.round(elasticity * 100) / 100, crystallization };
}
