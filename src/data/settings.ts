import { z } from 'zod';

/** Device-local preferences (juice-pass spec §3.1). NOT study data — the
 *  profile row stays server-side. One key, whole-object writes, corrupt
 *  data falls back to defaults silently. */
export const settingsSchema = z.object({
  sound: z.boolean(),
  volume: z.number().min(0).max(1),
  effects: z.union([z.literal('full'), z.literal('reduced'), z.literal('off')]),
  crt: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

const STORAGE_KEY = 'kotoba-settings-v1';

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function defaultSettings(): Settings {
  return {
    sound: true,
    volume: 0.6,
    effects: prefersReducedMotion() ? 'reduced' : 'full',
    crt: false,
  };
}

let current: Settings | null = null;
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultSettings();
    return settingsSchema.parse(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

export function getSettings(): Settings {
  if (current === null) current = load();
  return current;
}

export function updateSettings(partial: Partial<Settings>): Settings {
  const candidate = { ...getSettings(), ...partial };
  const parsed = settingsSchema.safeParse(candidate);
  if (!parsed.success) {
    console.warn('[settings] rejected invalid update', partial);
    return getSettings();
  }
  const next = parsed.data;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota) — settings stay session-local.
  }
  for (const cb of listeners) {
    try {
      cb();
    } catch (error) {
      console.warn('[settings] subscriber threw', error);
    }
  }
  return next;
}

export function subscribeSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Tests only: drop the cache so the next read reloads storage. */
export function resetSettingsCache(): void {
  current = null;
}
