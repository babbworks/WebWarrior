// IndexedDB abstraction — one database per profile: ww_profile_<name>

const DB_VERSION = 2;

const STORES = {
  tasks:              { keyPath: 'uuid' },
  time_intervals:     { keyPath: 'id', autoIncrement: true },
  journal_entries:    { keyPath: 'id', autoIncrement: true },
  ledger_transactions:{ keyPath: 'id', autoIncrement: true },
  accounts:           { keyPath: 'name' },
  profile_meta:       { keyPath: 'key' },
  lists:              { keyPath: 'id', autoIncrement: true },
};

const INDEXES = {
  tasks:           [{ name: 'status', keyPath: 'status' }, { name: 'project', keyPath: 'project' }],
  time_intervals:  [{ name: 'start',  keyPath: 'start' }],
  journal_entries: [{ name: 'date',   keyPath: 'date' }, { name: 'journal', keyPath: 'journal' }],
  ledger_transactions: [{ name: 'date', keyPath: 'date' }],
};

const openDbs = new Map();

export function dbName(profile) {
  return `ww_profile_${profile}`;
}

export function openDb(profile) {
  if (openDbs.has(profile)) return Promise.resolve(openDbs.get(profile));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(profile), DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const [storeName, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, opts);
          for (const idx of (INDEXES[storeName] || [])) {
            store.createIndex(idx.name, idx.keyPath, { unique: false });
          }
        }
      }
    };
    req.onsuccess = (e) => {
      openDbs.set(profile, e.target.result);
      resolve(e.target.result);
    };
    req.onerror = () => reject(req.error);
  });
}

export function closeDb(profile) {
  const db = openDbs.get(profile);
  if (db) { db.close(); openDbs.delete(profile); }
}

export async function deleteDb(profile) {
  closeDb(profile);
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName(profile));
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });
}

// Low-level helpers

async function tx(profile, stores, mode, fn) {
  const db = await openDb(profile);
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    t.onerror = () => reject(t.error);
    resolve(fn(t));
  });
}

export async function getAll(profile, store) {
  return tx(profile, [store], 'readonly', (t) =>
    new Promise((res, rej) => {
      const req = t.objectStore(store).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    })
  );
}

export async function getAllByIndex(profile, store, indexName, value) {
  return tx(profile, [store], 'readonly', (t) =>
    new Promise((res, rej) => {
      const req = t.objectStore(store).index(indexName).getAll(value);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    })
  );
}

export async function getOne(profile, store, key) {
  return tx(profile, [store], 'readonly', (t) =>
    new Promise((res, rej) => {
      const req = t.objectStore(store).get(key);
      req.onsuccess = () => res(req.result ?? null);
      req.onerror = () => rej(req.error);
    })
  );
}

export async function put(profile, store, record) {
  return tx(profile, [store], 'readwrite', (t) =>
    new Promise((res, rej) => {
      const req = t.objectStore(store).put(record);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    })
  );
}

export async function putMany(profile, store, records) {
  return tx(profile, [store], 'readwrite', (t) =>
    Promise.all(records.map(r =>
      new Promise((res, rej) => {
        const req = t.objectStore(store).put(r);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      })
    ))
  );
}

export async function remove(profile, store, key) {
  return tx(profile, [store], 'readwrite', (t) =>
    new Promise((res, rej) => {
      const req = t.objectStore(store).delete(key);
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
    })
  );
}

export async function getMeta(profile, key) {
  const row = await getOne(profile, 'profile_meta', key);
  return row ? row.value : null;
}

export async function setMeta(profile, key, value) {
  return put(profile, 'profile_meta', { key, value });
}
