// Profile management — profile list in localStorage, one IndexedDB per profile

import { openDb, closeDb, deleteDb, getAll, getMeta, setMeta } from './db.js';

const LS_PROFILES = 'ww_profiles';
const LS_ACTIVE   = 'ww_active_profile';

export function listProfiles() {
  try {
    return JSON.parse(localStorage.getItem(LS_PROFILES) || '[]');
  } catch {
    return [];
  }
}

function saveProfiles(list) {
  localStorage.setItem(LS_PROFILES, JSON.stringify(list));
}

export function getActive() {
  return localStorage.getItem(LS_ACTIVE) || null;
}

export function setActive(name) {
  localStorage.setItem(LS_ACTIVE, name);
}

export async function createProfile(name) {
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid profile name');
  const list = listProfiles();
  if (list.includes(name)) throw new Error(`Profile "${name}" already exists`);
  list.push(name);
  saveProfiles(list);
  await openDb(name);
  await setMeta(name, 'created_at', new Date().toISOString());
  await setMeta(name, 'journals',    ['main']);
  await setMeta(name, 'ledgers',     ['main']);
  await setMeta(name, 'task_lists',  ['main']);
  await setMeta(name, 'time_logs',   ['main']);
  return name;
}

export async function deleteProfile(name) {
  const list = listProfiles().filter(p => p !== name);
  saveProfiles(list);
  if (getActive() === name) {
    const next = list[0] || null;
    if (next) setActive(next); else localStorage.removeItem(LS_ACTIVE);
  }
  await deleteDb(name);
}

export async function getProfileStats(name) {
  try {
    const [tasks, intervals, entries, txns] = await Promise.all([
      getAll(name, 'tasks'),
      getAll(name, 'time_intervals'),
      getAll(name, 'journal_entries'),
      getAll(name, 'ledger_transactions'),
    ]);
    return {
      tasks:    tasks.filter(t => t.status === 'pending' || t.status === 'active').length,
      time:     intervals.length,
      journal:  entries.length,
      ledger:   txns.length,
    };
  } catch {
    return { tasks: 0, time: 0, journal: 0, ledger: 0 };
  }
}

export async function ensureDefaultProfile() {
  let list = listProfiles();
  if (list.length === 0) {
    await createProfile('default');
    list = ['default'];
  }
  if (!getActive() || !list.includes(getActive())) {
    setActive(list[0]);
  }
  return getActive();
}

export async function getJournals(profile) {
  return (await getMeta(profile, 'journals')) || ['main'];
}

export async function addJournal(profile, name) {
  const journals = await getJournals(profile);
  if (!journals.includes(name)) {
    journals.push(name);
    await setMeta(profile, 'journals', journals);
  }
}

export async function getLedgers(profile) {
  return (await getMeta(profile, 'ledgers')) || ['main'];
}

export async function addLedger(profile, name) {
  const ledgers = await getLedgers(profile);
  if (!ledgers.includes(name)) {
    ledgers.push(name);
    await setMeta(profile, 'ledgers', ledgers);
  }
}

export async function getTaskLists(profile) {
  return (await getMeta(profile, 'task_lists')) || ['main'];
}

export async function addTaskList(profile, name) {
  const lists = await getTaskLists(profile);
  if (!lists.includes(name)) {
    lists.push(name);
    await setMeta(profile, 'task_lists', lists);
  }
}

export async function removeTaskList(profile, name) {
  if (name === 'main') throw new Error('Cannot remove the main task list');
  const lists = (await getTaskLists(profile)).filter(l => l !== name);
  await setMeta(profile, 'task_lists', lists.length ? lists : ['main']);
}

export async function getTimeLogs(profile) {
  return (await getMeta(profile, 'time_logs')) || ['main'];
}

export async function addTimeLog(profile, name) {
  const logs = await getTimeLogs(profile);
  if (!logs.includes(name)) {
    logs.push(name);
    await setMeta(profile, 'time_logs', logs);
  }
}

export async function removeTimeLog(profile, name) {
  if (name === 'main') throw new Error('Cannot remove the main time log');
  const logs = (await getTimeLogs(profile)).filter(l => l !== name);
  await setMeta(profile, 'time_logs', logs.length ? logs : ['main']);
}

export async function getUdaKeys(profile) {
  return (await getMeta(profile, 'uda_keys')) || [];
}

export async function addUdaKey(profile, key) {
  const keys = await getUdaKeys(profile);
  if (!keys.includes(key)) {
    keys.push(key);
    await setMeta(profile, 'uda_keys', keys);
  }
}

export async function getQuestionLists(profile) {
  return (await getMeta(profile, 'question_lists')) || ['default'];
}

export async function addQuestionList(profile, name) {
  const lists = await getQuestionLists(profile);
  if (!lists.includes(name)) {
    lists.push(name);
    await setMeta(profile, 'question_lists', lists);
  }
}

export async function removeQuestionList(profile, name) {
  if (name === 'default') throw new Error('Cannot remove the default question list');
  const lists = (await getQuestionLists(profile)).filter(l => l !== name);
  await setMeta(profile, 'question_lists', lists.length ? lists : ['default']);
}
