/**
 * Stream Service — Service Interception Layer
 *
 * Wraps existing service modules to capture events before execution.
 * When stream is active, emits events to the log and bus.
 * When inactive, passes through transparently.
 * Existing service behavior is never altered.
 */

import { createEvent, format } from './format.js';
import { append } from './log.js';
import { bus } from './bus.js';

let _active = false;
let _profile = null;
let _lastEventTs = null;
let _gapThreshold = 300;

/**
 * Checks if stream is currently active (cached, synchronous).
 * @returns {boolean}
 */
export function isActive() {
  return _active;
}

/**
 * Updates the active state.
 * @param {boolean} active
 */
export function setActive(active) {
  _active = !!active;
}

/**
 * Sets the active profile for interception.
 * @param {string} profile
 */
export function setProfile(profile) {
  _profile = profile;
}

/**
 * @typedef {Object} InterceptConfig
 * @property {string} service - Service name
 * @property {string} op - Default op code for this service
 * @property {Object} actionMap - Maps function names to {action, op?, objectExtractor?, ctxBuilder?}
 */

/**
 * Creates an intercepted version of a service module.
 * @param {Object} module - Original service module (object with function exports)
 * @param {InterceptConfig} config
 * @returns {Object} Wrapped module with same interface
 */
export function wrapService(module, config) {
  const wrapped = {};

  for (const [fnName, fn] of Object.entries(module)) {
    if (typeof fn !== 'function') {
      wrapped[fnName] = fn;
      continue;
    }

    wrapped[fnName] = async function (profile, ...args) {
      // Emit event before execution if stream is active
      if (_active && _profile === profile) {
        try {
          const mapping = config.actionMap[fnName];
          if (mapping) {
            // Check for session gap — emit session-start if needed
            const nowTs = Math.floor(Date.now() / 1000);
            if (_lastEventTs !== null && (nowTs - _lastEventTs) > _gapThreshold) {
              const sessionEvent = createEvent('S', 'session-start', 'stream.log', { prof: profile });
              const sessionLine = format(sessionEvent);
              await append(profile, sessionLine);
              bus.emit(sessionEvent, profile);
              _lastEventTs = sessionEvent.ts;
            }

            const op = mapping.op || config.op;
            const action = mapping.action || fnName;
            const object = mapping.objectExtractor
              ? mapping.objectExtractor(profile, ...args)
              : extractDefaultObject(fnName, args);
            const ctx = mapping.ctxBuilder
              ? mapping.ctxBuilder(profile, ...args)
              : buildDefaultCtx(config.service, profile, args);

            const event = createEvent(op, action, object, ctx);
            const line = format(event);
            await append(profile, line);
            bus.emit(event, profile);

            // Update last event timestamp
            _lastEventTs = event.ts;
          }
        } catch (err) {
          // Best-effort: log warning but never block the service call
          console.warn(`[Stream Intercept] Failed to capture ${config.service}.${fnName}:`, err);
        }
      }

      // Always call the original function
      return fn(profile, ...args);
    };
  }

  return wrapped;
}

/**
 * Extracts a default object identifier from function arguments.
 */
function extractDefaultObject(fnName, args) {
  // First arg after profile is often a UUID or ID
  if (args.length > 0) {
    const first = args[0];
    if (typeof first === 'string' && first.length > 0) return first;
    if (typeof first === 'object' && first !== null) {
      if (first.uuid) return first.uuid;
      if (first.id) return String(first.id);
    }
  }
  return `action:${fnName}`;
}

/**
 * Builds a default ctx object from service context.
 */
function buildDefaultCtx(service, profile, args) {
  const ctx = { src: service, prof: profile };

  // Try to extract project and tags from first object arg
  if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null) {
    const obj = args[0];
    if (obj.project) ctx.proj = obj.project;
    if (obj.tags) ctx.tags = Array.isArray(obj.tags) ? obj.tags : [];
    if (obj.description) ctx.name = obj.description.slice(0, 60);
    if (obj.urgency != null) ctx.urgency = obj.urgency;
  }

  return ctx;
}

// ── Service Registration ─────────────────────────────────────────────────────

/**
 * Registers all service interceptions and returns wrapped modules.
 * @param {string} profile
 * @param {Object} services - Map of service name to module
 * @param {Object} [options] - Optional config overrides
 * @param {number} [options.gapThreshold] - Gap threshold in seconds for session detection
 * @returns {Object} Map of service name to wrapped module
 */
export function registerAll(profile, services, options = {}) {
  _profile = profile;

  // Store gap_threshold for session auto-detection
  if (options.gapThreshold != null) {
    _gapThreshold = options.gapThreshold;
  }

  const configs = {
    tasks: {
      service: 'task',
      op: 'T',
      actionMap: {
        addTask:        { action: 'add', objectExtractor: (p, fields) => fields?.uuid || `new:${Date.now()}`, ctxBuilder: (p, fields) => ({ src: 'task', prof: p, proj: fields?.project || '', tags: fields?.tags || [], name: (fields?.description || '').slice(0, 60) }) },
        updateTask:     { action: 'modify', op: 'M', objectExtractor: (p, uuid) => uuid, ctxBuilder: (p, uuid, updates) => ({ src: 'task', prof: p, field: Object.keys(updates || {}).join(',') }) },
        completeTask:   { action: 'done', objectExtractor: (p, uuid) => uuid, ctxBuilder: (p, uuid) => ({ src: 'task', prof: p }) },
        deleteTask:     { action: 'delete', objectExtractor: (p, uuid) => uuid, ctxBuilder: (p, uuid) => ({ src: 'task', prof: p }) },
        startTask:      { action: 'start', op: 'F', objectExtractor: (p, uuid) => uuid, ctxBuilder: (p, uuid) => ({ src: 'task', prof: p }) },
        stopTask:       { action: 'stop', op: 'F', objectExtractor: (p, uuid) => uuid, ctxBuilder: (p, uuid) => ({ src: 'task', prof: p }) },
        annotateTask:   { action: 'annotate', op: 'A', objectExtractor: (p, uuid) => uuid, ctxBuilder: (p, uuid, text) => ({ src: 'task', prof: p, name: (text || '').slice(0, 60) }) },
        bulkComplete:   { action: 'bulk-complete', objectExtractor: (p, uuids) => `bulk:${(uuids || []).length}`, ctxBuilder: (p, uuids) => ({ src: 'task', prof: p, count: (uuids || []).length }) },
        bulkDelete:     { action: 'bulk-delete', objectExtractor: (p, uuids) => `bulk:${(uuids || []).length}`, ctxBuilder: (p, uuids) => ({ src: 'task', prof: p, count: (uuids || []).length }) },
        bulkSetProject: { action: 'bulk-project', op: 'M', objectExtractor: (p, uuids) => `bulk:${(uuids || []).length}`, ctxBuilder: (p, uuids, proj) => ({ src: 'task', prof: p, proj, count: (uuids || []).length }) },
        bulkAddTag:     { action: 'tag-add', op: 'M', objectExtractor: (p, uuids) => `bulk:${(uuids || []).length}`, ctxBuilder: (p, uuids, tag) => ({ src: 'task', prof: p, tag, count: (uuids || []).length }) },
        bulkRemoveTag:  { action: 'tag-remove', op: 'M', objectExtractor: (p, uuids) => `bulk:${(uuids || []).length}`, ctxBuilder: (p, uuids, tag) => ({ src: 'task', prof: p, tag, count: (uuids || []).length }) },
        bulkSetPriority:{ action: 'bulk-priority', op: 'M', objectExtractor: (p, uuids) => `bulk:${(uuids || []).length}`, ctxBuilder: (p, uuids, pri) => ({ src: 'task', prof: p, priority: pri, count: (uuids || []).length }) },
      },
    },
    time: {
      service: 'time',
      op: 'B',
      actionMap: {
        startTracking:  { action: 'start', ctxBuilder: (p, tags, ann, log) => ({ src: 'timew', prof: p, tags: typeof tags === 'string' ? tags.split(/[\s,]+/) : (tags || []), log: log || 'main' }) },
        stopTracking:   { action: 'stop', objectExtractor: () => `time:active`, ctxBuilder: (p) => ({ src: 'timew', prof: p }) },
        trackInterval:  { action: 'start', ctxBuilder: (p, tags, dur, ann, log) => ({ src: 'timew', prof: p, tags: typeof tags === 'string' ? tags.split(/[\s,]+/) : (tags || []), duration: dur, log: log || 'main' }) },
        updateInterval: { action: 'stop', op: 'M', objectExtractor: (p, id) => `time:${id}`, ctxBuilder: (p, id, updates) => ({ src: 'timew', prof: p, field: Object.keys(updates || {}).join(',') }) },
        deleteInterval: { action: 'stop', op: 'M', objectExtractor: (p, id) => `time:${id}`, ctxBuilder: (p) => ({ src: 'timew', prof: p, action: 'delete' }) },
      },
    },
    journal: {
      service: 'journal',
      op: 'A',
      actionMap: {
        addEntry:       { action: 'write', ctxBuilder: (p, opts) => ({ src: 'jrnl', prof: p, proj: opts?.project || '', tags: typeof opts?.tags === 'string' ? opts.tags.split(/[\s,]+/) : (opts?.tags || []), name: (opts?.body || '').slice(0, 60), journal: opts?.journal || 'main' }) },
        annotateEntry:  { action: 'annotate', objectExtractor: (p, id) => `jrnl:${id}`, ctxBuilder: (p, id, text) => ({ src: 'jrnl', prof: p, name: (text || '').slice(0, 60) }) },
        updateEntry:    { action: 'update', op: 'M', objectExtractor: (p, id) => `jrnl:${id}`, ctxBuilder: (p, id, updates) => ({ src: 'jrnl', prof: p, field: Object.keys(updates || {}).join(',') }) },
        deleteEntry:    { action: 'delete', objectExtractor: (p, id) => `jrnl:${id}`, ctxBuilder: (p) => ({ src: 'jrnl', prof: p }) },
        archiveEntry:   { action: 'archive', op: 'M', objectExtractor: (p, id) => `jrnl:${id}`, ctxBuilder: (p, id, archived) => ({ src: 'jrnl', prof: p, archived: !!archived }) },
      },
    },
    ledger: {
      service: 'ledger',
      op: 'T',
      actionMap: {
        addTransaction:     { action: 'post', ctxBuilder: (p, opts) => ({ src: 'ldgr', prof: p, name: (opts?.description || '').slice(0, 60), ledger: opts?.ledger || 'main' }) },
        addFullTransaction: { action: 'post', ctxBuilder: (p, opts) => ({ src: 'ldgr', prof: p, name: (opts?.description || '').slice(0, 60), ledger: opts?.ledger || 'main' }) },
        updateTransaction:  { action: 'modify', op: 'M', objectExtractor: (p, id) => `ldgr:${id}`, ctxBuilder: (p, id, updates) => ({ src: 'ldgr', prof: p, field: Object.keys(updates || {}).join(',') }) },
        deleteTransaction:  { action: 'delete', objectExtractor: (p, id) => `ldgr:${id}`, ctxBuilder: (p) => ({ src: 'ldgr', prof: p }) },
      },
    },
    lists: {
      service: 'lists',
      op: 'M',
      actionMap: {
        addItem:    { action: 'item-add', objectExtractor: (p, text, list) => `list:${list || 'default'}`, ctxBuilder: (p, text, list) => ({ src: 'list', prof: p, name: (text || '').slice(0, 60), list: list || 'default' }) },
        finishItem: { action: 'item-finish', objectExtractor: (p, id) => `list:${id}`, ctxBuilder: (p) => ({ src: 'list', prof: p }) },
        deleteItem: { action: 'item-delete', objectExtractor: (p, id) => `list:${id}`, ctxBuilder: (p) => ({ src: 'list', prof: p }) },
        editItem:   { action: 'item-edit', objectExtractor: (p, id) => `list:${id}`, ctxBuilder: (p, id, text) => ({ src: 'list', prof: p, name: (text || '').slice(0, 60) }) },
        setNote:    { action: 'item-edit', objectExtractor: (p, id) => `list:${id}`, ctxBuilder: (p) => ({ src: 'list', prof: p }) },
        addList:    { action: 'list-add', objectExtractor: (p, name) => `list:${name}`, ctxBuilder: (p, name) => ({ src: 'list', prof: p, name }) },
        deleteList: { action: 'list-delete', objectExtractor: (p, name) => `list:${name}`, ctxBuilder: (p, name) => ({ src: 'list', prof: p, name }) },
      },
    },
    community: {
      service: 'community',
      op: 'A',
      actionMap: {
        createCollection:  { action: 'write', objectExtractor: (name) => `comm:${name}`, ctxBuilder: (name) => ({ src: 'comm', name }) },
        addEntry:          { action: 'write', objectExtractor: (collId) => `comm:${collId}`, ctxBuilder: (collId, opts) => ({ src: 'comm', type: opts?.type }) },
        addComment:        { action: 'annotate', objectExtractor: (entryId) => `comm:${entryId}`, ctxBuilder: (entryId) => ({ src: 'comm' }) },
        archiveCollection: { action: 'archive', objectExtractor: (id) => `comm:${id}`, ctxBuilder: () => ({ src: 'comm' }) },
      },
    },
    questions: {
      service: 'questions',
      op: 'M',
      actionMap: {
        saveTemplate:   { action: 'field', objectExtractor: (p, tmpl) => `question:${tmpl?.id || 'new'}`, ctxBuilder: (p, tmpl) => ({ src: 'questions', prof: p, name: (tmpl?.name || '').slice(0, 60) }) },
        deleteTemplate: { action: 'field', objectExtractor: (p, id) => `question:${id}`, ctxBuilder: (p) => ({ src: 'questions', prof: p }) },
      },
    },
    attributes: {
      service: 'attributes',
      op: 'M',
      actionMap: {
        addAttribute:       { action: 'uda-set', objectExtractor: (p, def) => `uda:${def?.name || 'unknown'}`, ctxBuilder: (p, def) => ({ src: 'attr', prof: p, name: def?.name, type: def?.type }) },
        updateAttribute:    { action: 'uda-set', objectExtractor: (p, name) => `uda:${name}`, ctxBuilder: (p, name, updates) => ({ src: 'attr', prof: p, field: Object.keys(updates || {}).join(',') }) },
        removeAttribute:    { action: 'uda-remove', objectExtractor: (p, name) => `uda:${name}`, ctxBuilder: (p, name) => ({ src: 'attr', prof: p }) },
        importTemplatePack: { action: 'uda-set', objectExtractor: (p, packName) => `uda-pack:${packName}`, ctxBuilder: (p, packName) => ({ src: 'attr', prof: p, pack: packName }) },
      },
    },
  };

  const wrapped = {};
  for (const [name, svc] of Object.entries(services)) {
    const cfg = configs[name];
    if (cfg) {
      wrapped[name] = wrapService(svc, cfg);
    } else {
      wrapped[name] = svc; // Pass through unregistered services
    }
  }

  return wrapped;
}
