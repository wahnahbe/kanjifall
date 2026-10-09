import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { visualParams } from '../design/visualParams';
import { useSettings } from './useSettings';

interface Layer {
  key: string;
  node: ReactNode;
  /** Which visit to a screen this is, used as the React key: a layer keeps its
   *  instance while it drains, and a return to the same screen starts fresh. */
  visit: number;
}

interface RenderedLayer extends Layer {
  role: 'out' | 'in';
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
 *  never a cut. Decoration only; the screen itself is always mounted.
 *
 *  The old screen's wrapper keeps the key it had while it was current (one
 *  key per visit to a screen) and only its role changes, so React keeps the
 *  very same instance: its state, its DOM (the Pixi canvas included) and its
 *  effects all survive the change. Nothing refetches, no one-shot sound
 *  replays, no entrance animation restarts, and no loaded view flashes back
 *  to its loading state while it drains. A visit, not the bare screen key,
 *  because coming back to a screen that is still draining must mount it
 *  fresh (Setup reads its preselected list only at mount) and must never put
 *  two layers under one key. */
export function ScreenTransition({ screenKey, children }: ScreenTransitionProps) {
  const { transitionMs, transitionBlurPx, flicker } = visualParams(useSettings().effects);
  const [outgoing, setOutgoing] = useState<Layer | null>(null);
  const [current, setCurrent] = useState({ key: screenKey, visit: 0 });
  const previousRef = useRef<Layer>({ key: screenKey, node: children, visit: 0 });
  const incomingRef = useRef<HTMLDivElement | null>(null);

  // The old screen has to be in the very commit that brings the new one in,
  // or React unmounts it and the drain would be a remount. So the change is
  // taken during render (React discards this pass and re-renders at once,
  // before anything is committed) rather than in an effect. previousRef is
  // still the old screen's last committed render: the tracker effect below
  // only updates it after the commit.
  if (current.key !== screenKey) {
    setCurrent({ key: screenKey, visit: current.visit + 1 });
    setOutgoing(previousRef.current);
  }

  // Runs first on a key change (before the tracker effect below).
  useLayoutEffect(() => {
    if (previousRef.current.key === screenKey) return;
    const incoming = incomingRef.current;
    if (incoming !== null && !incoming.contains(document.activeElement)) incoming.focus({ preventScroll: true });
  }, [screenKey]);

  // The drain timer belongs to the layer it clears: it starts when an
  // outgoing layer appears, restarts when a newer one replaces it, and
  // follows transitionMs if the effects setting changes mid-drain.
  useEffect(() => {
    if (outgoing === null) return;
    const timer = window.setTimeout(() => setOutgoing(null), transitionMs);
    return () => window.clearTimeout(timer);
  }, [outgoing, transitionMs]);

  useEffect(() => {
    previousRef.current = { key: screenKey, node: children, visit: current.visit };
  });

  const style = {
    '--transition-ms': `${transitionMs}ms`,
    '--transition-blur': `${transitionBlurPx}px`,
  } as CSSProperties;

  const layers: RenderedLayer[] = [
    ...(outgoing !== null ? [{ ...outgoing, role: 'out' as const }] : []),
    { key: screenKey, node: children, visit: current.visit, role: 'in' as const },
  ];

  return (
    <div className="screen-stack" style={style} data-flicker={flicker}>
      {layers.map((layer) => (
        <div
          key={layer.visit}
          ref={layer.role === 'in' ? incomingRef : undefined}
          tabIndex={layer.role === 'in' ? -1 : undefined}
          className={layer.role === 'in' ? 'screen-layer screen-layer-in' : 'screen-layer screen-layer-out'}
          inert={layer.role === 'out' || undefined}
          aria-hidden={layer.role === 'out' ? 'true' : undefined}
          data-testid={layer.role === 'in' ? 'screen-in' : 'screen-out'}
        >
          {layer.node}
        </div>
      ))}
    </div>
  );
}
