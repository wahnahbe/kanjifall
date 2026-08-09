import { AdvancedBloomFilter, CRTFilter } from 'pixi-filters';
import type { Filter } from 'pixi.js';
import type { Settings } from '../data/settings';

/** Pure decision half (unit-tested): which filters this settings state wants. */
export function filterKinds(settings: Settings): ('bloom' | 'crt')[] {
  const kinds: ('bloom' | 'crt')[] = [];
  if (settings.effects === 'full') kinds.push('bloom');
  if (settings.crt) kinds.push('crt');
  return kinds;
}

/** Construction half: a filter that fails to build logs one warning and the
 *  game runs unfiltered — juice must never block play (spec §9). */
export function buildFilters(settings: Settings): Filter[] {
  try {
    return filterKinds(settings).map((kind) =>
      kind === 'bloom'
        ? new AdvancedBloomFilter({ threshold: 0.6, bloomScale: 0.8 })
        : new CRTFilter({ lineWidth: 2, vignetting: 0.25 }),
    );
  } catch (error) {
    console.warn('[filters] construction failed — running unfiltered', error);
    return [];
  }
}
