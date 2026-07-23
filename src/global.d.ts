import type { EngineSnapshot } from './engine/types';

/**
 * Dev-only test hook installed by useEngine and read by the Playwright specs.
 * Declared here (not in useEngine.ts) so the app and e2e tsconfig projects
 * share one definition.
 */
declare global {
  interface Window {
    __kotoba?: { snapshot(): EngineSnapshot & { firstAirborneReading?: string | null } };
  }
}
