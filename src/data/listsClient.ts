import {
  listSaveResponseSchema, listSummarySchema, previewResponseSchema,
  type ListSaveResponse, type ListSummary, type PreviewResponse,
} from '../shared/api';
import { z } from 'zod';

/**
 * Thin client for /api/lists. Every function resolves null (or false) on any
 * failure — the import UI degrades to inline messages and the setup screen
 * simply hides its list row; nothing here ever throws (custom-list-import
 * spec §5.3, same posture as fetchRunPlan).
 */

export async function fetchLists(): Promise<readonly ListSummary[] | null> {
  try {
    const response = await fetch('/api/lists');
    if (!response.ok) return null;
    return z.array(listSummarySchema).parse(await response.json());
  } catch {
    return null;
  }
}

export async function previewList(text: string): Promise<PreviewResponse | null> {
  try {
    const response = await fetch('/api/lists/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return null;
    return previewResponseSchema.parse(await response.json());
  } catch {
    return null;
  }
}

export async function saveList(name: string, text: string): Promise<ListSaveResponse | null> {
  try {
    const response = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, text }),
    });
    if (!response.ok) return null;
    return listSaveResponseSchema.parse(await response.json());
  } catch {
    return null;
  }
}
