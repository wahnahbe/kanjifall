/**
 * Single source of truth for the API server's port. server/index.ts binds
 * it and vite.config.ts proxies /api to it, so both must read the same
 * KOTOBA_PORT override — otherwise `KOTOBA_PORT=8791 npm run dev` boots an
 * API that the dev client never talks to. An empty value counts as unset
 * rather than becoming port 0 (a random port).
 */
export const DEFAULT_API_PORT = 8790;

export function apiPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.KOTOBA_PORT;
  if (raw === undefined || raw === '') return DEFAULT_API_PORT;
  return Number(raw);
}
