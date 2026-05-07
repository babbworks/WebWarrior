// Journal engine — timestamped entries with annotations, named journals

import { getAll, getOne, put, remove } from '../../storage/db.js';

const STORE = 'journal_entries';

function now() { return new Date().toISOString(); }

export async function addEntry(profile, { body, journal = 'main', project = '', tags = '', priority = '' } = {}) {
  const entry = {
    date:        now(),
    body:        body || '',
    journal,
    project:     project || '',
    tags:        parseTags(tags),
    priority:    priority || '',
    annotations: [],
    archived:    false,
  };
  const id = await put(profile, STORE, entry);
  return { ...entry, id };
}

export async function annotateEntry(profile, id, text) {
  const all = await getAll(profile, STORE);
  const entry = all.find(e => e.id === id);
  if (!entry) throw new Error(`Entry ${id} not found`);
  const annotations = [...(entry.annotations || []), { entry: now(), text }];
  const updated = { ...entry, annotations };
  await put(profile, STORE, updated);
  return updated;
}

export async function updateEntry(profile, id, updates) {
  const all = await getAll(profile, STORE);
  const entry = all.find(e => e.id === id);
  if (!entry) throw new Error(`Entry ${id} not found`);
  const tags = updates.tags !== undefined
    ? parseTags(updates.tags)
    : entry.tags;
  const updated = { ...entry, ...updates, tags, modified: now() };
  await put(profile, STORE, updated);
  return updated;
}

export async function deleteEntry(profile, id) {
  return remove(profile, STORE, id);
}

export async function archiveEntry(profile, id, archived = true) {
  const all = await getAll(profile, STORE);
  const entry = all.find(e => e.id === id);
  if (!entry) throw new Error(`Entry ${id} not found`);
  const updated = { ...entry, archived };
  await put(profile, STORE, updated);
  return updated;
}

export async function getEntry(profile, id) {
  return getOne(profile, STORE, id);
}

export async function getEntries(profile, { journal = null, search = '', showArchived = false, limit = 200 } = {}) {
  const all = await getAll(profile, STORE);
  return all
    .filter(e => {
      if (!showArchived && e.archived) return false;
      if (journal && e.journal !== journal) return false;
      if (search) {
        const q = search.toLowerCase();
        return e.body.toLowerCase().includes(q) ||
               (e.project || '').toLowerCase().includes(q) ||
               (e.tags || []).join(' ').toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
}

// Group entries by date (YYYY-MM-DD)
export function groupByDate(entries) {
  const groups = new Map();
  for (const e of entries) {
    const day = e.date.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(e);
  }
  return [...groups.entries()].map(([date, entries]) => ({ date, entries }));
}

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return raw.split(/[\s,]+/).filter(Boolean);
}
