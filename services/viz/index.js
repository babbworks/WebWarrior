/**
 * Viz Service — State Management and Utility Functions
 *
 * Manages lens selection, time range, filters, rendering mode,
 * and provides utility functions for replay parameterization.
 */

import { replay } from '../stream/replay.js';
import { isEnabled } from '../stream/config.js';
import { renderLens, setAsciiMode } from '../stream/render.js';
import { getMeta, setMeta } from '../../storage/db.js';

// --- Module-scope state ---

const VizState = {
  activeLens: 'burroughs',
  timeRange: 'hour',
  customFrom: null,
  customTo: null,
  filters: {
    service: null,
    project: null,
    tags: []
  },
  asciiMode: false,
  lastResult: null
};

let initialized = false;
let presets = [];

// --- Service-to-op-code mapping ---

const SERVICE_OP_MAP = {
  tasks: 'T',
  bundy: 'B',
  frick: 'F',
  journal: 'A',
  lists: 'M',
  attributes: 'M',
  nav: 'M'
};

// --- Time range preset offsets (seconds) ---

const RANGE_OFFSETS = {
  hour: 3600,
  '4hours': 14400,
  day: 86400,
  week: 604800
};

/**
 * Resolves a time range preset to {from, to} unix timestamps.
 * @param {string} range - 'hour'|'4hours'|'day'|'week'|'all'|'custom'
 * @param {number|null} customFrom - Custom range start (unix seconds)
 * @param {number|null} customTo - Custom range end (unix seconds)
 * @returns {{from: number, to: number}}
 */
export function resolveTimeRange(range, customFrom, customTo) {
  const now = Math.floor(Date.now() / 1000);

  if (range === 'custom') {
    return {
      from: customFrom ?? 0,
      to: customTo ?? now
    };
  }

  if (range === 'all') {
    return { from: 0, to: now };
  }

  const offset = RANGE_OFFSETS[range];
  if (offset != null) {
    return { from: now - offset, to: now };
  }

  // Fallback to 'hour' if unknown range
  return { from: now - 3600, to: now };
}

/**
 * Builds the replay-compatible filter object from VizState filters.
 * Returns null if no filters are active.
 * @param {Object} filters - {service: string|null, project: string|null, tags: string[]}
 * @returns {Object|null} - {op, object, prof, proj, tags} or null
 */
export function buildReplayFilters(filters) {
  const op = filters.service ? (SERVICE_OP_MAP[filters.service] || null) : null;
  const proj = filters.project || null;
  const tags = (filters.tags && filters.tags.length > 0) ? filters.tags : null;

  // Return null if no filters are active
  if (op === null && proj === null && tags === null) {
    return null;
  }

  return {
    op,
    object: null,
    prof: null,
    proj,
    tags
  };
}

// --- Public state API ---

/**
 * Returns a copy of the current VizState.
 * @returns {Object}
 */
export function getState() {
  return {
    activeLens: VizState.activeLens,
    timeRange: VizState.timeRange,
    customFrom: VizState.customFrom,
    customTo: VizState.customTo,
    filters: {
      service: VizState.filters.service,
      project: VizState.filters.project,
      tags: [...VizState.filters.tags]
    },
    asciiMode: VizState.asciiMode,
    lastResult: VizState.lastResult
  };
}

/**
 * Sets the active lens.
 * @param {string} lens - Lens name
 */
export function setLens(lens) {
  VizState.activeLens = lens;
}

/**
 * Sets the time range preset.
 * @param {string} range - Preset key or 'custom'
 */
export function setTimeRange(range) {
  VizState.timeRange = range;
}

/**
 * Sets a custom time range.
 * @param {number} from - Start unix timestamp (seconds)
 * @param {number} to - End unix timestamp (seconds)
 */
export function setCustomRange(from, to) {
  VizState.customFrom = from;
  VizState.customTo = to;
  VizState.timeRange = 'custom';
}

/**
 * Adds a filter value.
 * @param {string} type - 'service'|'project'|'tags'
 * @param {string} value - Filter value
 */
export function addFilter(type, value) {
  if (type === 'tags') {
    if (!VizState.filters.tags.includes(value)) {
      VizState.filters.tags.push(value);
    }
  } else if (type === 'service' || type === 'project') {
    VizState.filters[type] = value;
  }
}

/**
 * Removes a filter value.
 * @param {string} type - 'service'|'project'|'tags'
 * @param {string} value - Filter value to remove
 */
export function removeFilter(type, value) {
  if (type === 'tags') {
    VizState.filters.tags = VizState.filters.tags.filter(t => t !== value);
  } else if (type === 'service' || type === 'project') {
    VizState.filters[type] = null;
  }
}

/**
 * Clears all filters.
 */
export function clearFilters() {
  VizState.filters.service = null;
  VizState.filters.project = null;
  VizState.filters.tags = [];
}

/**
 * Sets the rendering mode.
 * @param {boolean} ascii - true for ASCII mode, false for Canvas
 */
export function setMode(ascii) {
  VizState.asciiMode = !!ascii;
}

/**
 * Returns the lens card render target element.
 * @returns {HTMLElement|null}
 */
export function getContainer() {
  return document.querySelector('.viz-lens-card-body');
}

/**
 * Formats a time range from unix timestamps for display in the lens card meta.
 * Uses HH:MM–HH:MM for same-day ranges, MM/DD HH:MM–MM/DD HH:MM for multi-day.
 * @param {number} fromTs - Start unix timestamp (seconds)
 * @param {number} toTs - End unix timestamp (seconds)
 * @returns {string}
 */
export function formatMetaTimeRange(fromTs, toTs) {
  const fromDate = new Date(fromTs * 1000);
  const toDate = new Date(toTs * 1000);

  const sameDay = fromDate.getFullYear() === toDate.getFullYear()
    && fromDate.getMonth() === toDate.getMonth()
    && fromDate.getDate() === toDate.getDate();

  const timeOpts = { hour: '2-digit', minute: '2-digit', hour12: false };

  if (sameDay) {
    const fromTime = fromDate.toLocaleTimeString('en-GB', timeOpts);
    const toTime = toDate.toLocaleTimeString('en-GB', timeOpts);
    return `${fromTime}\u2013${toTime}`;
  }

  const dateTimeOpts = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
  const fromStr = fromDate.toLocaleString('en-GB', dateTimeOpts).replace(',', '');
  const toStr = toDate.toLocaleString('en-GB', dateTimeOpts).replace(',', '');
  return `${fromStr}\u2013${toStr}`;
}

/**
 * Builds the lens card DOM structure inside the given wrapper element.
 * @param {HTMLElement} wrapper - The viz-lens-card-wrapper element
 * @param {string} lensName - The active lens name
 * @param {Object} meta - Result meta: {eventCount, fromTs, toTs}
 * @returns {HTMLElement} The card body element for rendering into
 */
export function buildLensCard(wrapper, lensName, meta) {
  wrapper.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'viz-lens-card';

  // Header
  const header = document.createElement('div');
  header.className = 'viz-lens-card-header';

  const title = document.createElement('span');
  title.className = 'viz-lens-card-title';
  title.textContent = lensName.charAt(0).toUpperCase() + lensName.slice(1);

  const metaSpan = document.createElement('span');
  metaSpan.className = 'viz-lens-card-meta';
  const eventCount = meta && meta.eventCount != null ? meta.eventCount : 0;
  const timeRange = meta && meta.fromTs != null && meta.toTs != null
    ? formatMetaTimeRange(meta.fromTs, meta.toTs)
    : '';
  metaSpan.textContent = `${eventCount} events` + (timeRange ? ` \u00B7 ${timeRange}` : '');

  header.appendChild(title);
  header.appendChild(metaSpan);

  // Body
  const body = document.createElement('div');
  body.className = 'viz-lens-card-body';
  body.id = 'viz-lens-view';

  card.appendChild(header);
  card.appendChild(body);
  wrapper.appendChild(card);

  return body;
}

// --- Initialization and Computation ---

/**
 * Initializes the Viz service by loading persisted preferences from IndexedDB.
 * Only runs once per session (idempotent).
 * @param {string} profile
 * @returns {Promise<void>}
 */
export async function init(profile) {
  if (initialized) return;

  const savedLens = await getMeta(profile, 'viz_active_lens');
  if (savedLens) {
    VizState.activeLens = savedLens;
  }

  const savedAscii = await getMeta(profile, 'viz_ascii_mode');
  if (savedAscii != null) {
    VizState.asciiMode = !!savedAscii;
    setAsciiMode(VizState.asciiMode);
  }

  const savedPresets = await getMeta(profile, 'viz_presets');
  if (Array.isArray(savedPresets)) {
    presets = savedPresets;
  }

  initialized = true;
}

/**
 * Computes and renders the active lens visualization.
 * Checks if Stream is enabled, resolves time range, builds filters,
 * calls replay, and renders the result (or shows appropriate state).
 * @param {string} profile
 * @returns {Promise<void>}
 */
export async function computeActive(profile) {
  const container = document.getElementById('viz-lens-card-wrapper');
  const emptyEl = document.getElementById('viz-empty-state');
  const disabledEl = document.getElementById('viz-disabled-state');
  const errorEl = document.getElementById('viz-error-state');

  // Helper to show one state and hide others
  function showState(el) {
    if (emptyEl) emptyEl.classList.add('hidden');
    if (disabledEl) disabledEl.classList.add('hidden');
    if (errorEl) errorEl.classList.add('hidden');
    if (container) container.classList.remove('hidden');
    if (el) el.classList.remove('hidden');
  }

  // Check if Stream is enabled
  const enabled = await isEnabled(profile);
  if (!enabled) {
    showState(disabledEl);
    if (container) container.classList.add('hidden');
    return;
  }

  try {
    const { from, to } = resolveTimeRange(VizState.timeRange, VizState.customFrom, VizState.customTo);
    const filters = buildReplayFilters(VizState.filters);
    const result = await replay(profile, from, to, VizState.activeLens, filters);

    VizState.lastResult = result;

    // Check for empty result
    if (!result || !result.data || (Array.isArray(result.data) && result.data.length === 0)) {
      showState(emptyEl);
      if (container) container.classList.add('hidden');
      return;
    }

    // Render the result
    showState(null);
    if (container) {
      const cardBody = buildLensCard(container, VizState.activeLens, result.meta);
      renderLens(result, cardBody);
    }
  } catch (err) {
    showState(errorEl);
    if (errorEl) errorEl.textContent = err.message || 'An error occurred while computing the visualization.';
    if (container) container.classList.add('hidden');
  }
}

/**
 * Persists current lens and ascii mode preferences to IndexedDB.
 * @param {string} profile
 * @returns {Promise<void>}
 */
export async function persistPreferences(profile) {
  await setMeta(profile, 'viz_active_lens', VizState.activeLens);
  await setMeta(profile, 'viz_ascii_mode', VizState.asciiMode);
}

/**
 * Returns the stored presets array.
 * @param {string} profile
 * @returns {Promise<Array>}
 */
export async function getPresets(profile) {
  if (!initialized) {
    const savedPresets = await getMeta(profile, 'viz_presets');
    if (Array.isArray(savedPresets)) {
      presets = savedPresets;
    }
  }
  return presets;
}

/**
 * Saves the current VizState as a named preset.
 * Enforces a maximum of 20 presets per profile.
 * @param {string} profile - Active profile name
 * @param {string} name - User-provided preset name
 * @returns {Promise<Object|false>} The created VizPreset object, or false if limit reached
 */
export async function savePreset(profile, name) {
  if (presets.length >= 20) {
    return false;
  }

  const preset = {
    id: crypto.randomUUID(),
    name,
    lens: VizState.activeLens,
    timeRange: VizState.timeRange,
    customFrom: VizState.customFrom,
    customTo: VizState.customTo,
    filters: {
      service: VizState.filters.service,
      project: VizState.filters.project,
      tags: [...VizState.filters.tags]
    },
    asciiMode: VizState.asciiMode,
    createdAt: Math.floor(Date.now() / 1000)
  };

  presets.push(preset);
  await setMeta(profile, 'viz_presets', presets);
  return preset;
}

/**
 * Loads a preset by id and applies its configuration to VizState.
 * @param {string} id - Preset UUID
 * @returns {boolean} true if preset was found and applied, false otherwise
 */
export function loadPreset(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) return false;

  VizState.activeLens = preset.lens;
  VizState.timeRange = preset.timeRange;
  VizState.customFrom = preset.customFrom;
  VizState.customTo = preset.customTo;
  VizState.filters.service = preset.filters.service;
  VizState.filters.project = preset.filters.project;
  VizState.filters.tags = [...(preset.filters.tags || [])];
  VizState.asciiMode = preset.asciiMode;
  setAsciiMode(VizState.asciiMode);

  return true;
}

/**
 * Deletes a preset by id and persists the updated array.
 * @param {string} profile - Active profile name
 * @param {string} id - Preset UUID to delete
 * @returns {Promise<boolean>} true if preset was found and deleted, false otherwise
 */
export async function deletePreset(profile, id) {
  const idx = presets.findIndex(p => p.id === id);
  if (idx === -1) return false;

  presets = presets.filter(p => p.id !== id);
  await setMeta(profile, 'viz_presets', presets);
  return true;
}
