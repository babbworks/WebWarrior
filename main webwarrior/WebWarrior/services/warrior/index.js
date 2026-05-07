// Warrior service — cross-profile statistics overview
// WORKER-SAFE: no DOM dependencies

import { openDb, getAll } from '../../storage/db.js';
import { listProfiles } from '../../storage/profiles.js';

export async function getWarriorStats() {
  const profiles = listProfiles();
  const stats = await Promise.all(profiles.map(p => profileStats(p)));
  const totals = stats.reduce((acc, s) => {
    acc.tasks    += s.tasks;
    acc.active   += s.active;
    acc.overdue  += s.overdue;
    acc.time     += s.time;
    acc.journal  += s.journal;
    acc.ledger   += s.ledger;
    return acc;
  }, { tasks: 0, active: 0, overdue: 0, time: 0, journal: 0, ledger: 0 });

  return { profiles: stats, totals };
}

async function profileStats(profile) {
  try {
    await openDb(profile);
    const [tasks, intervals, entries, txns] = await Promise.all([
      getAll(profile, 'tasks'),
      getAll(profile, 'time_intervals'),
      getAll(profile, 'journal_entries'),
      getAll(profile, 'ledger_transactions'),
    ]);

    const now = new Date();
    const pending  = tasks.filter(t => t.status === 'pending' || t.status === 'active');
    const active   = tasks.filter(t => t.status === 'active');
    const overdue  = pending.filter(t => t.due && new Date(t.due) < now);
    const todayStr = now.toDateString();
    const todaySecs = intervals
      .filter(i => new Date(i.start).toDateString() === todayStr)
      .reduce((s, i) => s + intervalSecs(i), 0);

    return {
      profile,
      tasks:   pending.length,
      active:  active.length,
      overdue: overdue.length,
      time:    todaySecs,
      journal: entries.filter(e => !e.archived).length,
      ledger:  txns.length,
      topTask: pending.sort((a, b) => b.urgency - a.urgency)[0] || null,
    };
  } catch {
    return { profile, tasks: 0, active: 0, overdue: 0, time: 0, journal: 0, ledger: 0, topTask: null };
  }
}

function intervalSecs(i) {
  const end = i.end ? new Date(i.end) : new Date();
  return (end - new Date(i.start)) / 1000;
}
