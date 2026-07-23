import { beforeEach, describe, expect, it } from 'vitest';
import { InputBuffer } from '../InputBuffer';

let buf: InputBuffer;
beforeEach(() => { buf = new InputBuffer(); });

const type = (s: string) => { for (const ch of s) buf.pushKey(ch); };

describe('InputBuffer', () => {
  it('converts romaji to kana progressively (IME mode)', () => {
    type('benkyou');
    expect(buf.kana).toBe('べんきょう');
    expect(buf.romaji).toBe('benkyou');
  });

  it('shows unconverted partial romaji tail', () => {
    type('benk');
    expect(buf.kana).toBe('べんk');
  });

  it('keeps trailing n ambiguous until committed', () => {
    type('hon');
    expect(buf.kana).toBe('ほn');
    expect(buf.commitKana()).toBe('ほん');
  });

  it('handles double consonants and long-vowel hyphen', () => {
    type('kitte');
    expect(buf.kana).toBe('きって');
    buf.clear();
    type('ko-hi-');
    expect(buf.kana).toBe('こーひー');
  });

  it('accepts alternate romanizations', () => {
    type('si');
    expect(buf.kana).toBe('し');
    buf.clear();
    type('zya');
    expect(buf.kana).toBe('じゃ');
  });

  it('rejects non-input keys and reports consumption', () => {
    expect(buf.pushKey('a')).toBe(true);
    expect(buf.pushKey('1')).toBe(false);
    expect(buf.pushKey('!')).toBe(false);
    expect(buf.kana).toBe('あ');
  });

  it('backspace removes one raw char; clear empties', () => {
    type('ka');
    expect(buf.kana).toBe('か');
    expect(buf.backspace()).toBe(true);
    expect(buf.kana).toBe('k');
    buf.clear();
    expect(buf.isEmpty).toBe(true);
    expect(buf.backspace()).toBe(false);
  });

  it('uppercase input is lowered', () => {
    type('NEKO');
    expect(buf.kana).toBe('ねこ');
  });

  it('commitKana leaves an already-committed ん untouched', () => {
    type('honn');
    expect(buf.kana).toBe('ほん');
    expect(buf.commitKana()).toBe('ほん');
  });

  it('commitKana is a no-op for input with no trailing n', () => {
    type('kitte');
    expect(buf.commitKana()).toBe('きって');
    expect(buf.commitKana()).toBe(buf.kana);
  });

  it('commitKana does not clear the buffer', () => {
    type('hon');
    buf.commitKana();
    expect(buf.romaji).toBe('hon');
    expect(buf.kana).toBe('ほn');
  });
});
