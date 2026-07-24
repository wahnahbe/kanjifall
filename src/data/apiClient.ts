import type { CreateRun, EventsBatch, FinalizeRun } from '../shared/api';

/** Thrown by every `api` method when the server responds with a non-ok status. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(url: string, method: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status);
}

/** Thin fetch wrapper over the ingest routes (T2). Never resolves a value — callers only care whether it threw. */
export const api = {
  createRun(run: CreateRun): Promise<void> {
    return request('/api/runs', 'POST', run);
  },
  postEvents(runId: string, batch: EventsBatch): Promise<void> {
    return request(`/api/runs/${runId}/events`, 'POST', batch);
  },
  finalizeRun(runId: string, body: FinalizeRun): Promise<void> {
    return request(`/api/runs/${runId}`, 'PATCH', body);
  },
};
