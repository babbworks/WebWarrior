// Lists service — simple todo lists (port of sjl/t)
// WORKER-SAFE: no DOM dependencies

import { getAll, put, remove, getMeta, setMeta } from '../../storage/db.js';

const STORE = 'lists';

export async function getLists(profile) {
  return (await getMeta(profile, 'lists')) || ['default'];
}

export async function addList(profile, name) {
  const lists = await getLists(profile);
  if (!lists.includes(name)) {
    lists.push(name);
    await setMeta(profile, 'lists', lists);
  }
}

export async function getItems(profile, { list = 'default', showDone = false } = {}) {
  const all = await getAll(profile, STORE);
  return all
    .filter(i => i.list === list && (showDone || !i.done))
    .sort((a, b) => new Date(a.created) - new Date(b.created));
}

export async function addItem(profile, text, list = 'default') {
  const item = { text, list, done: false, created: new Date().toISOString() };
  const id = await put(profile, STORE, item);
  return { ...item, id };
}

export async function finishItem(profile, id) {
  const all = await getAll(profile, STORE);
  const item = all.find(i => i.id === id);
  if (!item) throw new Error(`Item ${id} not found`);
  await put(profile, STORE, { ...item, done: true, finished: new Date().toISOString() });
}

export async function deleteItem(profile, id) {
  return remove(profile, STORE, id);
}

export async function editItem(profile, id, text) {
  const all = await getAll(profile, STORE);
  const item = all.find(i => i.id === id);
  if (!item) throw new Error(`Item ${id} not found`);
  await put(profile, STORE, { ...item, text });
}

export async function setNote(profile, id, note) {
  const all = await getAll(profile, STORE);
  const item = all.find(i => i.id === id);
  if (!item) throw new Error(`Item ${id} not found`);
  await put(profile, STORE, { ...item, note });
}

export async function deleteList(profile, name) {
  const lists = await getLists(profile);
  const updated = lists.filter(l => l !== name);
  await setMeta(profile, 'lists', updated.length ? updated : ['default']);
  // Remove all items in that list
  const all = await getAll(profile, STORE);
  await Promise.all(all.filter(i => i.list === name).map(i => remove(profile, STORE, i.id)));
}
