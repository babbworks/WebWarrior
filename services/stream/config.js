// Stream configuration management — persisted in profile_meta via IndexedDB

import { getMeta, setMeta } from '../../storage/db.js';

/**
 * Default StreamConfig values.
 */
export const DEFAULTS = Object.freeze({
  snapshot_events: 1000,
  snapshot_minutes: 30,
  dey_interval: 60,
  gap_threshold: 300,
  precision: 'seconds',
  dey_weights: Object.freeze({
    command_freq:      Object.freeze({ i: 0.3, s: 0.0, f: 0.0 }),
    task_transitions:  Object.freeze({ i: 0.2, s: -0.3, f: 0.3 }),
    dwell_time:        Object.freeze({ i: 0.0, s: 0.4, f: -0.2 }),
    entropy:           Object.freeze({ i: 0.0, s: -0.2, f: 0.4 }),
    journal_freq:      Object.freeze({ i: 0.1, s: 0.1, f: 0.0 }),
    list_rate:         Object.freeze({ i: 0.1, s: 0.0, f: 0.1 }),
    idle_gap:          Object.freeze({ i: -0.3, s: 0.0, f: 0.0 }),
    session_length:    Object.freeze({ i: 0.1, s: 0.2, f: 0.0 }),
    creation_rate:     Object.freeze({ i: 0.1, s: 0.0, f: 0.1 }),
    urgency_spread:    Object.freeze({ i: 0.0, s: -0.1, f: 0.2 }),
    nav_entropy:       Object.freeze({ i: 0.0, s: -0.1, f: 0.1 }),
  }),
  dey_windows: Object.freeze({ i: 60, s: 300, f: 300 }),
  dey_sources: Object.freeze([
    'command_freq', 'task_transitions', 'dwell_time', 'entropy',
    'journal_freq', 'list_rate', 'idle_gap', 'session_length',
    'creation_rate', 'urgency_spread', 'nav_entropy',
  ]),
  zero_activity_mode: 'suppress',
});

/**
 * Deep merges source into target for plain objects. Arrays and primitives
 * are replaced outright; only nested plain objects are recursively merged.
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal !== null && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal !== null && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * Loads stream configuration for a profile.
 * Merges stored config with DEFAULTS so new fields are always present.
 * @param {string} profile
 * @returns {Promise<Object>}
 */
export async function getConfig(profile) {
  const stored = await getMeta(profile, 'stream_config');
  if (!stored) return { ...DEFAULTS, dey_weights: { ...DEFAULTS.dey_weights }, dey_windows: { ...DEFAULTS.dey_windows }, dey_sources: [...DEFAULTS.dey_sources] };
  return deepMerge(DEFAULTS, stored);
}

/**
 * Saves stream configuration updates for a profile.
 * Merges updates into existing config and persists the result.
 * @param {string} profile
 * @param {Object} updates - Partial StreamConfig fields to update
 * @returns {Promise<Object>} The merged config after save
 */
export async function setConfig(profile, updates) {
  const current = await getConfig(profile);
  const merged = deepMerge(current, updates);
  await setMeta(profile, 'stream_config', merged);
  return merged;
}

/**
 * Checks if stream is enabled for a profile.
 * @param {string} profile
 * @returns {Promise<boolean>}
 */
export async function isEnabled(profile) {
  const val = await getMeta(profile, 'stream_enabled');
  return val === true;
}

/**
 * Enables or disables stream for a profile.
 * @param {string} profile
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setEnabled(profile, enabled) {
  await setMeta(profile, 'stream_enabled', !!enabled);
}
