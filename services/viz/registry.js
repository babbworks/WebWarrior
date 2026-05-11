/**
 * Viz Gallery — Composition Registry
 *
 * Defines the 10-axis composition model: 3 Primary Axes and 7 Modifier Axes.
 * Provides axis definitions, constants, incompatibility rules, and
 * auto-granularity resolution.
 */

// --- Primary Axes (Tier 1) ---

export const PRIMARY_AXES = {
  layout: { options: ['timeline', 'grid', 'radial', 'waterfall', 'swim-lanes', 'field'] },
  renderer: { options: ['bars', 'glyphs', 'characters', 'blocks', 'sparkline'] },
  binding: { options: ['intensity', 'stability', 'fragmentation', 'op-code', 'project', 'duration'] },
};

// --- Modifier Axes (Tier 2) with defaults ---

export const MODIFIER_AXES = {
  granularity: { options: ['auto', '1min', '5min', '15min', '1hr', '4hr', '1day'], default: 'auto' },
  aggregation: { options: ['count', 'max', 'mean', 'mode', 'entropy'], default: 'count' },
  texture: { options: ['solid', 'hatched', 'dotted', 'scattered'], default: 'solid' },
  color: { options: ['monochrome', 'op-coded', 'project-coded', 'intensity-gradient'], default: 'monochrome' },
  annotation: { options: ['none', 'sparse', 'dense', 'narrative'], default: 'sparse' },
  normalization: { options: ['relative', 'absolute'], default: 'relative' },
  density: { options: ['compact', 'normal', 'relaxed'], default: 'normal' },
};

// --- Binding dimensions available for primary, texture, and color channels ---

export const BINDING_DIMENSIONS = ['intensity', 'stability', 'fragmentation', 'op-code', 'project', 'duration'];

// --- Layouts that support an orientation sub-property (horizontal/vertical) ---

export const ORIENTABLE_LAYOUTS = ['timeline', 'waterfall', 'swim-lanes'];

// --- Incompatible layout-renderer pairs ---

export const INCOMPATIBLE_PAIRS = [
  { layout: 'radial', renderer: 'sparkline', reason: 'Sparkline requires continuous x-axis; radial is angular' },
  { layout: 'grid', renderer: 'sparkline', reason: 'Sparkline requires continuous x-axis; grid is discrete cells' },
  { layout: 'field', renderer: 'sparkline', reason: 'Sparkline requires ordered x-axis; field is 2D scatter' },
];

// --- Granularity to seconds mapping ---

export const GRANULARITY_SECONDS = {
  '1min': 60,
  '5min': 300,
  '15min': 900,
  '1hr': 3600,
  '4hr': 14400,
  '1day': 86400,
};

// --- Auto-granularity resolution ---

/**
 * Resolves the "auto" granularity setting to a concrete granularity value
 * based on the active time range duration.
 *
 * Thresholds:
 *   < 4h (14400s)  → '5min'
 *   < 24h (86400s) → '15min'
 *   < 7d (604800s) → '1hr'
 *   >= 7d          → '4hr'
 *
 * @param {number} timeRangeSeconds - Duration of the active time range in seconds
 * @returns {string} Resolved granularity value
 */
export function resolveAutoGranularity(timeRangeSeconds) {
  if (timeRangeSeconds < 14400) return '5min';
  if (timeRangeSeconds < 86400) return '15min';
  if (timeRangeSeconds < 604800) return '1hr';
  return '4hr';
}

// --- Composition Validation ---

/**
 * Validates a layout-renderer combination against INCOMPATIBLE_PAIRS.
 * @param {string} layout
 * @param {string} renderer
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateCombination(layout, renderer) {
  const pair = INCOMPATIBLE_PAIRS.find(p => p.layout === layout && p.renderer === renderer);
  if (pair) return { valid: false, reason: pair.reason };
  return { valid: true };
}

/**
 * Returns all valid layout-renderer pairs (excluding incompatible ones).
 * @returns {Array<{layout: string, renderer: string}>}
 */
export function listValidCombinations() {
  const combos = [];
  for (const layout of PRIMARY_AXES.layout.options) {
    for (const renderer of PRIMARY_AXES.renderer.options) {
      if (validateCombination(layout, renderer).valid) {
        combos.push({ layout, renderer });
      }
    }
  }
  return combos;
}

// --- Smart Defaults ---

/**
 * Applies smart defaults to a partial composition, filling missing modifiers.
 * @param {Object} partial - Partial composition (may be missing modifier axes)
 * @param {number|null} timeRange - Time range in seconds (for auto-granularity resolution)
 * @returns {Object} Complete Composition object with all axes populated
 */
export function applySmartDefaults(partial, timeRange = null) {
  const composition = { ...partial };

  // Fill missing modifiers with defaults
  for (const [axis, def] of Object.entries(MODIFIER_AXES)) {
    if (composition[axis] === undefined || composition[axis] === null) {
      composition[axis] = def.default;
    }
  }

  // Fill missing secondary bindings
  if (composition.textureBind === undefined) composition.textureBind = null;
  if (composition.colorBind === undefined) composition.colorBind = null;

  // Fill missing interactivity
  if (composition.interactivity === undefined) composition.interactivity = 'inspect';

  // Fill missing orientation
  if (composition.orientation === undefined) {
    composition.orientation = ORIENTABLE_LAYOUTS.includes(composition.layout) ? 'horizontal' : null;
  }

  return composition;
}

// --- Composition Creation ---

/**
 * Creates a complete Composition object from axis values.
 * Validates all values and checks for incompatible combinations.
 * @param {Object} axes - Object with axis values (at minimum: layout, renderer, binding)
 * @returns {Object|{error: string}} Complete Composition or error
 */
export function createComposition(axes) {
  // Validate required primary axes
  if (!axes.layout || !PRIMARY_AXES.layout.options.includes(axes.layout)) {
    return { error: `Invalid layout "${axes.layout}": must be one of ${PRIMARY_AXES.layout.options.join(', ')}` };
  }
  if (!axes.renderer || !PRIMARY_AXES.renderer.options.includes(axes.renderer)) {
    return { error: `Invalid renderer "${axes.renderer}": must be one of ${PRIMARY_AXES.renderer.options.join(', ')}` };
  }
  if (!axes.binding || !PRIMARY_AXES.binding.options.includes(axes.binding)) {
    return { error: `Invalid binding "${axes.binding}": must be one of ${PRIMARY_AXES.binding.options.join(', ')}` };
  }

  // Check compatibility
  const compat = validateCombination(axes.layout, axes.renderer);
  if (!compat.valid) {
    return { error: `Incompatible combination: ${axes.layout} + ${axes.renderer} — ${compat.reason}` };
  }

  // Validate modifier values if provided
  for (const [axis, def] of Object.entries(MODIFIER_AXES)) {
    if (axes[axis] !== undefined && axes[axis] !== null && !def.options.includes(axes[axis])) {
      return { error: `Invalid ${axis} "${axes[axis]}": must be one of ${def.options.join(', ')}` };
    }
  }

  // Validate orientation if provided
  if (axes.orientation !== undefined && axes.orientation !== null) {
    if (!['horizontal', 'vertical'].includes(axes.orientation)) {
      return { error: `Invalid orientation "${axes.orientation}": must be 'horizontal' or 'vertical'` };
    }
    if (!ORIENTABLE_LAYOUTS.includes(axes.layout)) {
      return { error: `Layout "${axes.layout}" does not support orientation` };
    }
  }

  // Validate secondary bindings if provided
  if (axes.textureBind && !BINDING_DIMENSIONS.includes(axes.textureBind)) {
    return { error: `Invalid textureBind "${axes.textureBind}": must be one of ${BINDING_DIMENSIONS.join(', ')}` };
  }
  if (axes.colorBind && !BINDING_DIMENSIONS.includes(axes.colorBind)) {
    return { error: `Invalid colorBind "${axes.colorBind}": must be one of ${BINDING_DIMENSIONS.join(', ')}` };
  }

  // Validate interactivity if provided
  if (axes.interactivity && !['static', 'inspect', 'drill'].includes(axes.interactivity)) {
    return { error: `Invalid interactivity "${axes.interactivity}": must be 'static', 'inspect', or 'drill'` };
  }

  // Apply smart defaults and return
  return applySmartDefaults(axes);
}

// --- Serialization ---

/**
 * Serializes a Composition object to a compact string format.
 * Format: {layout}[:{orientation}]:{renderer}:{binding}[;{key}={value}]*
 * Only includes modifiers that differ from smart defaults.
 * @param {Object} composition - Complete Composition object
 * @returns {string}
 */
export function serialize(composition) {
  // Build the primary part: layout[:orientation]:renderer:binding
  const parts = [composition.layout];
  if (composition.orientation && ORIENTABLE_LAYOUTS.includes(composition.layout)) {
    parts.push(composition.orientation);
  }
  parts.push(composition.renderer);
  parts.push(composition.binding);

  let str = parts.join(':');

  // Append modifiers that differ from defaults
  const modifiers = [];
  for (const [axis, def] of Object.entries(MODIFIER_AXES)) {
    if (composition[axis] !== undefined && composition[axis] !== def.default) {
      modifiers.push(`${axis}=${composition[axis]}`);
    }
  }

  // Append secondary bindings if set
  if (composition.textureBind) {
    modifiers.push(`texture_bind=${composition.textureBind}`);
  }
  if (composition.colorBind) {
    modifiers.push(`color_bind=${composition.colorBind}`);
  }

  // Append interactivity if not default
  if (composition.interactivity && composition.interactivity !== 'inspect') {
    modifiers.push(`interactivity=${composition.interactivity}`);
  }

  if (modifiers.length > 0) {
    str += ';' + modifiers.join(';');
  }

  return str;
}

/**
 * Deserializes a compact string back into a Composition object.
 * Applies smart defaults for omitted modifiers.
 * @param {string} str - Serialized composition string
 * @returns {Object|{error: string}} Composition object or error
 */
export function deserialize(str) {
  if (!str || typeof str !== 'string') {
    return { error: 'Input must be a non-empty string' };
  }

  // Split into primary part and modifiers
  const [primaryPart, ...modifierParts] = str.split(';');

  // Parse primary: layout[:orientation]:renderer:binding
  const primaryTokens = primaryPart.split(':');

  if (primaryTokens.length < 3 || primaryTokens.length > 4) {
    return { error: `Invalid primary format: expected 3-4 colon-separated tokens, got ${primaryTokens.length}` };
  }

  let layout, orientation, renderer, binding;

  if (primaryTokens.length === 4) {
    // Has orientation: layout:orientation:renderer:binding
    [layout, orientation, renderer, binding] = primaryTokens;
  } else {
    // No orientation: layout:renderer:binding
    [layout, renderer, binding] = primaryTokens;
    orientation = undefined;
  }

  // Build partial composition from primary axes
  const partial = { layout, renderer, binding };
  if (orientation) partial.orientation = orientation;

  // Parse modifier key=value pairs
  const modifierStr = modifierParts.join(';');
  if (modifierStr) {
    const pairs = modifierStr.split(';').filter(Boolean);
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) {
        return { error: `Invalid modifier format "${pair}": expected key=value` };
      }
      const key = pair.slice(0, eqIdx);
      const value = pair.slice(eqIdx + 1);

      if (key === 'texture_bind') {
        partial.textureBind = value;
      } else if (key === 'color_bind') {
        partial.colorBind = value;
      } else if (key === 'interactivity') {
        partial.interactivity = value;
      } else if (MODIFIER_AXES[key]) {
        partial[key] = value;
      } else {
        return { error: `Unrecognized modifier key "${key}"` };
      }
    }
  }

  // Validate and create full composition with smart defaults
  return createComposition(partial);
}

// --- Curated Compositions ---

/**
 * The 12 curated starter compositions.
 * Classic cards have composition: null and a legacy property indicating
 * they delegate to the existing renderLens() pipeline.
 */
const CURATED_COMPOSITIONS = [
  { name: 'Dey Timeline', description: 'Intensity bars along a time axis with behavioral annotations', composition: { layout: 'timeline', renderer: 'bars', binding: 'intensity' } },
  { name: 'Activity Grid', description: 'Time × activity type matrix using glyphs to show what kind of work happened when', composition: { layout: 'grid', renderer: 'glyphs', binding: 'op-code' } },
  { name: 'Session Blocks', description: 'Work intervals as textured blocks showing fragmentation level', composition: { layout: 'waterfall', renderer: 'blocks', binding: 'fragmentation' } },
  { name: 'Intensity Waterfall', description: 'Stacked rows showing intensity building up and decaying over time', composition: { layout: 'waterfall', renderer: 'bars', binding: 'intensity' } },
  { name: 'Frick+Dey Composite', description: 'Swim lanes showing state transitions by op-code category', composition: { layout: 'swim-lanes', renderer: 'blocks', binding: 'op-code' } },
  { name: 'Cooper Glyph Clock', description: 'Polar clock face with glyphs showing activity type by time of day', composition: { layout: 'radial', renderer: 'glyphs', binding: 'op-code' } },
  { name: 'Decay Cascade', description: 'Intensity bars with fragmentation encoded as texture pattern', composition: { layout: 'waterfall', renderer: 'bars', binding: 'intensity', textureBind: 'fragmentation' } },
  { name: 'Op-Code Field Dense', description: 'Dense 2D character field showing op-code distribution spatially', composition: { layout: 'field', renderer: 'characters', binding: 'op-code', density: 'compact' } },
  { name: 'Op-Code Field Sparse', description: 'Relaxed 2D character field showing op-code distribution with spacing', composition: { layout: 'field', renderer: 'characters', binding: 'op-code', density: 'relaxed' } },
  { name: 'Phase Lanes', description: 'Horizontal lanes per category with duration-sized blocks and op-code colors', composition: { layout: 'swim-lanes', renderer: 'blocks', binding: 'duration', color: 'op-coded', colorBind: 'op-code' } },
  { name: 'Burroughs Classic', description: 'Raw chronological event table (legacy lens)', composition: null, legacy: 'burroughs' },
  { name: 'Cooper Classic', description: 'Polar geometric field visualization (legacy lens)', composition: null, legacy: 'cooper' },
];

/**
 * Returns the 12 curated starter compositions.
 * Classic cards have composition: null and a legacy property.
 * Non-classic cards have their partial composition expanded via createComposition()
 * to fill in all smart defaults.
 * @returns {Array<{name: string, description: string, composition: Object|null, legacy?: string}>}
 */
export function getCuratedCompositions() {
  return CURATED_COMPOSITIONS.map(c => {
    if (c.legacy) {
      return { name: c.name, description: c.description, composition: null, legacy: c.legacy };
    }
    // Apply smart defaults to each curated composition
    const full = createComposition(c.composition);
    if (full.error) {
      // Should never happen for curated compositions, but handle gracefully
      return { name: c.name, description: c.description, composition: null, error: full.error };
    }
    return { name: c.name, description: c.description, composition: full };
  });
}

/**
 * Maps an existing lens name to its corresponding composition.
 * Covers all 6 existing lenses: burroughs, bundy, frick, felt, dey, cooper.
 * @param {string} lensName - 'burroughs'|'bundy'|'frick'|'felt'|'dey'|'cooper'
 * @returns {Object|null} Composition object or null if not mappable
 */
export function getLensMapping(lensName) {
  const mappings = {
    burroughs: { layout: 'timeline', renderer: 'bars', binding: 'op-code' },
    bundy: { layout: 'timeline', renderer: 'bars', binding: 'duration' },
    frick: { layout: 'timeline', renderer: 'blocks', binding: 'op-code' },
    felt: { layout: 'grid', renderer: 'blocks', binding: 'intensity', color: 'intensity-gradient' },
    dey: { layout: 'timeline', renderer: 'sparkline', binding: 'intensity' },
    cooper: { layout: 'radial', renderer: 'glyphs', binding: 'intensity' },
  };

  const partial = mappings[lensName];
  if (!partial) return null;
  return createComposition(partial);
}
