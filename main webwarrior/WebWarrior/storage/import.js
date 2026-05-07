// Import from existing ww/Workwarrior folder via File System Access API

import { createProfile, listProfiles, addJournal, addLedger } from './profiles.js';
import { putMany, put } from './db.js';

export async function importFromFolder(onProgress) {
  if (!window.showDirectoryPicker) {
    throw new Error('File System Access API not available in this browser');
  }

  const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  const results = { profiles: [], errors: [] };

  const log = (msg, type = 'info') => {
    onProgress?.({ msg, type });
  };

  // Find the profiles/ subdirectory
  let profilesDir = null;
  try {
    profilesDir = await dirHandle.getDirectoryHandle('profiles');
    log('Found profiles/ directory');
  } catch {
    // Maybe the user opened the profiles/ dir directly or the root is profiles
    profilesDir = dirHandle;
    log('Using root as profiles directory');
  }

  // Enumerate profile directories
  for await (const [name, handle] of profilesDir.entries()) {
    if (handle.kind !== 'directory') continue;
    log(`Importing profile: ${name}`);

    try {
      // Ensure profile exists
      const existing = listProfiles();
      if (!existing.includes(name)) {
        await createProfile(name);
        log(`  Created profile: ${name}`, 'ok');
      } else {
        log(`  Profile exists, merging: ${name}`);
      }

      // Import tasks
      await importTasks(name, handle, log);

      // Import time intervals
      await importTimewarrior(name, handle, log);

      // Import journals
      await importJournals(name, handle, log);

      // Import ledgers
      await importLedgers(name, handle, log);

      results.profiles.push(name);
    } catch (err) {
      log(`  Error importing ${name}: ${err.message}`, 'error');
      results.errors.push({ profile: name, error: err.message });
    }
  }

  return results;
}

// ── Tasks ────────────────────────────────────────────────────────────────────

async function importTasks(profile, profileDir, log) {
  let taskDir;
  try { taskDir = await profileDir.getDirectoryHandle('.task'); } catch { return; }

  const tasks = [];
  for (const fname of ['pending.data', 'completed.data']) {
    let fh;
    try { fh = await taskDir.getFileHandle(fname); } catch { continue; }
    const text = await (await fh.getFile()).text();
    for (const line of text.split('\n')) {
      const t = parseTaskwarriorLine(line.trim());
      if (t) tasks.push(t);
    }
  }

  if (tasks.length > 0) {
    await putMany(profile, 'tasks', tasks);
    log(`  Tasks: imported ${tasks.length}`, 'ok');
  }
}

function parseTaskwarriorLine(line) {
  if (!line || !line.startsWith('[')) return null;
  try {
    // Taskwarrior NDJSON-ish: [key:"value" key2:"value2" ...]
    const obj = {};
    const re = /(\w+):"([^"]*)"/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      obj[m[1]] = m[2];
    }
    if (!obj.uuid) return null;
    return {
      uuid:        obj.uuid,
      status:      obj.status || 'pending',
      description: obj.description || '',
      project:     obj.project || '',
      tags:        obj.tags ? obj.tags.replace(/,/g, ' ').split(' ').filter(Boolean) : [],
      priority:    obj.priority || '',
      due:         obj.due ? twDateToISO(obj.due) : null,
      scheduled:   obj.scheduled ? twDateToISO(obj.scheduled) : null,
      wait:        obj.wait ? twDateToISO(obj.wait) : null,
      start:       obj.start ? twDateToISO(obj.start) : null,
      end:         obj.end ? twDateToISO(obj.end) : null,
      depends:     obj.depends ? obj.depends.split(',').filter(Boolean) : [],
      annotations: parseAnnotations(obj.annotation || ''),
      urgency:     parseFloat(obj.urgency) || 0,
      modified:    obj.modified ? twDateToISO(obj.modified) : new Date().toISOString(),
      entry:       obj.entry ? twDateToISO(obj.entry) : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function twDateToISO(tw) {
  // Taskwarrior format: 20260506T090000Z
  if (!tw || tw.length < 8) return null;
  try {
    const s = tw.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?/, '$1-$2-$3T$4:$5:$6Z');
    return new Date(s).toISOString();
  } catch { return null; }
}

function parseAnnotations(raw) {
  if (!raw) return [];
  // Format: "timestamp text|timestamp text"
  return raw.split('|').map(a => {
    const m = a.match(/^(\d+)\s+(.*)/);
    if (!m) return null;
    return { entry: new Date(parseInt(m[1]) * 1000).toISOString(), description: m[2] };
  }).filter(Boolean);
}

// ── TimeWarrior ──────────────────────────────────────────────────────────────

async function importTimewarrior(profile, profileDir, log) {
  let twDir;
  try { twDir = await profileDir.getDirectoryHandle('.timewarrior'); } catch { return; }
  let dataDir;
  try { dataDir = await twDir.getDirectoryHandle('data'); } catch { return; }

  const intervals = [];
  for await (const [fname, fh] of dataDir.entries()) {
    if (fh.kind !== 'file' || !fname.endsWith('.data')) continue;
    const text = await (await fh.getFile()).text();
    for (const line of text.split('\n')) {
      const i = parseTimewLine(line.trim());
      if (i) intervals.push(i);
    }
  }

  if (intervals.length > 0) {
    await putMany(profile, 'time_intervals', intervals);
    log(`  Time: imported ${intervals.length} intervals`, 'ok');
  }
}

function parseTimewLine(line) {
  if (!line || !line.startsWith('inc')) return null;
  try {
    // Format: inc 20260506T090000Z - 20260506T120000Z # tag1 tag2
    const m = line.match(/^inc\s+(\S+)\s+-\s+(\S+)(?:\s+#\s*(.*))?/);
    if (!m) return null;
    return {
      start:      twDateToISO(m[1]),
      end:        m[2] === '' ? null : twDateToISO(m[2]),
      tags:       m[3] ? m[3].trim().split(/\s+/).filter(Boolean) : [],
      annotation: '',
    };
  } catch { return null; }
}

// ── Journals ─────────────────────────────────────────────────────────────────

async function importJournals(profile, profileDir, log) {
  let journalDir;
  try { journalDir = await profileDir.getDirectoryHandle('journals'); } catch { return; }

  let count = 0;
  for await (const [fname, fh] of journalDir.entries()) {
    if (fh.kind !== 'file') continue;
    const journalName = fname.replace(/\.txt$/, '');
    await addJournal(profile, journalName);
    const text = await (await fh.getFile()).text();
    const entries = parseJrnlFile(text, journalName);
    if (entries.length > 0) {
      await putMany(profile, 'journal_entries', entries);
      count += entries.length;
    }
  }
  if (count > 0) log(`  Journal: imported ${count} entries`, 'ok');
}

function parseJrnlFile(text, journal) {
  const entries = [];
  // JRNL format: [2026-05-06 14:23] Entry body
  const re = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s*(.*)/;
  let current = null;

  for (const line of text.split('\n')) {
    const m = line.match(re);
    if (m) {
      if (current) entries.push(current);
      current = {
        date:        new Date(m[1]).toISOString(),
        body:        m[2],
        journal,
        project:     '',
        tags:        [],
        priority:    '',
        annotations: [],
        archived:    false,
      };
    } else if (current && line.trim()) {
      current.body += '\n' + line;
    }
  }
  if (current) entries.push(current);
  return entries;
}

// ── Ledgers ──────────────────────────────────────────────────────────────────

async function importLedgers(profile, profileDir, log) {
  let ledgerDir;
  try { ledgerDir = await profileDir.getDirectoryHandle('ledgers'); } catch { return; }

  let count = 0;
  for await (const [fname, fh] of ledgerDir.entries()) {
    if (fh.kind !== 'file') continue;
    const ledgerName = fname.replace(/\.txt$|\.journal$|\.ledger$/, '');
    await addLedger(profile, ledgerName);
    const text = await (await fh.getFile()).text();
    const txns = parseHledgerFile(text, ledgerName);
    if (txns.length > 0) {
      await putMany(profile, 'ledger_transactions', txns);
      count += txns.length;
    }
  }
  if (count > 0) log(`  Ledger: imported ${count} transactions`, 'ok');
}

function parseHledgerFile(text, ledger) {
  const txns = [];
  const lines = text.split('\n');
  let current = null;

  for (const raw of lines) {
    // Transaction header: YYYY-MM-DD description
    const header = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)/);
    if (header && !raw.startsWith(' ') && !raw.startsWith('\t')) {
      if (current) txns.push(current);
      current = {
        date:        header[1],
        description: header[2].trim(),
        ledger,
        postings:    [],
        comment:     '',
      };
      continue;
    }

    // Posting: "  account  amount"
    if (current && (raw.startsWith('  ') || raw.startsWith('\t'))) {
      const posting = raw.trim();
      if (!posting || posting.startsWith(';')) continue;
      const pm = posting.match(/^(\S+(?::\S+)*)\s+([-\d$,.]+(?:\s+\w+)?)/);
      if (pm) {
        const amtStr = pm[2].replace(/[$,]/g, '').trim();
        const amt = parseFloat(amtStr.split(/\s+/)[0]);
        current.postings.push({
          account: pm[1],
          amount:  isNaN(amt) ? 0 : amt,
          comment: '',
        });
      } else if (posting) {
        // No amount — will be balanced automatically (we skip for now)
        current.postings.push({ account: posting, amount: 0, comment: '' });
      }
    }
  }
  if (current && current.postings.length > 0) txns.push(current);
  return txns;
}

// ── Demo data ────────────────────────────────────────────────────────────────

export async function loadDemoData(profile) {
  const { computeUrgency } = await import('../core/urgency.js');
  const now = new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const tasks = [
    { uuid: crypto.randomUUID(), status: 'pending', description: 'Set up Webwarrior', project: 'setup', tags: ['onboarding'], priority: 'H', due: tomorrow, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [{ entry: now, description: 'Created from demo data' }], urgency: 0, modified: now, entry: now },
    { uuid: crypto.randomUUID(), status: 'pending', description: 'Explore the Tasks section', project: 'setup', tags: ['onboarding'], priority: 'M', due: null, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [], urgency: 0, modified: now, entry: now },
    { uuid: crypto.randomUUID(), status: 'pending', description: 'Add a journal entry about today', project: '', tags: ['writing'], priority: 'L', due: null, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [], urgency: 0, modified: now, entry: now },
    { uuid: crypto.randomUUID(), status: 'pending', description: 'Try time tracking — start and stop a session', project: 'demo', tags: ['time'], priority: 'M', due: null, scheduled: null, wait: null, start: null, end: null, depends: [], annotations: [], urgency: 0, modified: now, entry: now },
    { uuid: crypto.randomUUID(), status: 'completed', description: 'Install Webwarrior', project: 'setup', tags: ['onboarding'], priority: 'H', due: null, scheduled: null, wait: null, start: null, end: now, depends: [], annotations: [], urgency: 0, modified: now, entry: now },
  ];
  tasks.forEach(t => { t.urgency = computeUrgency(t); });

  const intervals = [
    { start: new Date(Date.now() - 7200000).toISOString(), end: new Date(Date.now() - 3600000).toISOString(), tags: ['demo', 'setup'], annotation: 'Getting started' },
  ];

  const journalEntries = [
    { date: now, body: 'Started using Webwarrior today. All data is stored locally in the browser — no server needed.', journal: 'main', project: 'setup', tags: ['onboarding'], priority: '', annotations: [], archived: false },
    { date: new Date(Date.now() - 86400000).toISOString(), body: 'Discovered Webwarrior, a browser-native productivity app inspired by ww / Workwarrior.', journal: 'main', project: '', tags: [], priority: '', annotations: [], archived: false },
  ];

  const transactions = [
    { date: today, description: 'Opening balance', ledger: 'main', postings: [{ account: 'assets:bank', amount: 1000, comment: '' }, { account: 'equity:opening-balances', amount: -1000, comment: '' }], comment: '' },
    { date: today, description: 'Coffee', ledger: 'main', postings: [{ account: 'expenses:food', amount: 4.50, comment: 'morning coffee' }, { account: 'assets:bank', amount: -4.50, comment: '' }], comment: '' },
  ];

  await putMany(profile, 'tasks', tasks);
  await putMany(profile, 'time_intervals', intervals);
  await putMany(profile, 'journal_entries', journalEntries);
  await putMany(profile, 'ledger_transactions', transactions);
}
