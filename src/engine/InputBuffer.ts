import { toKana } from 'wanakana';

const INPUT_KEY = /^[a-z-]$/;

/** Romaji accumulator that renders as kana the way an IME would. */
export class InputBuffer {
  private raw = '';

  get romaji(): string {
    return this.raw;
  }

  get kana(): string {
    return toKana(this.raw, { IMEMode: true });
  }

  get isEmpty(): boolean {
    return this.raw.length === 0;
  }

  /** Returns true if the key was consumed as input. */
  pushKey(ch: string): boolean {
    const key = ch.toLowerCase();
    if (!INPUT_KEY.test(key)) return false;
    this.raw += key;
    return true;
  }

  /** Returns true if a character was removed. */
  backspace(): boolean {
    if (this.raw.length === 0) return false;
    this.raw = this.raw.slice(0, -1);
    return true;
  }

  clear(): void {
    this.raw = '';
  }

  /** Finalize for submission: a dangling 'n' becomes ん. Does not clear. */
  commitKana(): string {
    const finalized = this.raw.endsWith('n') && !this.raw.endsWith('nn')
      ? `${this.raw}n`
      : this.raw;
    return toKana(finalized, { IMEMode: true });
  }
}
