// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportScreen } from '../screens/ImportScreen';

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
    await waitFor(() => expect(screen.getByTestId('import-error')).toHaveTextContent(/could not save/i));
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
});
