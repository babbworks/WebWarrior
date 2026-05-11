// Task engine — CRUD, filter, sort for a given profile

import { getAll, getOne, put, remove } from '../../storage/db.js';
import { computeUrgency } from '../../core/urgency.js';
import { getAttributes } from '../attributes/index.js';

const STORE = 'tasks';

function newUuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

export async function addTask(profile, fields) {
  const uuid = newUuid();
  const ts = now();
  const task = {
    uuid,
    status:    'pending',
    taskList:  fields.taskList  || 'main',
    description: fields.description || '',
    project:   fields.project   || '',
    tags:      parseTags(fields.tags),
    priority:  fields.priority  || '',
    due:       fields.due       || null,
    scheduled: fields.scheduled || null,
    wait:      fields.wait      || null,
    start:     null,
    end:       null,
    depends:   [],
    annotations: [],
    urgency:   0,
    modified:  ts,
    entry:     ts,
  };
  const udaDefinitions = await getAttributes(profile);
  task.urgency = computeUrgency(task, udaDefinitions);
  await put(profile, STORE, task);
  return task;
}

export async function getTask(profile, uuid) {
  return getOne(profile, STORE, uuid);
}

export async function updateTask(profile, uuid, updates) {
  const task = await getOne(profile, STORE, uuid);
  if (!task) throw new Error(`Task ${uuid} not found`);
  const updated = { ...task, ...updates, modified: now() };
  // Explicitly remove keys set to undefined (used for UDA deletion)
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) delete updated[k];
  }
  const udaDefinitions = await getAttributes(profile);
  updated.urgency = computeUrgency(updated, udaDefinitions);
  await put(profile, STORE, updated);
  return updated;
}

export async function completeTask(profile, uuid) {
  return updateTask(profile, uuid, { status: 'completed', end: now() });
}

export async function deleteTask(profile, uuid) {
  return remove(profile, STORE, uuid);
}

export async function startTask(profile, uuid) {
  return updateTask(profile, uuid, { status: 'active', start: now() });
}

export async function stopTask(profile, uuid) {
  return updateTask(profile, uuid, { status: 'pending', start: null });
}

export async function annotateTask(profile, uuid, text) {
  const task = await getOne(profile, STORE, uuid);
  if (!task) throw new Error(`Task ${uuid} not found`);
  const anns = [...(task.annotations || []), { entry: now(), description: text }];
  return updateTask(profile, uuid, { annotations: anns });
}

export async function getTasks(profile, { includeDone = false, taskList = null } = {}) {
  const all = await getAll(profile, STORE);
  return all
    .filter(t => {
      if (!includeDone && t.status !== 'pending' && t.status !== 'active') return false;
      // null means "all lists" (used by warrior/next/tags); otherwise filter by list
      // tasks without taskList field are treated as 'main'
      if (taskList !== null && (t.taskList || 'main') !== taskList) return false;
      return true;
    })
    .sort((a, b) => b.urgency - a.urgency);
}

export async function getProjects(profile) {
  const tasks = await getAll(profile, STORE);
  const map = new Map();
  for (const t of tasks) {
    if (!t.project) continue;
    if (!map.has(t.project)) map.set(t.project, { name: t.project, total: 0, pending: 0, completed: 0 });
    const p = map.get(t.project);
    p.total++;
    if (t.status === 'completed') p.completed++;
    else p.pending++;
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTags(profile) {
  const tasks = await getAll(profile, STORE);
  const map = new Map();
  for (const t of tasks) {
    for (const tag of (t.tags || [])) {
      map.set(tag, (map.get(tag) || 0) + 1);
    }
  }
  return [...map.entries()].map(([name, count]) => ({ name, count }));
}

// ── Bulk operations ──────────────────────────────────────────────────────────

export async function bulkComplete(profile, uuids) {
  return Promise.all(uuids.map(id => completeTask(profile, id)));
}

export async function bulkDelete(profile, uuids) {
  return Promise.all(uuids.map(id => deleteTask(profile, id)));
}

export async function bulkSetProject(profile, uuids, project) {
  return Promise.all(uuids.map(id => updateTask(profile, id, { project })));
}

export async function bulkAddTag(profile, uuids, tag) {
  return Promise.all(uuids.map(async id => {
    const t = await getTask(profile, id);
    if (!t) return;
    const tags = [...new Set([...(t.tags || []), tag])];
    return updateTask(profile, id, { tags });
  }));
}

export async function bulkRemoveTag(profile, uuids, tag) {
  return Promise.all(uuids.map(async id => {
    const t = await getTask(profile, id);
    if (!t) return;
    const tags = (t.tags || []).filter(tg => tg !== tag);
    return updateTask(profile, id, { tags });
  }));
}

export async function bulkSetPriority(profile, uuids, priority) {
  return Promise.all(uuids.map(id => updateTask(profile, id, { priority })));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return raw.split(/[\s,]+/).filter(Boolean);
}
