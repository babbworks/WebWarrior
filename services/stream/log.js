/**
 * Stream Service — OPFS Log Layer
 *
 * Provides append-only log storage using the Origin Private File System (OPFS).
 * Each profile gets its own log file: stream_<profile>.log
 */

import { parse } from './format.js';

/**
 * Returns the OPFS file name for a profile.
 * @param {string} profile
 * @returns {string} `stream_<profile>.log`
 */
export function fileName(profile) {
  return `stream_${profile}.log`;
}

/**
 * Gets the OPFS directory handle and file handle for a profile.
 * @param {string} profile
 * @param {boolean} create - Whether to create the file if it doesn't exist
 * @returns {Promise<{dir: FileSystemDirectoryHandle, fileHandle: FileSystemFileHandle}>}
 */
async function getFileHandle(profile, create = true) {
  const dir = await navigator.storage.getDirectory();
  const fileHandle = await dir.getFileHandle(fileName(profile), { create });
  return { dir, fileHandle };
}

/**
 * Initializes the OPFS log file for a profile.
 * Creates the file with a header line if it doesn't exist or is empty.
 * @param {string} profile
 * @returns {Promise<void>}
 */
export async function initLog(profile) {
  const { fileHandle } = await getFileHandle(profile, true);
  const file = await fileHandle.getFile();

  if (file.size === 0) {
    const header = '0 H v0 stream.log {"fields":"ts op action object ctx","encoding":"utf8"}\n';
    const writable = await fileHandle.createWritable();
    await writable.write(header);
    await writable.close();
  }
}

/**
 * Appends a formatted event line to the log.
 * @param {string} profile
 * @param {string} line - Pre-formatted Hollerith line
 * @returns {Promise<void>}
 */
export async function append(profile, line) {
  const { fileHandle } = await getFileHandle(profile, true);
  const file = await fileHandle.getFile();
  const writable = await fileHandle.createWritable({ keepExistingData: true });
  await writable.seek(file.size);
  await writable.write(line + '\n');
  await writable.close();
}

/**
 * Reads all lines from the log file.
 * @param {string} profile
 * @returns {Promise<string>} Raw file content
 */
export async function readAll(profile) {
  const { fileHandle } = await getFileHandle(profile, true);
  const file = await fileHandle.getFile();
  return await file.text();
}

/**
 * Reads lines within a timestamp range (inclusive).
 * @param {string} profile
 * @param {number} fromTs - Start timestamp (inclusive)
 * @param {number} toTs - End timestamp (inclusive)
 * @returns {Promise<string[]>} Array of matching lines
 */
export async function readRange(profile, fromTs, toTs) {
  const content = await readAll(profile);
  const lines = content.split('\n').filter(line => line.length > 0);
  const matching = [];

  for (const line of lines) {
    const result = parse(line);
    if (result.ok) {
      const ts = result.event.ts;
      if (ts >= fromTs && ts <= toTs) {
        matching.push(line);
      }
    }
  }

  return matching;
}

/**
 * Returns the byte size of the log file.
 * @param {string} profile
 * @returns {Promise<number>}
 */
export async function getSize(profile) {
  const { fileHandle } = await getFileHandle(profile, true);
  const file = await fileHandle.getFile();
  return file.size;
}

/**
 * Validates the log by scanning for malformed lines.
 * @param {string} profile
 * @returns {Promise<{valid: boolean, lastValidLine: number, errors: string[]}>}
 */
export async function validateLog(profile) {
  const content = await readAll(profile);
  const lines = content.split('\n').filter(line => line.length > 0);
  const errors = [];
  let lastValidLine = 0;
  let valid = true;

  for (let i = 0; i < lines.length; i++) {
    const result = parse(lines[i]);
    if (result.ok) {
      lastValidLine = i + 1;
    } else {
      valid = false;
      errors.push(`Line ${i + 1}: ${result.error}`);
    }
  }

  return { valid, lastValidLine, errors };
}

/**
 * Truncates the log file at a byte offset using writable stream.
 * @param {string} profile
 * @param {number} lastValidByte - Byte offset to truncate at
 * @returns {Promise<void>}
 */
export async function truncate(profile, lastValidByte) {
  const { fileHandle } = await getFileHandle(profile, true);
  const writable = await fileHandle.createWritable({ keepExistingData: true });
  await writable.truncate(lastValidByte);
  await writable.close();
}

/**
 * Deletes the log file (for reset).
 * @param {string} profile
 * @returns {Promise<void>}
 */
export async function deleteLog(profile) {
  const dir = await navigator.storage.getDirectory();
  await dir.removeEntry(fileName(profile));
}
