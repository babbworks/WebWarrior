// Time tracking engine — intervals, start/stop/track, summaries

import { getAll, put, remove, getOne } from '../storage/db.js';

const STORE = 'time_intervals';

function now() { return new Date().toISOString(); }

function parseDuration(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2] || 'm';
  if (unit.startsWith('h')) return n * 3600;
  if (unit.startsWith('s')) return n;
  return n * 60;
}

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return raw.split(/[\s,]+/).filter(Boolean);
}

export async function getActiveInterval(profile) {
  const all = await getAll(profile, STORE);
  return all.find(i => !i.end) || null;
}

export async function startTracking(profile, tags, annotation = '') {
  const active = await getActiveInterval(profile);
  if (active) await stopTracking(profile);
  const interval = { start: now(), end: null, tags: parseTags(tags), annotation };
  const id = await put(profile, STORE, interval);
  return { ...interval, id };
}

export async function stopTracking(profile) {
  const active = await getActiveInterval(profile);
  if (!active) return null;
  const ended = { ...active, end: now() };
  await put(profile, STORE, ended);
  return ended;
}

export async function trackInterval(profile, tags, durationStr, annotation = '') {
  const secs = parseDuration(durationStr);
  if (!secs) throw new Error(`Cannot parse duration: "${durationStr}"`);
  const end = new Date();
  const start = new Date(end.getTime() - secs * 1000);
  const interval = { start: start.toISOString(), end: end.toISOString(), tags: parseTags(tags), annotation };
  const id = await put(profile, STORE, interval);
  return { ...interval, id };
}

export async function deleteInterval(profile, id) {
  return remove(profile, STORE, id);
}

export async function getIntervals(profile, { limit = 100 } = {}) {
  const all = await getAll(profile, STORE);
  return all
    .sort((a, b) => new Date(b.start) - new Date(a.start))
    .slice(0, limit);
}

export function intervalDuration(interval) {
  const end = interval.end ? new Date(interval.end) : new Date();
  return (end - new Date(interval.start)) / 1000;
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export async function getTodayTotal(profile) {
  const all = await getAll(profile, STORE);
  const today = new Date().toDateString();
  let total = 0;
  for (const i of all) {
    if (new Date(i.start).toDateString() === today) {
      total += intervalDuration(i);
    }
  }
  return total;
}

export async function getWeekSummary(profile) {
  const all = await getAll(profile, STORE);
  const now = new Date();
  const days = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(now);
    day.setDate(now.getDate() - d);
    const label = day.toDateString();
    const shortLabel = day.toLocaleDateString('en', { weekday: 'short' });
    let secs = 0;
    for (const i of all) {
      if (new Date(i.start).toDateString() === label) secs += intervalDuration(i);
    }
    days.push({ label: shortLabel, date: label, seconds: secs });
  }
  return days;
}
