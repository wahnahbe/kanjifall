import { useEffect, useState } from 'react';

const HIDE_AFTER_MS = 4000;

/** The engine already ignores composing keys (isGameKey); this makes the
 *  silent failure visible: an active Japanese IME during play eats every
 *  keystroke with no feedback at all (main spec §7). */
export function ImeWarning() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const onComposition = () => {
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    };
    window.addEventListener('compositionstart', onComposition);
    window.addEventListener('compositionupdate', onComposition);
    return () => {
      window.removeEventListener('compositionstart', onComposition);
      window.removeEventListener('compositionupdate', onComposition);
      window.clearTimeout(timer);
    };
  }, []);
  if (!visible) return null;
  return (
    <p className="ime-warning" data-testid="ime-warning" role="alert">
      Japanese IME is on — switch to EN input (Win+Space).
    </p>
  );
}
