import { useState } from 'react';
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

  const valid = preview === null ? 0 : preview.summary.total - preview.summary.errors;
  const skipped = preview?.summary.errors ?? 0;

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    const result = await previewList(text);
    if (result === null) setError('Preview failed — is the server running?');
    setPreview(result);
    setBusy(false);
  };

  const doSave = async () => {
    setBusy(true);
    setError(null);
    const saved = await saveList(name.trim(), text);
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
      <input
        data-testid="import-name"
        placeholder="List name (re-importing a name replaces it)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        data-testid="import-text"
        rows={10}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null); // edits invalidate the advisory preview
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
        <button onClick={onBack}>Back</button>
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
