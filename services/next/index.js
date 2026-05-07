// Next service — recommend the single best task to work on now
// WORKER-SAFE: no DOM dependencies

import { getAll } from '../../storage/db.js';

const STORE = 'tasks';

export async function getNext(profile) {
  const all = await getAll(profile, STORE);
  const now = new Date();

  const candidates = all.filter(t => {
    if (t.status !== 'pending' && t.status !== 'active') return false;
    if (t.wait && new Date(t.wait) > now) return false;
    if (t.scheduled && new Date(t.scheduled) > now) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  // Sort: active first, then by urgency desc
  candidates.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (b.status === 'active' && a.status !== 'active') return  1;
    return b.urgency - a.urgency;
  });

  const task = candidates[0];
  return { task, rationale: buildRationale(task, candidates.length) };
}

export async function getUpcoming(profile, days = 7) {
  const all = await getAll(profile, STORE);
  const cutoff = new Date(Date.now() + days * 86400000);
  return all
    .filter(t => t.status === 'pending' && t.due && new Date(t.due) <= cutoff)
    .sort((a, b) => new Date(a.due) - new Date(b.due))
    .slice(0, 10);
}

export async function getOverdue(profile) {
  const all = await getAll(profile, STORE);
  const now = new Date();
  return all
    .filter(t => t.status === 'pending' && t.due && new Date(t.due) < now)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
}

function buildRationale(task, total) {
  const parts = [];
  if (task.status === 'active') parts.push('currently active');
  if (task.priority === 'H')    parts.push('high priority');
  if (task.due) {
    const days = (new Date(task.due) - Date.now()) / 86400000;
    if (days < 0)       parts.push('overdue');
    else if (days <= 1) parts.push('due today');
    else if (days <= 3) parts.push(`due in ${Math.ceil(days)}d`);
  }
  parts.push(`urgency ${task.urgency.toFixed(1)}`);
  parts.push(`${total} pending`);
  return parts.join(' · ');
}
