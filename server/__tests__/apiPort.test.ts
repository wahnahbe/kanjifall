import { describe, expect, it } from 'vitest';
import { apiPort, DEFAULT_API_PORT } from '../apiPort';

describe('apiPort', () => {
  it('defaults to 8790 when KOTOBA_PORT is unset', () => {
    expect(DEFAULT_API_PORT).toBe(8790);
    expect(apiPort({})).toBe(8790);
  });

  it('honors a KOTOBA_PORT override', () => {
    expect(apiPort({ KOTOBA_PORT: '8791' })).toBe(8791);
  });

  it('treats an empty KOTOBA_PORT as unset rather than binding port 0', () => {
    expect(apiPort({ KOTOBA_PORT: '' })).toBe(8790);
  });
});
