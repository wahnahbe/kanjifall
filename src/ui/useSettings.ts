import { useSyncExternalStore } from 'react';
import { getSettings, subscribeSettings } from '../data/settings';

/** Live settings for React surfaces — getSettings returns a stable object
 *  between updates, which is exactly what useSyncExternalStore wants. */
export function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings);
}
