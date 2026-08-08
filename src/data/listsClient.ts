import {
  listSaveResponseSchema, listSummarySchema, previewResponseSchema,
  type ListSaveResponse, type ListSummary, type PreviewResponse,
} from '../shared/api';
import { z } from 'zod';

/**
 * Thin client for /api/lists. fetchLists resolves null on any failure — the
 * setup screen simply hides its list row; nothing here ever throws
 * (custom-list-import spec §5.3, same posture as fetchRunPlan).
 *
 * previewList and saveList return a discriminated ListsClientResult instead
 * of a bare null: a 400 the server explains (a caps rejection, "no valid
 * lines to save", etc.) surfaces its own message, so the import screen can
 * distinguish "the server rejected this input" from "the request never
 * reached a server at all" instead of misdiagnosing the former as the
 * latter (final-review fix 1).
 */

export type ListsClientResult<T> = { ok: true; value: T } | { ok: false; message: string };

const REQUEST_FAILED_MESSAGE = 'Request failed — is the server running?';

/** Best-effort read of a route's `{ error }` body; falls back to the generic
 *  message when the body is missing, unparsable, or shaped differently. */
async function errorMessageFrom(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? REQUEST_FAILED_MESSAGE;
}

export async function fetchLists(): Promise<readonly ListSummary[] | null> {
  try {
    const response = await fetch('/api/lists');
    if (!response.ok) return null;
    return z.array(listSummarySchema).parse(await response.json());
  } catch {
    return null;
  }
}

export async function previewList(text: string): Promise<ListsClientResult<PreviewResponse>> {
  try {
    const response = await fetch('/api/lists/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return { ok: false, message: await errorMessageFrom(response) };
    return { ok: true, value: previewResponseSchema.parse(await response.json()) };
  } catch {
    return { ok: false, message: REQUEST_FAILED_MESSAGE };
  }
}

export async function saveList(name: string, text: string): Promise<ListsClientResult<ListSaveResponse>> {
  try {
    const response = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, text }),
    });
    if (!response.ok) return { ok: false, message: await errorMessageFrom(response) };
    return { ok: true, value: listSaveResponseSchema.parse(await response.json()) };
  } catch {
    return { ok: false, message: REQUEST_FAILED_MESSAGE };
  }
}
