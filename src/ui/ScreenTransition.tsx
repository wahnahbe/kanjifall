import {
  createContext, useContext, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import { visualParams } from '../design/visualParams';
import { useSettings } from './useSettings';

const OutgoingLayerContext = createContext(false);

/** True inside the draining copy of the previous screen. The copy is a fresh
 *  mount of the old element, so a screen whose mount has side effects
 *  (network fetch, a one-shot sound) checks this and skips them. A hook next
 *  to its provider: fast refresh just reloads this module. */
// oxlint-disable-next-line react/only-export-components
export function useIsOutgoingLayer(): boolean {
  return useContext(OutgoingLayerContext);
}

interface Layer {
  key: string;
  node: ReactNode;
}

interface ScreenTransitionProps {
  /** Changes when the screen changes; the old children drain, the new bleed in. */
  screenKey: string;
  children: ReactNode;
}

/** Second-pass spec §4.4: one transition, every direction. The outgoing
 *  screen stays mounted, inert and non-interactive, while it blurs and
 *  drains; the incoming screen mounts at once and receives focus so the
 *  first keystroke lands on it. Durations and blur come from visualParams:
 *  360ms with blur at full, 360ms crossfade at reduced, 120ms at off —
 *  never a cut. Decoration only; the screen itself is always mounted. */
export function ScreenTransition({ screenKey, children }: ScreenTransitionProps) {
  const { transitionMs, transitionBlurPx, flicker } = visualParams(useSettings().effects);
  const [outgoing, setOutgoing] = useState<Layer | null>(null);
  const previousRef = useRef<Layer>({ key: screenKey, node: children });
  const incomingRef = useRef<HTMLDivElement | null>(null);

  // Runs first on a key change: previousRef still holds the old screen's
  // last render (the tracker effect below updates it afterwards).
  useLayoutEffect(() => {
    if (previousRef.current.key === screenKey) return;
    setOutgoing(previousRef.current);
    const incoming = incomingRef.current;
    if (incoming !== null && !incoming.contains(document.activeElement)) incoming.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setOutgoing(null), transitionMs);
    return () => window.clearTimeout(timer);
  }, [screenKey, transitionMs]);

  useEffect(() => {
    previousRef.current = { key: screenKey, node: children };
  });

  const style = {
    '--transition-ms': `${transitionMs}ms`,
    '--transition-blur': `${transitionBlurPx}px`,
  } as CSSProperties;

  return (
    <div className="screen-stack" style={style} data-flicker={flicker}>
      {outgoing !== null && (
        <div key={`out-${outgoing.key}`} className="screen-layer screen-layer-out" inert aria-hidden="true" data-testid="screen-out">
          <OutgoingLayerContext.Provider value={true}>{outgoing.node}</OutgoingLayerContext.Provider>
        </div>
      )}
      <div key={`in-${screenKey}`} ref={incomingRef} tabIndex={-1} className="screen-layer screen-layer-in" data-testid="screen-in">
        {children}
      </div>
    </div>
  );
}
