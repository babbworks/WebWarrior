// Community service — cross-profile shared collections
// Mirrors the SQLite community schema from ww, ported to IndexedDB
// WORKER-SAFE: no DOM dependencies
//
// Storage: uses a dedicated 'community' profile key (ww_community)
// so community data spans profiles rather than living in one profile's DB.
// The community DB is a special profile named '__community__'.

import { openDb, getAll, put, remove, getMeta, setMeta } from '../../storage/db.js';

const COMM_PROFILE = '__community__';

// Bootstrap the community DB with its own object stores
// We piggyback on the normal db.js open, but community uses custom stores
// via a separate database 'ww_community' at db version 1.

const COMM_DB_NAME = 'ww_community';
const COMM_DB_VERSION = 2;

let _commDb = null;

async function getCommDb() {
  if (_commDb) return _commDb;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(COMM_DB_NAME, COMM_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('collections')) {
        db.createObjectStore('collections', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        s.createIndex('collection', 'collection_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('comments')) {
        const s = db.createObjectStore('comments', { keyPath: 'id', autoIncrement: true });
        s.createIndex('entry', 'entry_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('private_notes')) {
        const s = db.createObjectStore('private_notes', { keyPath: 'id', autoIncrement: true });
        s.createIndex('entry', 'entry_id', { unique: false });
      }
    };
    req.onsuccess = (e) => { _commDb = e.target.result; resolve(_commDb); };
    req.onerror = () => reject(req.error);
  });
}

function txn(stores, mode, fn) {
  return getCommDb().then(db =>
    new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      t.onerror = () => reject(t.error);
      resolve(fn(t));
    })
  );
}

function storeAll(t, store) {
  return new Promise((res, rej) => {
    const req = t.objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function storePut(t, store, record) {
  return new Promise((res, rej) => {
    const req = t.objectStore(store).put(record);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function storeDel(t, store, key) {
  return new Promise((res, rej) => {
    const req = t.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

// ── Collections ───────────────────────────────────────────────────────────────

export async function listCollections() {
  return txn(['collections'], 'readonly', t => storeAll(t, 'collections'));
}

export async function createCollection(name, description = '') {
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid collection name');
  return txn(['collections'], 'readwrite', t =>
    storePut(t, 'collections', {
      name,
      description,
      created_at:  new Date().toISOString(),
      archived_at: null,
    })
  );
}

export async function archiveCollection(id, archived = true) {
  const colls = await listCollections();
  const c = colls.find(c => c.id === id);
  if (!c) throw new Error('Collection not found');
  return txn(['collections'], 'readwrite', t =>
    storePut(t, 'collections', { ...c, archived_at: archived ? new Date().toISOString() : null })
  );
}

export async function describeCollection(id, description) {
  const colls = await listCollections();
  const c = colls.find(c => c.id === id);
  if (!c) throw new Error('Collection not found');
  return txn(['collections'], 'readwrite', t =>
    storePut(t, 'collections', { ...c, description })
  );
}

// ── Entries ───────────────────────────────────────────────────────────────────

export async function getEntries(collectionId, { view = 'unified' } = {}) {
  const allEntries = await txn(['entries'], 'readonly', t => storeAll(t, 'entries'));
  let entries = allEntries.filter(e => e.collection_id === collectionId);
  if (view === 'journal') entries = entries.filter(e => e.type === 'journal');
  if (view === 'tasks')   entries = entries.filter(e => e.type === 'task');
  // attach comments
  const allComments = await txn(['comments'], 'readonly', t => storeAll(t, 'comments'));
  return entries
    .sort((a, b) => new Date(b.added_at) - new Date(a.added_at))
    .map(e => ({
      ...e,
      comments: allComments.filter(c => c.entry_id === e.id),
    }));
}

export async function addEntry(collectionId, { type, profile, content, tags = '', priority = '', project = '' } = {}) {
  return txn(['entries'], 'readwrite', t =>
    storePut(t, 'entries', {
      collection_id: collectionId,
      type,           // 'task' | 'journal' | 'ledger'
      profile,
      content,        // snapshot of the source item at time of capture
      source_ref:     buildRef(type, profile, content),
      tags:           parseTags(tags),
      priority:       priority || '',
      project:        project  || '',
      added_at:       new Date().toISOString(),
    })
  );
}

export async function refreshEntry(entryId, newContent) {
  const allEntries = await txn(['entries'], 'readonly', t => storeAll(t, 'entries'));
  const entry = allEntries.find(e => e.id === entryId);
  if (!entry) throw new Error('Entry not found');
  return txn(['entries'], 'readwrite', t =>
    storePut(t, 'entries', { ...entry, content: newContent, refreshed_at: new Date().toISOString() })
  );
}

export async function removeEntry(entryId) {
  return txn(['entries', 'comments'], 'readwrite', async t => {
    // remove comments first
    const comments = await new Promise((res, rej) => {
      const req = t.objectStore('comments').index('entry').getAll(entryId);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
    await Promise.all(comments.map(c => storeDel(t, 'comments', c.id)));
    return storeDel(t, 'entries', entryId);
  });
}

// ── Comments ──────────────────────────────────────────────────────────────────

export async function addComment(entryId, body, profile) {
  return txn(['comments'], 'readwrite', t =>
    storePut(t, 'comments', {
      entry_id:   entryId,
      body,
      profile,
      created_at: new Date().toISOString(),
    })
  );
}

export async function deleteComment(commentId) {
  return txn(['comments'], 'readwrite', t => storeDel(t, 'comments', commentId));
}

// ── Private Notes ─────────────────────────────────────────────────────────────
// Private notes are local-only annotations that never get shared or exported
// with the community entry content.

export async function getPrivateNotes(entryId) {
  const allNotes = await txn(['private_notes'], 'readonly', t => storeAll(t, 'private_notes'));
  return allNotes
    .filter(n => n.entry_id === entryId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export async function addPrivateNote(entryId, body, profile) {
  return txn(['private_notes'], 'readwrite', t =>
    storePut(t, 'private_notes', {
      entry_id:   entryId,
      body,
      profile,
      created_at: new Date().toISOString(),
    })
  );
}

export async function deletePrivateNote(noteId) {
  return txn(['private_notes'], 'readwrite', t => storeDel(t, 'private_notes', noteId));
}

// ── Cross-posting helpers ─────────────────────────────────────────────────────

// Build a string ref that identifies the source item (for copy-back)
function buildRef(type, profile, content) {
  if (type === 'task')    return `${profile}.task.${content.uuid}`;
  if (type === 'journal') return `${profile}.journal.${content.id}`;
  if (type === 'ledger')  return `${profile}.ledger.${content.id}`;
  return `${profile}.${type}.unknown`;
}

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return raw.split(/[\s,]+/).filter(Boolean);
}
