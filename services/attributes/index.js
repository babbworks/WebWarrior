// UDA Attributes Service — typed attribute definition management

import { getMeta, setMeta } from '../../storage/db.js';

/**
 * @typedef {Object} AttributeDefinition
 * @property {string} name - Unique identifier (lowercase, no spaces)
 * @property {string} label - Human-readable display label
 * @property {'string'|'numeric'|'date'|'duration'} type - Value type
 * @property {string} defaultValue - Default value (validated against type)
 * @property {string[]} allowedValues - Constrained value set (empty = unconstrained)
 * @property {number} urgencyCoefficient - Multiplier for urgency computation (default 0)
 * @property {boolean} readOnly - Whether value is editable in task drawer (default false)
 */

const VALID_TYPES = ['string', 'numeric', 'date', 'duration'];
const META_KEY = 'uda_definitions';

// ── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Validates a default value against the attribute type.
 * @param {string} type
 * @param {string} value
 * @returns {boolean}
 */
export function isValidDefault(type, value) {
  if (value === '' || value == null) return true;
  switch (type) {
    case 'string':
      return true;
    case 'numeric': {
      const n = parseFloat(value);
      return !isNaN(n) && isFinite(n);
    }
    case 'date': {
      const d = new Date(value);
      return !isNaN(d.getTime());
    }
    case 'duration':
      return /^\d+(\.\d+)?[hmHMdDwW]$/.test(value);
    default:
      return false;
  }
}

/**
 * Parses a comma-separated string into a trimmed array.
 * @param {string} csv
 * @returns {string[]}
 */
export function parseAllowedValues(csv) {
  if (!csv) return [];
  return csv.split(',').map(s => s.trim()).filter(s => s.length > 0);
}


/**
 * Internal helper — validates a full definition object.
 * @param {AttributeDefinition} def
 * @throws {Error} if type is invalid, default is invalid for type, or default not in allowed values
 */
function validateDefinition(def) {
  if (!VALID_TYPES.includes(def.type)) {
    throw new Error(`Invalid type "${def.type}". Valid types: string, numeric, date, duration`);
  }
  if (def.defaultValue && !isValidDefault(def.type, def.defaultValue)) {
    throw new Error(`Default value "${def.defaultValue}" is not valid for type "${def.type}"`);
  }
  if (def.allowedValues.length > 0 && def.defaultValue) {
    if (!def.allowedValues.includes(def.defaultValue)) {
      throw new Error(`Default value "${def.defaultValue}" is not in allowed values: [${def.allowedValues.join(', ')}]`);
    }
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Returns all attribute definitions for the profile.
 * @param {string} profile
 * @returns {Promise<AttributeDefinition[]>}
 */
export async function getAttributes(profile) {
  const defs = await getMeta(profile, META_KEY);
  return defs || [];
}

/**
 * Creates a new attribute definition. Validates type, default, allowed values.
 * @param {string} profile
 * @param {Partial<AttributeDefinition> & {name: string, type: string}} definition
 * @returns {Promise<AttributeDefinition>} The persisted definition
 * @throws {Error} If name is duplicate, type is invalid, or default violates constraints
 */
export async function addAttribute(profile, definition) {
  const def = {
    name:               definition.name,
    label:              definition.label || '',
    type:               definition.type,
    defaultValue:       definition.defaultValue || '',
    allowedValues:      definition.allowedValues || [],
    urgencyCoefficient: definition.urgencyCoefficient ?? 0,
    readOnly:           definition.readOnly ?? false,
    group:              definition.group || '',
  };

  validateDefinition(def);

  const existing = await getAttributes(profile);
  if (existing.some(d => d.name === def.name)) {
    throw new Error(`Attribute "${def.name}" already exists`);
  }

  existing.push(def);
  await setMeta(profile, META_KEY, existing);
  return def;
}

/**
 * Updates an existing attribute definition by name.
 * @param {string} profile
 * @param {string} name - The attribute name to update
 * @param {Partial<AttributeDefinition>} updates - Fields to merge
 * @returns {Promise<AttributeDefinition>} The updated definition
 * @throws {Error} If attribute not found or updates violate constraints
 */
export async function updateAttribute(profile, name, updates) {
  const existing = await getAttributes(profile);
  const idx = existing.findIndex(d => d.name === name);
  if (idx === -1) {
    throw new Error(`Attribute "${name}" not found`);
  }

  const merged = { ...existing[idx], ...updates };
  validateDefinition(merged);

  existing[idx] = merged;
  await setMeta(profile, META_KEY, existing);
  return merged;
}

/**
 * Removes an attribute definition by name.
 * @param {string} profile
 * @param {string} name
 * @returns {Promise<void>}
 * @throws {Error} If attribute not found
 */
export async function removeAttribute(profile, name) {
  const existing = await getAttributes(profile);
  const idx = existing.findIndex(d => d.name === name);
  if (idx === -1) {
    throw new Error(`Attribute "${name}" not found`);
  }

  existing.splice(idx, 1);
  await setMeta(profile, META_KEY, existing);
}

// ── CSV Import/Export ────────────────────────────────────────────────────────

/**
 * Parses a CSV line into an attribute definition and persists it.
 * Format: name,label,type,default,allowed_values,urgency_coefficient,read_only
 * Allowed values use pipe `|` separator within the field.
 * Missing fields use defaults.
 * @param {string} profile
 * @param {string} csvLine
 * @returns {Promise<AttributeDefinition>}
 * @throws {Error} If type is invalid or constraints are violated
 */
export async function importAttribute(profile, csvLine) {
  const fields = csvLine.split(',').map(f => f.trim());
  const name = fields[0] || '';
  if (!name) {
    throw new Error('Attribute name is required');
  }

  const label              = fields[1] || '';
  const type               = fields[2] || 'string';
  const defaultValue       = fields[3] || '';
  const allowedValuesRaw   = fields[4] || '';
  const urgencyCoefficient = fields[5] ? parseFloat(fields[5]) : 0;
  const readOnly           = fields[6] === 'true';
  const group              = fields[7] || '';

  const allowedValues = allowedValuesRaw
    ? allowedValuesRaw.split('|').map(s => s.trim()).filter(s => s.length > 0)
    : [];

  const definition = {
    name,
    label,
    type,
    defaultValue,
    allowedValues,
    urgencyCoefficient: isNaN(urgencyCoefficient) ? 0 : urgencyCoefficient,
    readOnly,
    group,
  };

  return addAttribute(profile, definition);
}

/**
 * Serializes an attribute definition to CSV line format.
 * @param {AttributeDefinition} definition
 * @returns {string}
 */
export function formatAttribute(definition) {
  const allowedStr = (definition.allowedValues || []).join('|');
  return [
    definition.name,
    definition.label,
    definition.type,
    definition.defaultValue,
    allowedStr,
    definition.urgencyCoefficient,
    definition.readOnly,
    definition.group || '',
  ].join(',');
}

// ── Urgency ──────────────────────────────────────────────────────────────────

/**
 * Computes the urgency contribution for a single UDA on a task.
 * @param {AttributeDefinition} definition
 * @param {*} value - The task's UDA value
 * @returns {number} The urgency contribution (coefficient * normalized value)
 */
export function computeUdaUrgency(definition, value) {
  const coeff = definition.urgencyCoefficient;
  if (coeff === 0) return 0;

  switch (definition.type) {
    case 'numeric': {
      const n = parseFloat(value);
      return coeff * (isNaN(n) ? 0 : n);
    }
    case 'string': {
      if (definition.allowedValues && definition.allowedValues.length > 0) {
        const idx = definition.allowedValues.indexOf(value);
        return coeff * (idx === -1 ? 0 : idx / definition.allowedValues.length);
      }
      return coeff * (value ? 1 : 0);
    }
    case 'date': {
      const target = new Date(value);
      if (isNaN(target.getTime())) return 0;
      const now = new Date();
      const diffMs = target.getTime() - now.getTime();
      const days = diffMs / (1000 * 60 * 60 * 24);
      const normalized = Math.max(0, Math.min(1, days / 365));
      return coeff * normalized;
    }
    case 'duration': {
      const hours = parseDurationToHours(value);
      return coeff * (hours / 24);
    }
    default:
      return 0;
  }
}

/**
 * Parses a duration string to hours.
 * Supports: "2h" → 2, "30m" → 0.5, "1d" → 24, "1w" → 168
 * @param {string} value
 * @returns {number}
 */
function parseDurationToHours(value) {
  if (!value || typeof value !== 'string') return 0;
  const match = value.match(/^(\d+(?:\.\d+)?)([hmHMdDwW])$/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'h': return num;
    case 'm': return num / 60;
    case 'd': return num * 24;
    case 'w': return num * 168;
    default:  return 0;
  }
}


// ── Template Packs ───────────────────────────────────────────────────────────

/**
 * Built-in attribute template packs. Each pack is an array of AttributeDefinition objects.
 * Users can import one or more packs into their profile.
 */
export const TEMPLATE_PACKS = {
  priority: {
    label: 'Priority (Taskwarrior Default)',
    description: 'The built-in Taskwarrior priority UDA with H/M/L values and urgency coefficients.',
    definitions: [
      { name: 'priority', label: 'Priority', type: 'string', defaultValue: '', allowedValues: ['H', 'M', 'L'], urgencyCoefficient: 6.0, readOnly: false },
    ],
  },

  project_management: {
    label: 'Project Management',
    description: 'Milestones, stages, scope, goals, deliverables, and effort tracking.',
    definitions: [
      { name: 'milestones', label: 'Milestones', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'stages', label: 'Stages', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'scope', label: 'Scope', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'goals', label: 'Goals', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'deliverables', label: 'Deliverables', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'manhours', label: 'Man-Hours', type: 'numeric', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'constraints', label: 'Constraints', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'progress', label: 'Progress', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'blocking', label: 'Blocking', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 1.0, readOnly: false },
    ],
  },

  development: {
    label: 'Development',
    description: 'Technology stack, languages, testing, deployment, and bug tracking.',
    definitions: [
      { name: 'stack', label: 'Stack', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'codinglanguages', label: 'Coding Languages', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'testing', label: 'Testing', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'deployment', label: 'Deployment', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'bugs', label: 'Bugs', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 1.5, readOnly: false },
      { name: 'versions', label: 'Versions', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'design', label: 'Design', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'prototyping', label: 'Prototyping', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
    ],
  },

  github: {
    label: 'GitHub Integration',
    description: 'Full GitHub issue/PR sync metadata for two-way tracking.',
    definitions: [
      { name: 'githubissue', label: 'GitHub Issue', type: 'numeric', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'githubtitle', label: 'GitHub Title', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'githubrepo', label: 'GitHub Repo', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'githuburl', label: 'GitHub URL', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'githubtype', label: 'GitHub Type', type: 'string', defaultValue: '', allowedValues: ['issue', 'pull_request'], urgencyCoefficient: 0, readOnly: false },
      { name: 'githubnumber', label: 'GitHub #', type: 'numeric', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'githubstate', label: 'GitHub State', type: 'string', defaultValue: '', allowedValues: ['open', 'closed'], urgencyCoefficient: 0, readOnly: false },
      { name: 'githubuser', label: 'GitHub User', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'githubauthor', label: 'GitHub Author', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'githubsync', label: 'GitHub Sync', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'githubcreatedon', label: 'GitHub Created', type: 'date', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: true },
      { name: 'githubupdatedat', label: 'GitHub Updated', type: 'date', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: true },
      { name: 'githubmilestone', label: 'GitHub Milestone', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
    ],
  },

  financial: {
    label: 'Financial',
    description: 'Cost tracking, invoicing, quantities, and currency.',
    definitions: [
      { name: 'costtodevelop', label: 'Cost to Develop', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'dollars', label: 'Dollars', type: 'numeric', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'invoice', label: 'Invoice', type: 'numeric', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'quantity', label: 'Quantity', type: 'numeric', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'discount', label: 'Discount', type: 'numeric', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'costing', label: 'Costing', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'taxtype', label: 'Tax Type', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'taxamount', label: 'Tax Amount', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
    ],
  },

  people: {
    label: 'People & Teams',
    description: 'Team members, contacts, clients, and organizational roles.',
    definitions: [
      { name: 'team', label: 'Team', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'contact', label: 'Contact', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'owner', label: 'Owner', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'clients', label: 'Clients', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'managers', label: 'Managers', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'contributors', label: 'Contributors', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'vendors', label: 'Vendors', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'consultants', label: 'Consultants', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
    ],
  },

  dates: {
    label: 'Dates & Deadlines',
    description: 'Additional date tracking beyond due/scheduled/wait.',
    definitions: [
      { name: 'reviewby', label: 'Review By', type: 'date', defaultValue: '', allowedValues: [], urgencyCoefficient: 2.0, readOnly: false },
      { name: 'submitby', label: 'Submit By', type: 'date', defaultValue: '', allowedValues: [], urgencyCoefficient: 3.0, readOnly: false },
      { name: 'draftby', label: 'Draft By', type: 'date', defaultValue: '', allowedValues: [], urgencyCoefficient: 1.5, readOnly: false },
      { name: 'updateby', label: 'Update By', type: 'date', defaultValue: '', allowedValues: [], urgencyCoefficient: 1.0, readOnly: false },
      { name: 'startedon', label: 'Started On', type: 'date', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'expires', label: 'Expires', type: 'date', defaultValue: '', allowedValues: [], urgencyCoefficient: 2.5, readOnly: false },
    ],
  },

  governance: {
    label: 'Governance & Compliance',
    description: 'Regulations, audits, approvals, and compliance tracking.',
    definitions: [
      { name: 'regulations', label: 'Regulations', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'compliance', label: 'Compliance', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'audits', label: 'Audits', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'approvals', label: 'Approvals', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 1.0, readOnly: false },
      { name: 'controls', label: 'Controls', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'agreement', label: 'Agreement', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
    ],
  },

  documentation: {
    label: 'Documentation & Communication',
    description: 'Documents, notes, meetings, and communication tracking.',
    definitions: [
      { name: 'documents', label: 'Documents', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'documentation', label: 'Documentation', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'comm', label: 'Communication', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'meetings', label: 'Meetings', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'mainnote', label: 'Main Note', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'instructions', label: 'Instructions', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
    ],
  },

  logistics: {
    label: 'Logistics & Operations',
    description: 'Equipment, shipping, inventory, and operational tracking.',
    definitions: [
      { name: 'equipment', label: 'Equipment', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'services', label: 'Services', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'inventory', label: 'Inventory', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'shipper', label: 'Shipper', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'operations', label: 'Operations', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'packages', label: 'Packages', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
    ],
  },

  time_tracking: {
    label: 'Time Tracking',
    description: 'Timewarrior integration and time estimation attributes.',
    definitions: [
      { name: 'timetracked', label: 'Time Tracked', type: 'duration', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: true },
      { name: 'preptime', label: 'Prep Time', type: 'duration', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'expiring', label: 'Expiring In', type: 'duration', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'lifeofagreement', label: 'Life of Agreement', type: 'duration', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
    ],
  },

  analysis: {
    label: 'Analysis & Strategy',
    description: 'Research, risk assessment, and strategic planning.',
    definitions: [
      { name: 'research', label: 'Research', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'analysis', label: 'Analysis', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'strategicassessment', label: 'Strategic Assessment', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'technicalassessment', label: 'Technical Assessment', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'risks', label: 'Risks', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0.5, readOnly: false },
      { name: 'challenges', label: 'Challenges', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
      { name: 'results', label: 'Results', type: 'string', defaultValue: '', allowedValues: [], urgencyCoefficient: 0, readOnly: false },
    ],
  },

  full: {
    label: 'Full Babb Profile',
    description: 'All 150+ UDAs from the original babb taskrc — the complete set.',
    definitions: [], // populated dynamically via importFullBabbProfile()
  },
};

/**
 * Imports a template pack into the active profile.
 * Skips attributes that already exist (no duplicates).
 * Checks custom packs first (overrides built-in).
 * @param {string} profile
 * @param {string} packName - Key from TEMPLATE_PACKS or custom packs
 * @returns {Promise<{imported: number, skipped: number}>}
 */
export async function importTemplatePack(profile, packName) {
  // Check custom packs first (overrides built-in)
  const customPacks = await getCustomPacks(profile);
  let pack;
  if (customPacks[packName]) {
    pack = { label: packName, definitions: customPacks[packName] };
  } else {
    pack = TEMPLATE_PACKS[packName];
  }
  if (!pack) throw new Error(`Template pack "${packName}" not found`);

  const definitions = pack.definitions;
  let imported = 0, skipped = 0;

  for (const def of definitions) {
    try {
      await addAttribute(profile, { ...def, group: pack.label });
      imported++;
    } catch (e) {
      // Skip duplicates silently
      if (e.message.includes('already exists')) { skipped++; }
      else throw e;
    }
  }

  return { imported, skipped };
}

/**
 * Returns the list of available template pack names with metadata.
 * @returns {{name: string, label: string, description: string, count: number}[]}
 */
export function listTemplatePacks() {
  return Object.entries(TEMPLATE_PACKS).map(([name, pack]) => ({
    name,
    label: pack.label,
    description: pack.description,
    count: pack.definitions.length,
  }));
}


// ── Custom Template Packs ────────────────────────────────────────────────────

const CUSTOM_PACKS_KEY = 'custom_template_packs';

/**
 * Returns custom template packs saved for this profile.
 * @param {string} profile
 * @returns {Promise<Object>} Map of packName → definitions array
 */
export async function getCustomPacks(profile) {
  return (await getMeta(profile, CUSTOM_PACKS_KEY)) || {};
}

/**
 * Saves a custom template pack (overrides built-in if same name).
 * @param {string} profile
 * @param {string} packName
 * @param {AttributeDefinition[]} definitions
 * @returns {Promise<void>}
 */
export async function saveCustomPack(profile, packName, definitions) {
  const packs = await getCustomPacks(profile);
  packs[packName] = definitions;
  await setMeta(profile, CUSTOM_PACKS_KEY, packs);
}
