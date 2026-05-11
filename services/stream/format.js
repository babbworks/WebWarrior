/**
 * Stream Service — Hollerith Encoder/Decoder
 *
 * Provides parsing, formatting, validation, and creation of StreamEvents
 * using the Hollerith line format: <ts> <op> <action> <object> [<ctx>]
 */

/**
 * Registered op codes for v1.
 */
export const OP_CODES = Object.freeze({
  T: 'task',
  F: 'frick',
  B: 'bundy',
  D: 'dey',
  H: 'header',
  S: 'system',
  A: 'annotation',
  M: 'mutation',
});

/**
 * @typedef {Object} StreamEvent
 * @property {number} ts - Unix timestamp in seconds
 * @property {string} op - Single uppercase letter from OP_CODES
 * @property {string} action - Lowercase action identifier, no whitespace
 * @property {string} object - UUID or identifier, no whitespace
 * @property {Object|null} ctx - Optional context data (JSON-serializable)
 */

/**
 * Parses a single Hollerith-encoded line into a StreamEvent.
 * @param {string} line - Raw log line
 * @returns {{ok: true, event: StreamEvent} | {ok: false, error: string}}
 */
export function parse(line) {
  if (typeof line !== 'string' || line.trim() === '') {
    return { ok: false, error: 'Line must be a non-empty string' };
  }

  // Strip trailing newline if present
  const trimmed = line.replace(/\n$/, '');

  // Split into at most 5 parts: ts, op, action, object, ctx (ctx may contain spaces)
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace === -1) {
    return { ok: false, error: 'Line must contain at least 4 space-separated fields: ts op action object' };
  }

  const tsStr = trimmed.slice(0, firstSpace);
  const afterTs = trimmed.slice(firstSpace + 1);

  const secondSpace = afterTs.indexOf(' ');
  if (secondSpace === -1) {
    return { ok: false, error: 'Line must contain at least 4 space-separated fields: ts op action object' };
  }

  const opStr = afterTs.slice(0, secondSpace);
  const afterOp = afterTs.slice(secondSpace + 1);

  const thirdSpace = afterOp.indexOf(' ');
  if (thirdSpace === -1) {
    return { ok: false, error: 'Line must contain at least 4 space-separated fields: ts op action object' };
  }

  const actionStr = afterOp.slice(0, thirdSpace);
  const afterAction = afterOp.slice(thirdSpace + 1);

  // The rest is object [ctx] — find the boundary
  const fourthSpace = afterAction.indexOf(' ');
  let objectStr;
  let ctxStr = null;

  if (fourthSpace === -1) {
    objectStr = afterAction;
  } else {
    objectStr = afterAction.slice(0, fourthSpace);
    ctxStr = afterAction.slice(fourthSpace + 1);
  }

  // Validate ts: must be a positive integer
  const ts = Number(tsStr);
  if (!Number.isInteger(ts) || ts < 0) {
    return { ok: false, error: `Invalid timestamp "${tsStr}": must be a non-negative integer` };
  }

  // Validate op: must be a single uppercase letter in the registry
  if (opStr.length !== 1 || !(opStr in OP_CODES)) {
    return { ok: false, error: `Invalid op code "${opStr}": must be one of ${Object.keys(OP_CODES).join(', ')}` };
  }

  // Validate action: must be lowercase, no whitespace
  if (/\s/.test(actionStr)) {
    return { ok: false, error: `Invalid action "${actionStr}": must not contain whitespace` };
  }
  if (actionStr !== actionStr.toLowerCase()) {
    return { ok: false, error: `Invalid action "${actionStr}": must be lowercase` };
  }
  if (actionStr.length === 0) {
    return { ok: false, error: 'Action field must not be empty' };
  }

  // Validate object: must not contain whitespace
  if (/\s/.test(objectStr) || objectStr.length === 0) {
    return { ok: false, error: `Invalid object "${objectStr}": must not contain whitespace and must not be empty` };
  }

  // Parse ctx if present
  let ctx = null;
  if (ctxStr !== null && ctxStr.length > 0) {
    try {
      ctx = JSON.parse(ctxStr);
    } catch (e) {
      return { ok: false, error: `Invalid ctx JSON: ${e.message}` };
    }
  }

  return {
    ok: true,
    event: { ts, op: opStr, action: actionStr, object: objectStr, ctx },
  };
}

/**
 * Formats a StreamEvent into a Hollerith-encoded line.
 * @param {StreamEvent} event
 * @returns {string} Encoded line (no trailing newline)
 */
export function format(event) {
  const { ts, op, action, object, ctx } = event;
  let line = `${ts} ${op} ${action} ${object}`;
  if (ctx !== null && ctx !== undefined) {
    line += ` ${JSON.stringify(ctx)}`;
  }
  return line;
}

/**
 * Validates a StreamEvent object structure.
 * @param {StreamEvent} event
 * @returns {{valid: true} | {valid: false, error: string}}
 */
export function validate(event) {
  if (event === null || typeof event !== 'object') {
    return { valid: false, error: 'Event must be a non-null object' };
  }

  const { ts, op, action, object } = event;

  // ts must be a positive integer
  if (!Number.isInteger(ts) || ts <= 0) {
    return { valid: false, error: `Invalid timestamp: must be a positive integer, got ${ts}` };
  }

  // op must be a registered single uppercase letter
  if (typeof op !== 'string' || op.length !== 1 || !(op in OP_CODES)) {
    return { valid: false, error: `Invalid op code "${op}": must be one of ${Object.keys(OP_CODES).join(', ')}` };
  }

  // action must be lowercase, no whitespace
  if (typeof action !== 'string' || action.length === 0) {
    return { valid: false, error: 'Action must be a non-empty string' };
  }
  if (/\s/.test(action)) {
    return { valid: false, error: `Invalid action "${action}": must not contain whitespace` };
  }
  if (action !== action.toLowerCase()) {
    return { valid: false, error: `Invalid action "${action}": must be lowercase` };
  }

  // object must not contain whitespace
  if (typeof object !== 'string' || object.length === 0) {
    return { valid: false, error: 'Object must be a non-empty string' };
  }
  if (/\s/.test(object)) {
    return { valid: false, error: `Invalid object "${object}": must not contain whitespace` };
  }

  return { valid: true };
}

/**
 * Creates a StreamEvent with current timestamp.
 * @param {string} op - Op code letter
 * @param {string} action - Action name
 * @param {string} object - Object identifier
 * @param {Object|null} ctx - Optional context
 * @returns {StreamEvent}
 */
export function createEvent(op, action, object, ctx = null) {
  return {
    ts: Math.floor(Date.now() / 1000),
    op,
    action,
    object,
    ctx,
  };
}
