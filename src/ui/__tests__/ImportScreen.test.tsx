// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportScreen } from '../screens/ImportScreen';

/** A fetch stand-in the test resolves by hand, for proving behavior that
 *  depends on state changing WHILE a request is still in flight (stale-
 *  preview race, busy-while-saving). `resolveFetch` starts as a no-op so
 *  the binding is always callable even before the executor runs. */
function deferredResponse() {
  let resolveFetch: (value: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  return { promise, resolveFetch: (value: Response) => resolveFetch(value) };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;

const PREVIEW = {
  lines: [
    { line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } },
    { line: 2, raw: 'かみ', status: 'error', error: 'ambiguous — 紙 (paper), 神 (god); supply word\tkana\tgloss' },
  ],
  summary: { total: 2, resolved: 1, customNew: 0, errors: 1 },
};

function stub(routes: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string) => {
    const body = routes[String(url)];
    if (body === undefined) return Promise.reject(new Error(`unhandled fetch: ${url}`));
    return Promise.resolve(ok(body));
  });
}

describe('ImportScreen', () => {
  it('previews a paste and renders per-line statuses and errors', async () => {
    stub({ '/api/lists/preview': PREVIEW });
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-text'), '犬{enter}かみ');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => {
      expect(screen.getByTestId('preview-table')).toHaveTextContent('犬');
      expect(screen.getByTestId('preview-table')).toHaveTextContent('ambiguous');
    });
    expect(screen.getByTestId('save-button')).toHaveTextContent('Save 1 word (1 line skipped)');
  });

  it('save is disabled without a name or without any valid line', async () => {
    stub({
      '/api/lists/preview': {
        lines: [{ line: 1, raw: 'かみ', status: 'error', error: 'ambiguous' }],
        summary: { total: 1, resolved: 0, customNew: 0, errors: 1 },
      },
    });
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-text'), 'かみ');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeDisabled());
  });

  it('saving calls onSaved with the response identity', async () => {
    const onSaved = vi.fn();
    stub({
      '/api/lists/preview': {
        lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } }],
        summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
      },
      '/api/lists': { id: 7, name: 'leeches', cardCount: 1, replaced: false },
    });
    render(<ImportScreen onSaved={onSaved} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-name'), 'leeches');
    await userEvent.type(screen.getByTestId('import-text'), '犬');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());
    await userEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 7, name: 'leeches' }));
  });

  it('a failed save shows an inline error and stays on the screen', async () => {
    stub({
      '/api/lists/preview': {
        lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } }],
        summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
      },
    });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === '/api/lists/preview') {
        return Promise.resolve(ok({
          lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } }],
          summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
        }));
      }
      if (String(url) === '/api/lists' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) } as Response);
      }
      return Promise.reject(new Error(`unhandled: ${url}`));
    });
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-name'), 'x');
    await userEvent.type(screen.getByTestId('import-text'), '犬');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());
    await userEvent.click(screen.getByTestId('save-button'));
    await waitFor(() =>
      expect(screen.getByTestId('import-error')).toHaveTextContent('Request failed — is the server running?'),
    );
  });

  // Final-review fix 1: a 400 the server explains (e.g. a caps rejection)
  // must render its own message verbatim, not the generic fallback above —
  // that's what previously misdiagnosed a caps rejection as "is the server
  // running?".
  it('a failed preview renders the error message from a 400 response body verbatim', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url) === '/api/lists/preview') {
        return Promise.resolve({
          ok: false, status: 400, json: () => Promise.resolve({ error: 'too many lines (max 1000)' }),
        } as Response);
      }
      return Promise.reject(new Error(`unhandled fetch: ${url}`));
    });
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-text'), '犬');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => {
      expect(screen.getByTestId('import-error').textContent).toBe('too many lines (max 1000)');
    });
  });

  // The four tests above only ever exercise valid=1/skipped=1 (both
  // singular). The plan's button-copy constraint ("Save N words / Save N
  // words (M lines skipped) with singular forms word/line at 1") is only
  // fully honored if the plural branches and the no-clause-when-nothing-
  // skipped branch are covered too.
  it('uses plural "words" and omits the skipped clause when every line resolves', async () => {
    stub({
      '/api/lists/preview': {
        lines: [
          { line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } },
          { line: 2, raw: '猫', status: 'jlpt', cardId: 'jm-2', display: { kanji: '猫', kana: 'ねこ', gloss: 'cat' } },
        ],
        summary: { total: 2, resolved: 2, customNew: 0, errors: 0 },
      },
    });
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-text'), '犬{enter}猫');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toHaveTextContent('Save 2 words'));
    expect(screen.getByTestId('save-button')).not.toHaveTextContent('skipped');
  });

  it('pluralizes both the word count and the skipped-lines clause', async () => {
    stub({
      '/api/lists/preview': {
        lines: [
          { line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } },
          { line: 2, raw: '猫', status: 'jlpt', cardId: 'jm-2', display: { kanji: '猫', kana: 'ねこ', gloss: 'cat' } },
          { line: 3, raw: 'x', status: 'error', error: 'bad' },
          { line: 4, raw: 'y', status: 'error', error: 'bad' },
        ],
        summary: { total: 4, resolved: 2, customNew: 0, errors: 2 },
      },
    });
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-text'), '犬{enter}猫{enter}x{enter}y');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() =>
      expect(screen.getByTestId('save-button')).toHaveTextContent('Save 2 words (2 lines skipped)'),
    );
  });

  // Global constraint: "Editing the textarea invalidates the preview
  // (setPreview(null))." None of the tests above prove this — they only
  // ever type BEFORE previewing, so a missing setPreview(null) in the
  // textarea's onChange would slip through unnoticed.
  it('invalidates the preview when the text is edited afterward', async () => {
    stub({
      '/api/lists/preview': {
        lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } }],
        summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
      },
    });
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-name'), 'x');
    await userEvent.type(screen.getByTestId('import-text'), '犬');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());
    expect(screen.getByTestId('preview-table')).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('import-text'), '猫');

    expect(screen.queryByTestId('preview-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('save-button')).toBeDisabled();
  });

  // Review fix #1 (Important): the name input was placeholder-only and the
  // textarea had nothing, so neither had an accessible name. Every other
  // test here queries by data-testid, which doesn't care whether a label
  // exists — only an accessible-name query proves the fix.
  it('exposes accessible names for the name and text fields', () => {
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    expect(screen.getByLabelText('List name')).toBe(screen.getByTestId('import-name'));
    expect(screen.getByLabelText('Words')).toBe(screen.getByTestId('import-text'));
  });

  // Review fix #2 (Important): stale-preview race. Click Preview for text
  // T0, then edit the text to T1 BEFORE T0's response arrives. T0's result
  // must never be shown once the text has moved on — otherwise the table
  // and the Save copy describe words that Save would not actually post
  // (Save always ships the live textarea value, per the advisory-preview
  // constraint).
  it('discards a stale preview response when the text changes before it resolves', async () => {
    const deferred = deferredResponse();
    fetchMock.mockImplementation((url: string) => {
      if (String(url) === '/api/lists/preview') return deferred.promise;
      return Promise.reject(new Error(`unhandled fetch: ${url}`));
    });

    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-text'), '犬');
    await userEvent.click(screen.getByTestId('preview-button'));
    // T0's request ('犬') is still in flight; edit the text before it
    // resolves. Both buttons stay disabled (busy) until T0 settles.
    await userEvent.type(screen.getByTestId('import-text'), '猫');
    expect(screen.getByTestId('preview-button')).toBeDisabled();

    await act(async () => {
      deferred.resolveFetch(ok({
        lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } }],
        summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
      }));
      await deferred.promise;
    });

    // busy releases once T0 settles (Preview becomes clickable again for
    // the new text), but T0's now-stale result must never have applied.
    await waitFor(() => expect(screen.getByTestId('preview-button')).toBeEnabled());
    expect(screen.queryByTestId('preview-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('save-button')).not.toHaveTextContent('Save 1 word');
  });

  // Review fix #3 (Important), half 1: Back must not be clickable mid-save
  // — Task 6 unmounts this screen on Back, and a save resolving after that
  // would otherwise call onSaved on a screen the user already left.
  it('disables Back while a save is in flight, then still calls onSaved once it resolves', async () => {
    const onSaved = vi.fn();
    const deferred = deferredResponse();
    fetchMock.mockImplementation((url: string) => {
      if (String(url) === '/api/lists/preview') {
        return Promise.resolve(ok({
          lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } }],
          summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
        }));
      }
      if (String(url) === '/api/lists') return deferred.promise;
      return Promise.reject(new Error(`unhandled fetch: ${url}`));
    });

    render(<ImportScreen onSaved={onSaved} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-name'), 'leeches');
    await userEvent.type(screen.getByTestId('import-text'), '犬');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());

    await userEvent.click(screen.getByTestId('save-button'));
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    await act(async () => {
      deferred.resolveFetch(ok({ id: 7, name: 'leeches', cardCount: 1, replaced: false }));
      await deferred.promise;
    });

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 7, name: 'leeches' }));
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
  });

  // Review fix #3 (Important), half 2: the disposedRef guard itself. Back
  // being disabled closes off the direct route, but this proves the guard
  // that actually matters — if the screen unmounts by any other means
  // while a save is in flight, the resolving response must not call
  // onSaved (or touch state) on a screen that's already gone.
  it('does not call onSaved if the screen unmounts before a save resolves', async () => {
    const onSaved = vi.fn();
    const deferred = deferredResponse();
    fetchMock.mockImplementation((url: string) => {
      if (String(url) === '/api/lists/preview') {
        return Promise.resolve(ok({
          lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } }],
          summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
        }));
      }
      if (String(url) === '/api/lists') return deferred.promise;
      return Promise.reject(new Error(`unhandled fetch: ${url}`));
    });

    const { unmount } = render(<ImportScreen onSaved={onSaved} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-name'), 'leeches');
    await userEvent.type(screen.getByTestId('import-text'), '犬');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());
    await userEvent.click(screen.getByTestId('save-button'));

    unmount();

    await act(async () => {
      deferred.resolveFetch(ok({ id: 7, name: 'leeches', cardCount: 1, replaced: false }));
      await deferred.promise;
    });

    expect(onSaved).not.toHaveBeenCalled();
  });

  // Regression (Important, found in Task 7 e2e): src/main.tsx renders the
  // whole app through <StrictMode>, which in dev double-invokes every
  // effect (setup → cleanup → setup) on mount to surface missing-cleanup
  // bugs. The disposedRef teardown guard's cleanup sets disposedRef.current
  // = true; nothing reset it back on the second setup, so from then on
  // doPreview/doSave's `if (disposedRef.current) return;` silently discarded
  // every response forever — Preview and Save became permanent no-ops in
  // the real dev-server app. None of the tests above catch this because
  // none of them render through StrictMode.
  it('preview works under StrictMode (dev-mode effect double-invocation must not poison the teardown guard)', async () => {
    stub({ '/api/lists/preview': PREVIEW });
    render(
      <StrictMode>
        <ImportScreen onSaved={() => {}} onBack={() => {}} />
      </StrictMode>,
    );
    await userEvent.type(screen.getByTestId('import-text'), '犬');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('preview-table')).toBeInTheDocument());
  });
});
