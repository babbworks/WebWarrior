/**
 * Viz Gallery — Gallery Panel Controller
 *
 * Manages card state, DOM rendering, toggles, drawer, multi-bind,
 * and pipeline integration for the generative visualization gallery.
 */

import { getCuratedCompositions, serialize, validateCombination, PRIMARY_AXES, MODIFIER_AXES, BINDING_DIMENSIONS, ORIENTABLE_LAYOUTS } from './registry.js';
import { render as pipelineRender } from './pipeline.js';
import { resolveTimeRange, getState as getVizState } from './index.js';
import { replay } from '../stream/replay.js';
import { isEnabled } from '../stream/config.js';
import { renderLens } from '../stream/render.js';

// --- Module State ---

let cards = [];
let initialized = false;
let _profile = null;

// --- 11.1: Card State Management and Initialization ---

/**
 * Initializes the gallery by building CardState array from curated compositions.
 * Lazy initialization — no data fetch occurs.
 * @param {string} profile - Active profile name
 */
export function init(profile) {
  if (initialized) return;
  _profile = profile;

  const curated = getCuratedCompositions();
  cards = curated.map((c, idx) => ({
    id: c.legacy || `card-${idx}`,
    name: c.name,
    description: c.legacy ? `legacy:${c.legacy}` : serialize(c.composition),
    baseComposition: c.composition,
    activeComposition: c.composition ? { ...c.composition } : null,
    legacy: c.legacy || null,
    expanded: false,
    drawerOpen: false,
    compareActive: false,
    comparePeriod: null,
    lastRenderTime: null,
    error: null,
  }));

  initialized = true;
}

/**
 * Returns the current card states array.
 * @returns {Array<Object>} CardState[]
 */
export function getCards() {
  return cards;
}

// --- 11.6: Card Expand/Collapse ---

/**
 * Expands a card and marks it for rendering.
 * @param {string} cardId
 */
export function expandCard(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (card) card.expanded = true;
}

/**
 * Collapses a card and closes its drawer.
 * @param {string} cardId
 */
export function collapseCard(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (card) {
    card.expanded = false;
    card.drawerOpen = false;
  }
}

// --- 11.4: Adjust Drawer ---

/**
 * Toggles the adjust drawer visibility for a card.
 * @param {string} cardId
 */
export function toggleDrawer(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (card) card.drawerOpen = !card.drawerOpen;
}

// --- 11.3: Primary Axis Toggles ---

/**
 * Updates a primary axis value on a card's active composition.
 * Validates the new combination and preserves all other axes.
 * @param {string} cardId
 * @param {string} axis - 'layout'|'renderer'|'binding'
 * @param {string} value - New axis value
 * @returns {boolean} true if update succeeded
 */
export function setPrimaryAxis(cardId, axis, value) {
  const card = cards.find(c => c.id === cardId);
  if (!card || !card.activeComposition) return false;

  // Validate the axis and value
  if (!PRIMARY_AXES[axis] || !PRIMARY_AXES[axis].options.includes(value)) return false;

  // Check layout-renderer compatibility
  if (axis === 'layout' || axis === 'renderer') {
    const layout = axis === 'layout' ? value : card.activeComposition.layout;
    const renderer = axis === 'renderer' ? value : card.activeComposition.renderer;
    const valid = validateCombination(layout, renderer);
    if (!valid.valid) return false;
  }

  // Build updated composition preserving all other axes
  const updated = { ...card.activeComposition, [axis]: value };

  // Update orientation if layout changed
  if (axis === 'layout') {
    updated.orientation = ORIENTABLE_LAYOUTS.includes(value) ? 'horizontal' : null;
  }

  card.activeComposition = updated;
  card.description = serialize(card.activeComposition);
  return true;
}

// --- 11.4: Modifier Controls ---

/**
 * Updates a modifier axis value on a card's active composition.
 * @param {string} cardId
 * @param {string} axis - Modifier axis name or 'interactivity'/'orientation'
 * @param {string} value - New modifier value
 * @returns {boolean} true if update succeeded
 */
export function setModifier(cardId, axis, value) {
  const card = cards.find(c => c.id === cardId);
  if (!card || !card.activeComposition) return false;

  // Validate the axis exists
  if (!MODIFIER_AXES[axis] && axis !== 'interactivity' && axis !== 'orientation') return false;

  // Validate the value
  if (MODIFIER_AXES[axis] && !MODIFIER_AXES[axis].options.includes(value)) return false;
  if (axis === 'interactivity' && !['static', 'inspect', 'drill'].includes(value)) return false;
  if (axis === 'orientation' && !['horizontal', 'vertical'].includes(value)) return false;

  card.activeComposition = { ...card.activeComposition, [axis]: value };
  card.description = serialize(card.activeComposition);
  return true;
}

// --- 11.5: Multi-Bind and Swappable Axis ---

/**
 * Assigns a secondary binding dimension to a texture or color channel.
 * Prevents the same dimension from appearing on multiple channels.
 * @param {string} cardId
 * @param {string} channel - 'texture'|'color'
 * @param {string|null} dimension - Binding dimension or null to clear
 * @returns {boolean} true if update succeeded
 */
export function setSecondaryBind(cardId, channel, dimension) {
  const card = cards.find(c => c.id === cardId);
  if (!card || !card.activeComposition) return false;

  // Validate channel
  if (channel !== 'texture' && channel !== 'color') return false;

  // Validate dimension if provided
  if (dimension && !BINDING_DIMENSIONS.includes(dimension)) return false;

  const comp = card.activeComposition;
  const key = channel === 'texture' ? 'textureBind' : 'colorBind';
  const otherKey = channel === 'texture' ? 'colorBind' : 'textureBind';

  // Prevent same dimension on multiple channels
  if (dimension && dimension === comp.binding) return false;
  if (dimension && dimension === comp[otherKey]) return false;

  card.activeComposition = { ...comp, [key]: dimension || null };
  card.description = serialize(card.activeComposition);
  return true;
}

/**
 * Swaps binding dimensions between two channels.
 * Maintains channel uniqueness — no dimension appears in more than one channel.
 * @param {string} cardId
 * @param {string} fromChannel - 'primary'|'texture'|'color'
 * @param {string} toChannel - 'primary'|'texture'|'color'
 * @returns {boolean} true if swap succeeded
 */
export function swapBinding(cardId, fromChannel, toChannel) {
  const card = cards.find(c => c.id === cardId);
  if (!card || !card.activeComposition) return false;
  if (fromChannel === toChannel) return false;

  const comp = { ...card.activeComposition };

  const getVal = (ch) => {
    if (ch === 'primary') return comp.binding;
    if (ch === 'texture') return comp.textureBind;
    if (ch === 'color') return comp.colorBind;
    return null;
  };

  const setVal = (ch, val) => {
    if (ch === 'primary') comp.binding = val;
    else if (ch === 'texture') comp.textureBind = val;
    else if (ch === 'color') comp.colorBind = val;
  };

  const fromVal = getVal(fromChannel);
  const toVal = getVal(toChannel);

  // Primary channel must always have a value
  if (fromChannel === 'primary' && !toVal) return false;
  if (toChannel === 'primary' && !fromVal) return false;

  setVal(fromChannel, toVal || null);
  setVal(toChannel, fromVal || null);

  card.activeComposition = comp;
  card.description = serialize(card.activeComposition);
  return true;
}

// --- Comparison Mode ---

/**
 * Toggles comparison mode for a card.
 * @param {string} cardId
 */
export function toggleCompare(cardId) {
  const card = cards.find(c => c.id === cardId);
  if (card) {
    card.compareActive = !card.compareActive;
    if (!card.compareActive) card.comparePeriod = null;
  }
}

/**
 * Sets the comparison period for a card.
 * @param {string} cardId
 * @param {string|null} period - 'yesterday'|'last-week'|'custom'|null
 */
export function setComparePeriod(cardId, period) {
  const card = cards.find(c => c.id === cardId);
  if (card) card.comparePeriod = period;
}

// --- 11.6: Card Rendering Pipeline Integration ---

/**
 * Fetches data and runs the full rendering pipeline for a card.
 * Classic cards delegate to existing renderLens().
 * @param {string} cardId
 * @param {string} profile
 */
export async function renderCard(cardId, profile) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;

  const container = document.getElementById(`viz-card-body-${cardId}`);
  if (!container) return;

  card.error = null;

  // Check if stream is enabled
  const enabled = await isEnabled(profile);
  if (!enabled) {
    container.innerHTML = '<div class="viz-card-disabled">Stream is disabled. Enable in Settings.</div>';
    return;
  }

  try {
    const startTime = performance.now();
    const vizState = getVizState();
    const { from, to } = resolveTimeRange(vizState.timeRange, vizState.customFrom, vizState.customTo);
    const timeRangeSeconds = to - from;

    // Legacy cards delegate to renderLens
    if (card.legacy) {
      const result = await replay(profile, from, to, card.legacy, null);
      if (!result || !result.data) {
        container.innerHTML = '<div class="viz-card-empty">No data available.</div>';
        return;
      }
      renderLens(result, container);
      card.lastRenderTime = performance.now() - startTime;
      return;
    }

    // Fetch raw events via burroughs lens
    const result = await replay(profile, from, to, 'burroughs', null);
    const events = result?.data?.rows || [];

    if (events.length === 0) {
      container.innerHTML = '<div class="viz-card-empty">No data available for this time range.</div>';
      return;
    }

    // Run the generative pipeline
    await pipelineRender({
      composition: card.activeComposition,
      events,
      timeRangeSeconds,
      asciiMode: vizState.asciiMode,
      allTimeMax: 1,
    }, container);

    // --- Task 15.1: Comparison mode ---
    if (card.compareActive && card.comparePeriod) {
      const shiftSeconds = card.comparePeriod === 'yesterday' ? 86400 : card.comparePeriod === 'last-week' ? 604800 : 0;
      if (shiftSeconds > 0) {
        const compFrom = from - shiftSeconds;
        const compTo = to - shiftSeconds;
        const compResult = await replay(profile, compFrom, compTo, 'burroughs', null);
        const compEvents = compResult?.data?.rows || [];
        if (compEvents.length > 0) {
          // Create comparison overlay container
          const overlay = document.createElement('div');
          overlay.className = 'viz-comparison-overlay';
          await pipelineRender({
            composition: card.activeComposition,
            events: compEvents,
            timeRangeSeconds,
            asciiMode: vizState.asciiMode,
            allTimeMax: 1,
          }, overlay);
          container.appendChild(overlay);
          // Add comparison legend
          const legend = document.createElement('div');
          legend.className = 'viz-comparison-legend';
          legend.innerHTML = `<span>● current</span><span style="opacity:0.35">● ${card.comparePeriod}</span>`;
          container.appendChild(legend);
        } else {
          const noComp = document.createElement('div');
          noComp.className = 'viz-comparison-legend';
          noComp.textContent = 'No comparison data';
          container.appendChild(noComp);
        }
      }
    }

    // --- Task 13.2: Interactivity levels ---
    const interactivity = card.activeComposition.interactivity || 'inspect';
    if (interactivity === 'inspect') {
      // Add mousemove tooltip handler on the viz container
      container.addEventListener('mousemove', (e) => {
        let tooltip = container.querySelector('.viz-inspect-tooltip');
        if (!tooltip) {
          tooltip = document.createElement('div');
          tooltip.className = 'viz-inspect-tooltip';
          tooltip.style.cssText = 'position:absolute;font-size:10px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:2px 5px;pointer-events:none;z-index:10;';
          container.appendChild(tooltip);
        }
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        tooltip.style.left = `${x + 8}px`;
        tooltip.style.top = `${y - 16}px`;
        tooltip.textContent = `x:${Math.round(x)} y:${Math.round(y)}`;
        tooltip.style.display = 'block';
      });
      container.addEventListener('mouseleave', () => {
        const tooltip = container.querySelector('.viz-inspect-tooltip');
        if (tooltip) tooltip.style.display = 'none';
      });
    } else if (interactivity === 'drill') {
      // Add click handler that narrows time range and re-renders
      container.addEventListener('click', async () => {
        const vizState = getVizState();
        const { from: curFrom, to: curTo } = resolveTimeRange(vizState.timeRange, vizState.customFrom, vizState.customTo);
        const range = curTo - curFrom;
        const mid = curFrom + Math.floor(range / 2);
        const newRange = Math.max(Math.floor(range / 4), 60); // minimum 1 minute
        const newFrom = mid - Math.floor(newRange / 2);
        const newTo = mid + Math.floor(newRange / 2);
        // Re-render with narrowed range
        const narrowedResult = await replay(profile, newFrom, newTo, 'burroughs', null);
        const narrowedEvents = narrowedResult?.data?.rows || [];
        if (narrowedEvents.length > 0) {
          container.innerHTML = '';
          await pipelineRender({
            composition: card.activeComposition,
            events: narrowedEvents,
            timeRangeSeconds: newTo - newFrom,
            asciiMode: vizState.asciiMode,
            allTimeMax: 1,
          }, container);
        }
      });
    }
    // 'static' — no handlers

    card.lastRenderTime = performance.now() - startTime;
  } catch (err) {
    card.error = err.message;
    container.innerHTML = `<div class="viz-card-error">Error: ${err.message}</div>`;
  }
}

/**
 * Re-renders a single card with fresh data.
 * @param {string} cardId
 * @param {string} [profile]
 */
export async function refreshCard(cardId, profile) {
  return renderCard(cardId, profile || _profile);
}

/**
 * Re-renders all currently expanded cards.
 * @param {string} [profile]
 */
export async function refreshAllExpanded(profile) {
  const p = profile || _profile;
  for (const card of cards) {
    if (card.expanded) {
      await renderCard(card.id, p);
    }
  }
}

// --- 11.2: Card DOM Rendering ---

/**
 * Builds the DOM structure for a single card.
 * Collapsed: name, compact descriptor, small preview icon.
 * Expanded: full visualization area, pill-button toggle rows, adjust button.
 * @param {Object} cardState - CardState object
 * @returns {HTMLElement}
 */
export function renderCardDOM(cardState) {
  const el = document.createElement('div');
  el.className = `viz-gallery-card ${cardState.expanded ? 'viz-card-expanded' : ''}`;
  el.dataset.cardId = cardState.id;

  // Header (always visible — collapsed view)
  const header = document.createElement('div');
  header.className = 'viz-gallery-card-header';

  const name = document.createElement('span');
  name.className = 'viz-card-name';
  name.textContent = cardState.name;

  const desc = document.createElement('span');
  desc.className = 'viz-card-desc';
  desc.textContent = cardState.description;

  const previewIcon = document.createElement('span');
  previewIcon.className = 'viz-card-preview-icon';
  previewIcon.textContent = cardState.legacy ? '◈' : '◇';

  header.appendChild(name);
  header.appendChild(desc);
  header.appendChild(previewIcon);
  el.appendChild(header);

  // Body (only when expanded)
  if (cardState.expanded) {
    const body = document.createElement('div');
    body.className = 'viz-gallery-card-body';

    // Primary axis toggles (for non-legacy cards)
    if (cardState.activeComposition) {
      body.appendChild(buildPrimaryToggles(cardState));
    }

    // Adjust button
    const adjustBtn = document.createElement('button');
    adjustBtn.className = 'viz-adjust-btn';
    adjustBtn.textContent = '◆ adjust';
    adjustBtn.dataset.cardId = cardState.id;
    body.appendChild(adjustBtn);

    // Drawer (if open)
    if (cardState.drawerOpen && cardState.activeComposition) {
      body.appendChild(buildDrawer(cardState));
    }

    // Compare toggle
    const compareBtn = document.createElement('button');
    compareBtn.className = 'viz-compare-btn';
    compareBtn.textContent = cardState.compareActive ? '◆ comparing' : '○ compare';
    compareBtn.dataset.cardId = cardState.id;
    body.appendChild(compareBtn);

    // Visualization container
    const vizContainer = document.createElement('div');
    vizContainer.className = 'viz-card-viz-area';
    vizContainer.id = `viz-card-body-${cardState.id}`;
    body.appendChild(vizContainer);

    el.appendChild(body);
  }

  return el;
}

/**
 * Builds the primary axis pill-button toggle rows.
 * @param {Object} cardState
 * @returns {HTMLElement}
 */
function buildPrimaryToggles(cardState) {
  const comp = cardState.activeComposition;
  const wrapper = document.createElement('div');
  wrapper.className = 'viz-primary-toggles';

  // Layout row (6 options)
  wrapper.appendChild(buildPillRow('layout', PRIMARY_AXES.layout.options, comp.layout, cardState));
  // Renderer row (5 options)
  wrapper.appendChild(buildPillRow('renderer', PRIMARY_AXES.renderer.options, comp.renderer, cardState));
  // Binding row (6 options)
  wrapper.appendChild(buildPillRow('binding', PRIMARY_AXES.binding.options, comp.binding, cardState));

  return wrapper;
}

/**
 * Builds a single pill-button row for a primary axis.
 * Highlights active option, disables invalid combinations with tooltip.
 * @param {string} axis
 * @param {string[]} options
 * @param {string} active
 * @param {Object} cardState
 * @returns {HTMLElement}
 */
function buildPillRow(axis, options, active, cardState) {
  const row = document.createElement('div');
  row.className = 'viz-pill-row';
  row.dataset.axis = axis;

  const label = document.createElement('span');
  label.className = 'viz-pill-label';
  label.textContent = axis;
  row.appendChild(label);

  for (const opt of options) {
    const pill = document.createElement('button');
    pill.className = `viz-pill ${opt === active ? 'viz-pill-active' : ''}`;
    pill.textContent = opt;
    pill.dataset.value = opt;
    pill.dataset.axis = axis;
    pill.dataset.cardId = cardState.id;

    // Check if this would create an invalid combination
    if (axis === 'layout' || axis === 'renderer') {
      const layout = axis === 'layout' ? opt : cardState.activeComposition.layout;
      const renderer = axis === 'renderer' ? opt : cardState.activeComposition.renderer;
      const valid = validateCombination(layout, renderer);
      if (!valid.valid) {
        pill.disabled = true;
        pill.title = valid.reason;
        pill.classList.add('viz-pill-disabled');
      }
    }

    row.appendChild(pill);
  }

  return row;
}

// --- 11.4: Adjust Drawer DOM ---

/**
 * Builds the adjust drawer with all modifier controls.
 * @param {Object} cardState
 * @returns {HTMLElement}
 */
function buildDrawer(cardState) {
  const comp = cardState.activeComposition;
  const drawer = document.createElement('div');
  drawer.className = 'viz-adjust-drawer';

  // Granularity (discrete snap slider)
  drawer.appendChild(buildModifierRow('granularity', MODIFIER_AXES.granularity.options, comp.granularity, cardState.id));
  // Aggregation pills
  drawer.appendChild(buildModifierRow('aggregation', MODIFIER_AXES.aggregation.options, comp.aggregation, cardState.id));
  // Texture pills + bind-to dropdown
  drawer.appendChild(buildModifierRowWithBind('texture', MODIFIER_AXES.texture.options, comp.texture, comp.textureBind, cardState.id));
  // Color pills + bind-to dropdown
  drawer.appendChild(buildModifierRowWithBind('color', MODIFIER_AXES.color.options, comp.color, comp.colorBind, cardState.id));
  // Annotation pills
  drawer.appendChild(buildModifierRow('annotation', MODIFIER_AXES.annotation.options, comp.annotation, cardState.id));
  // Normalization toggle
  drawer.appendChild(buildModifierRow('normalization', MODIFIER_AXES.normalization.options, comp.normalization, cardState.id));
  // Density pills
  drawer.appendChild(buildModifierRow('density', MODIFIER_AXES.density.options, comp.density, cardState.id));
  // Interactivity pills
  drawer.appendChild(buildModifierRow('interactivity', ['static', 'inspect', 'drill'], comp.interactivity || 'inspect', cardState.id));

  return drawer;
}

/**
 * Builds a modifier pill row.
 * @param {string} axis
 * @param {string[]} options
 * @param {string} active
 * @param {string} cardId
 * @returns {HTMLElement}
 */
function buildModifierRow(axis, options, active, cardId) {
  const row = document.createElement('div');
  row.className = 'viz-modifier-row';
  row.dataset.axis = axis;

  const label = document.createElement('span');
  label.className = 'viz-modifier-label';
  label.textContent = axis;
  row.appendChild(label);

  for (const opt of options) {
    const pill = document.createElement('button');
    pill.className = `viz-pill viz-pill-sm ${opt === active ? 'viz-pill-active' : ''}`;
    pill.textContent = opt;
    pill.dataset.value = opt;
    pill.dataset.axis = axis;
    pill.dataset.cardId = cardId;
    row.appendChild(pill);
  }

  return row;
}

/**
 * Builds a modifier row with an additional "bind to:" dropdown for secondary binding.
 * @param {string} axis - 'texture'|'color'
 * @param {string[]} options
 * @param {string} active
 * @param {string|null} bindValue
 * @param {string} cardId
 * @returns {HTMLElement}
 */
function buildModifierRowWithBind(axis, options, active, bindValue, cardId) {
  const row = buildModifierRow(axis, options, active, cardId);

  // Add "bind to:" dropdown
  const bindLabel = document.createElement('span');
  bindLabel.className = 'viz-bind-label';
  bindLabel.textContent = 'bind:';
  row.appendChild(bindLabel);

  const select = document.createElement('select');
  select.className = 'viz-bind-select';
  select.dataset.channel = axis;
  select.dataset.cardId = cardId;

  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'none';
  select.appendChild(noneOpt);

  for (const dim of BINDING_DIMENSIONS) {
    const opt = document.createElement('option');
    opt.value = dim;
    opt.textContent = dim;
    if (dim === bindValue) opt.selected = true;
    select.appendChild(opt);
  }

  row.appendChild(select);
  return row;
}

// --- Gallery Panel Rendering ---

/**
 * Renders the full gallery panel into a container element.
 * @param {HTMLElement} containerEl
 */
export function renderGalleryPanel(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  for (const card of cards) {
    const cardEl = renderCardDOM(card);
    containerEl.appendChild(cardEl);
  }
}
