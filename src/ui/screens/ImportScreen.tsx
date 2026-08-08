import { useEffect, useRef, useState } from 'react';
import { previewList, saveList } from '../../data/listsClient';
import type { PreviewResponse } from '../../shared/api';

interface ImportScreenProps {
  onSaved: (list: { id: number; name: string }) => void;
  onBack: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  jlpt: 'built-in', 'custom-existing': 'custom (known)', 'custom-new': 'custom (new)', error: 'error',
};

/**
 * Paste → preview → save (custom-list-import spec §5.3). The preview is
 * advisory: the server re-parses the raw text on save, so this screen only
 * ever ships the text itself. Error lines don't block saving — the button
 * says exactly what will be skipped, so nothing is dropped silently.
 */
export function ImportScreen({ onSaved, onBack }: ImportScreenProps) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bumped by every edit AND by every doPreview call. A stale-preview race
  // (review fix #2) is otherwise reachable: click Preview for text T0,
  // keep typing so the text becomes T1 (which clears preview via onChange
  // below), then T0's response lands and would overwrite T1's blank slate
  // with T0's table. doPreview captures the token before awaiting and only
  // applies its result if nothing has bumped the ref since — i.e. the text
  // is still what this particular request was fired for.
  const previewTokenRef = useRef(0);
  // Flipped once on unmount (Task 6 unmounts this screen on navigation;
  // review fix #3). Guards every post-await continuation in doPreview and
  // doSave so a response landing after teardown never calls setState or
  // onSaved on a screen the user has already left.
  const disposedRef = useRef(false);
  useEffect(() => () => {
    disposedRef.current = true;
  }, []);

  const valid = preview === null ? 0 : preview.summary.total - preview.summary.errors;
  const skipped = preview?.summary.errors ?? 0;

  const doPreview = async () => {
    const token = ++previewTokenRef.current;
    setBusy(true);
    setError(null);
    const result = await previewList(text);
    if (disposedRef.current) return;
    if (previewTokenRef.current === token) {
      if (result === null) setError('Preview failed — is the server running?');
      setPreview(result);
    } // else: stale — the text changed since this request was sent, so its
      // result (success or failure) no longer describes what's on screen.
    setBusy(false);
  };

  const doSave = async () => {
    setBusy(true);
    setError(null);
    const saved = await saveList(name.trim(), text);
    if (disposedRef.current) return;
    setBusy(false);
    if (saved === null) {
      setError('Could not save the list — check the lines and try again.');
      return;
    }
    onSaved({ id: saved.id, name: saved.name });
  };

  return (
    <div className="screen-center" data-testid="import">
      <h2>Import a word list</h2>
      <p className="hint">
        One word per line — bare words resolve against the built-in N5–N2 data;
        anything else needs word&#9;kana&#9;gloss. Lines starting with # are ignored.
      </p>
      <label htmlFor="import-name">List name</label>
      <input
        id="import-name"
        data-testid="import-name"
        placeholder="List name (re-importing a name replaces it)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label htmlFor="import-text">Words</label>
      <textarea
        id="import-text"
        data-testid="import-text"
        rows={10}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null); // edits invalidate the advisory preview
          previewTokenRef.current += 1; // ...and any in-flight preview request for the old text
        }}
      />
      <div className="picker-row">
        <button data-testid="preview-button" disabled={busy || text.trim().length === 0} onClick={() => void doPreview()}>
          Preview
        </button>
        <button
          data-testid="save-button"
          disabled={busy || preview === null || valid === 0 || name.trim().length === 0}
          onClick={() => void doSave()}
        >
          {`Save ${valid} ${valid === 1 ? 'word' : 'words'}`
            + (skipped > 0 ? ` (${skipped} ${skipped === 1 ? 'line' : 'lines'} skipped)` : '')}
        </button>
        {/* Task 6 unmounts this screen on Back; disabling it while busy is
            the first half of review fix #3 — it closes off the most direct
            route to the unmount-mid-request hazard the disposedRef guards
            against below. */}
        <button disabled={busy} onClick={onBack}>Back</button>
      </div>
      {error !== null && (
        <p className="load-error" data-testid="import-error">{error}</p>
      )}
      {preview !== null && (
        <table data-testid="preview-table" className="preview-table">
          <tbody>
            {preview.lines.map((l) => (
              <tr key={l.line} className={l.status === 'error' ? 'preview-error' : ''}>
                <td>{l.line}</td>
                <td>{STATUS_LABELS[l.status]}</td>
                <td>
                  {l.status === 'error'
                    ? `${l.raw} — ${l.error}`
                    : `${l.display?.kanji ?? l.display?.kana} · ${l.display?.kana} · ${l.display?.gloss}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
