import type { CreateRun, EventsBatch, FinalizeRun } from '../shared/api';
import { api } from './apiClient';

const STORAGE_KEY = 'kd.outbox.v1';
const CAP = 50;

export interface OutboxEntry {
  kind: 'createRun' | 'events' | 'finalize';
  runId: string;
  payload: unknown;
}

let readEntriesWarnedOnce = false;

function readEntries(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
    } catch {
      return []; // corrupt storage must not crash the app; treat as empty
    }
  } catch (error) {
    // localStorage unavailable/throws: treat as empty and warn once
    if (!readEntriesWarnedOnce) {
      console.warn('[outbox] localStorage unavailable on read; treating as empty', error);
      readEntriesWarnedOnce = true;
    }
    return [];
  }
}

function writeEntries(entries: OutboxEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('[outbox] write failed; entry dropped', error);
  }
}

/** FIFO append. Past the cap, drops the oldest entries and warns (never grows unbounded). */
export function pushOutbox(entry: OutboxEntry): void {
  const entries = [...readEntries(), entry];
  const overflow = entries.length - CAP;
  if (overflow > 0) {
    entries.splice(0, overflow);
    console.warn(
      `kotoba outbox exceeded ${CAP} entries; dropped ${overflow} oldest entr${overflow === 1 ? 'y' : 'ies'}`,
    );
  }
  writeEntries(entries);
}

function replay(entry: OutboxEntry): Promise<void> {
  if (entry.kind === 'createRun') return api.createRun(entry.payload as CreateRun);
  if (entry.kind === 'events') return api.postEvents(entry.runId, entry.payload as EventsBatch);
  return api.finalizeRun(entry.runId, entry.payload as FinalizeRun);
}

/**
 * Replays queued entries via the api, in order, stopping at the first
 * failure so later entries stay queued (and ordering is preserved for the
 * next drain) rather than being attempted out of turn.
 */
export async function drainOutbox(): Promise<{ drained: number; remaining: number }> {
  const entries = readEntries();
  let drained = 0;
  while (entries.length > 0) {
    try {
      await replay(entries[0]);
    } catch {
      break;
    }
    entries.shift();
    drained += 1;
    writeEntries(entries); // persist progress after each success
  }
  return { drained, remaining: entries.length };
}
