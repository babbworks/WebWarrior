/**
 * Viz Gallery — Annotation System
 *
 * Detects patterns in normalized data and overlays labels on visualizations.
 * Supports four annotation levels: none, sparse, dense, narrative.
 *
 * Pattern detectors:
 * - Deep work: intensity > 0.7 for 3+ consecutive samples
 * - Breaks: gaps ≥ 15 minutes (900s) between consecutive timestamps
 * - Context switch: fragmentation increasing by 0.3+ within 2 consecutive samples
 * - Energy decline: intensity decreasing monotonically over 4+ samples by total ≥ 0.4
 *
 * Sparse level: deep work + breaks only.
 * Dense level: all four patterns.
 * None: empty array.
 * Narrative: dense + prose summary below the viz.
 */

// --- Pattern Detection ---

/**
 * Detects sustained deep work phases: primary > 0.7 for 3+ consecutive samples.
 *
 * @param {Array<{ts: number, primary: number}>} points - Normalized data points
 * @returns {Array<{type: string, label: string, startIdx: number, endIdx: number}>}
 */
export function detectDeepWork(points) {
  const annotations = [];
  if (!points || points.length < 3) return annotations;

  let runStart = -1;

  for (let i = 0; i < points.length; i++) {
    if (points[i].primary > 0.7) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1 && (i - runStart) >= 3) {
        annotations.push({
          type: 'deep-work',
          label: '(deep work phase)',
          startIdx: runStart,
          endIdx: i - 1,
        });
      }
      runStart = -1;
    }
  }

  // Handle run that extends to the end
  if (runStart !== -1 && (points.length - runStart) >= 3) {
    annotations.push({
      type: 'deep-work',
      label: '(deep work phase)',
      startIdx: runStart,
      endIdx: points.length - 1,
    });
  }

  return annotations;
}

/**
 * Detects breaks/recovery periods: gaps ≥ 15 minutes (900 seconds) between consecutive timestamps.
 *
 * @param {Array<{ts: number}>} points - Normalized data points with timestamps
 * @returns {Array<{type: string, label: string, startIdx: number, endIdx: number}>}
 */
export function detectBreaks(points) {
  const annotations = [];
  if (!points || points.length < 2) return annotations;

  for (let i = 0; i < points.length - 1; i++) {
    const gap = points[i + 1].ts - points[i].ts;
    if (gap >= 900) {
      annotations.push({
        type: 'break',
        label: '(break / recovery)',
        startIdx: i,
        endIdx: i + 1,
      });
    }
  }

  return annotations;
}

/**
 * Detects context switch pressure: fragmentation (texture or primary) increasing
 * by more than 0.3 within 2 consecutive samples.
 *
 * @param {Array<{ts: number, primary: number, texture?: number}>} points - Normalized data points
 * @returns {Array<{type: string, label: string, startIdx: number, endIdx: number}>}
 */
export function detectContextSwitch(points) {
  const annotations = [];
  if (!points || points.length < 2) return annotations;

  for (let i = 0; i < points.length - 1; i++) {
    // Use texture channel if available (when textureBind is fragmentation),
    // otherwise fall back to primary
    const current = points[i].texture != null ? points[i].texture : points[i].primary;
    const next = points[i + 1].texture != null ? points[i + 1].texture : points[i + 1].primary;
    const increase = next - current;

    if (increase > 0.3) {
      annotations.push({
        type: 'context-switch',
        label: '(context switch pressure)',
        startIdx: i,
        endIdx: i + 1,
      });
    }
  }

  return annotations;
}

/**
 * Detects energy decline: intensity (primary) decreasing monotonically
 * over 4+ samples with total drop ≥ 0.4.
 *
 * @param {Array<{ts: number, primary: number}>} points - Normalized data points
 * @returns {Array<{type: string, label: string, startIdx: number, endIdx: number}>}
 */
export function detectEnergyDecline(points) {
  const annotations = [];
  if (!points || points.length < 4) return annotations;

  let runStart = 0;

  for (let i = 1; i < points.length; i++) {
    if (points[i].primary < points[i - 1].primary) {
      // Still decreasing — continue the run
    } else {
      // Run broken — check if it qualifies
      const runLength = i - runStart;
      if (runLength >= 4) {
        const totalDrop = points[runStart].primary - points[i - 1].primary;
        if (totalDrop >= 0.4) {
          annotations.push({
            type: 'energy-decline',
            label: '(energy decline)',
            startIdx: runStart,
            endIdx: i - 1,
          });
        }
      }
      runStart = i;
    }
  }

  // Handle run that extends to the end
  const runLength = points.length - runStart;
  if (runLength >= 4) {
    const totalDrop = points[runStart].primary - points[points.length - 1].primary;
    if (totalDrop >= 0.4) {
      annotations.push({
        type: 'energy-decline',
        label: '(energy decline)',
        startIdx: runStart,
        endIdx: points.length - 1,
      });
    }
  }

  return annotations;
}

/**
 * Dispatches to individual pattern detectors based on annotation level.
 *
 * - 'none': returns empty array
 * - 'sparse': deep work + breaks only
 * - 'dense': all four patterns (deep work, breaks, context switch, energy decline)
 * - 'narrative': same as dense (narrative prose is generated separately)
 *
 * @param {{points: Array<{ts: number, primary: number, texture?: number, color?: number, raw: Object}>}} normalizedData
 * @param {string} level - 'none'|'sparse'|'dense'|'narrative'
 * @returns {Array<{type: string, label: string, startIdx: number, endIdx: number}>}
 */
export function detectPatterns(normalizedData, level) {
  if (!level || level === 'none') return [];

  const points = normalizedData.points || [];
  if (points.length === 0) return [];

  const annotations = [];

  // Sparse: deep work + breaks
  annotations.push(...detectDeepWork(points));
  annotations.push(...detectBreaks(points));

  // Dense and narrative: add context switch + energy decline
  if (level === 'dense' || level === 'narrative') {
    annotations.push(...detectContextSwitch(points));
    annotations.push(...detectEnergyDecline(points));
  }

  return annotations;
}

// --- Label Placement ---

/**
 * Positions annotation labels adjacent to their data regions without occluding data elements.
 * Each annotation is placed at the midpoint of its startIdx-endIdx range, offset above the data point.
 * Overlapping annotations are shifted vertically to avoid collision.
 *
 * @param {Array<{type: string, label: string, startIdx: number, endIdx: number}>} annotations
 * @param {{points: Array<{x: number, y: number}>, bounds: {width: number, height: number}}} positionedData
 * @param {{width: number, height: number}} bounds
 * @returns {Array<{type: string, label: string, startIdx: number, endIdx: number, position: {x: number, y: number}}>}
 */
export function placeLabels(annotations, positionedData, bounds) {
  if (!annotations || annotations.length === 0) return [];
  if (!positionedData || !positionedData.points || positionedData.points.length === 0) return [];

  const points = positionedData.points;
  const placed = [];
  const LABEL_OFFSET_Y = 15;
  const LABEL_SPACING = 14; // Vertical spacing between stacked labels

  for (const annotation of annotations) {
    // Compute midpoint index
    const midIdx = Math.floor((annotation.startIdx + annotation.endIdx) / 2);
    const clampedIdx = Math.min(Math.max(0, midIdx), points.length - 1);
    const refPoint = points[clampedIdx];

    // Base position: above the data point
    let x = refPoint.x;
    let y = refPoint.y - LABEL_OFFSET_Y;

    // Clamp within bounds
    x = Math.max(0, Math.min(x, bounds.width));
    y = Math.max(0, y);

    // Check for overlap with already-placed labels and shift vertically
    for (const existing of placed) {
      const dx = Math.abs(existing.position.x - x);
      const dy = Math.abs(existing.position.y - y);
      if (dx < 80 && dy < LABEL_SPACING) {
        y = existing.position.y - LABEL_SPACING;
        if (y < 0) y = 0;
      }
    }

    placed.push({
      ...annotation,
      position: { x, y },
    });
  }

  return placed;
}

// --- Narrative Generation ---

/**
 * Formats a timestamp as a time string (HH:MM).
 *
 * @param {number} ts - Unix timestamp in seconds
 * @returns {string}
 */
function formatTime(ts) {
  const d = new Date(ts * 1000);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Produces a prose summary describing detected patterns for narrative annotation level.
 * Generates 1-2 sentences summarizing the session arc.
 *
 * @param {Array<{type: string, label: string, startIdx: number, endIdx: number, position?: {x: number, y: number}}>} annotations
 * @param {{start: number, end: number}} timeRange - Start and end timestamps in seconds
 * @returns {string}
 */
export function generateNarrative(annotations, timeRange) {
  if (!annotations || annotations.length === 0) {
    return 'No notable patterns detected in this period.';
  }

  const phrases = [];

  for (const ann of annotations) {
    switch (ann.type) {
      case 'deep-work':
        phrases.push('a deep work phase');
        break;
      case 'break':
        phrases.push('a break/recovery period');
        break;
      case 'context-switch':
        phrases.push('context switching pressure');
        break;
      case 'energy-decline':
        phrases.push('energy decline');
        break;
    }
  }

  // Deduplicate similar phrases
  const unique = [...new Set(phrases)];

  if (unique.length === 0) {
    return 'No notable patterns detected in this period.';
  }

  const startTime = timeRange ? formatTime(timeRange.start) : '';
  const endTime = timeRange ? formatTime(timeRange.end) : '';
  const timeStr = startTime && endTime ? ` from ${startTime} to ${endTime}` : '';

  if (unique.length === 1) {
    return `This period${timeStr} shows ${unique[0]}.`;
  }

  const last = unique.pop();
  return `This period${timeStr} shows ${unique.join(', ')}, and ${last}.`;
}

// --- Overlay Rendering ---

/**
 * Main entry point called by the pipeline orchestrator.
 * Detects patterns, places labels, and renders annotation elements into the container.
 *
 * @param {HTMLElement} container - The visualization container element
 * @param {{points: Array<{x: number, y: number}>, bounds: {width: number, height: number}}} positionedData
 * @param {{points: Array<{ts: number, primary: number, texture?: number, color?: number, raw: Object}>}} normalizedData
 * @param {string} level - 'none'|'sparse'|'dense'|'narrative'
 * @param {Object} composition - The full composition object
 * @returns {void}
 */
export function overlayAnnotations(container, positionedData, normalizedData, level, composition) {
  if (!container || !level || level === 'none') return;

  // Step 1: Detect patterns
  const annotations = detectPatterns(normalizedData, level);
  if (annotations.length === 0 && level !== 'narrative') return;

  // Step 2: Place labels
  const bounds = positionedData.bounds || { width: container.clientWidth || 400, height: container.clientHeight || 300 };
  const placed = placeLabels(annotations, positionedData, bounds);

  // Step 3: Render annotation labels as positioned spans
  for (const ann of placed) {
    const span = document.createElement('span');
    span.className = 'viz-annotation';
    span.textContent = ann.label;
    span.style.position = 'absolute';
    span.style.left = `${ann.position.x}px`;
    span.style.top = `${ann.position.y}px`;
    span.style.color = 'var(--color-muted, #888)';
    span.style.fontSize = '0.75em';
    span.style.pointerEvents = 'none';
    span.style.whiteSpace = 'nowrap';
    container.appendChild(span);
  }

  // Step 4: If narrative level, generate and append prose summary below the viz
  if (level === 'narrative') {
    const timeRange = deriveTimeRange(normalizedData);
    const narrative = generateNarrative(placed, timeRange);

    const narrativeEl = document.createElement('p');
    narrativeEl.className = 'viz-annotation-narrative';
    narrativeEl.textContent = narrative;
    narrativeEl.style.color = 'var(--color-muted, #888)';
    narrativeEl.style.fontSize = '0.8em';
    narrativeEl.style.marginTop = '8px';
    narrativeEl.style.fontStyle = 'italic';
    container.appendChild(narrativeEl);
  }
}

/**
 * Derives a time range from normalized data points.
 *
 * @param {{points: Array<{ts: number}>}} normalizedData
 * @returns {{start: number, end: number}}
 */
function deriveTimeRange(normalizedData) {
  const points = normalizedData.points || [];
  if (points.length === 0) return { start: 0, end: 0 };
  return {
    start: points[0].ts,
    end: points[points.length - 1].ts,
  };
}
