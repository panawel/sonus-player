import { describe, it, expect, vi } from 'vitest';
import { createCoverCache } from './coverCache.js';

const setup = (opts = {}) => {
  const load = vi.fn(async (k) => (k === 'none' ? null : `data:${k}`));
  const decode = vi.fn(async () => {});
  return { load, decode, cache: createCoverCache({ load, decode, ...opts }) };
};

describe('coverCache', () => {
  it('loads, decodes, then serves the cover instantly', async () => {
    const { load, decode, cache } = setup();
    expect(cache.peek('a')).toBeUndefined();
    expect(await cache.get('a')).toBe('data:a');
    expect(decode).toHaveBeenCalledWith('data:a');
    expect(cache.peek('a')).toBe('data:a');
    await cache.get('a');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one load between concurrent requests', async () => {
    const { load, cache } = setup();
    const [x, y] = await Promise.all([cache.get('a'), cache.get('a')]);
    expect(x).toBe('data:a');
    expect(y).toBe('data:a');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('remembers a file without a cover as null (no reload)', async () => {
    const { load, cache } = setup();
    expect(await cache.get('none')).toBeNull();
    expect(cache.peek('none')).toBeNull();
    await cache.get('none');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps only the most recently used covers', async () => {
    const { cache } = setup({ size: 2 });
    await cache.get('a'); await cache.get('b');
    cache.peek('a');            // a is now the most recent
    await cache.get('c');       // evicts b
    expect(cache.peek('b')).toBeUndefined();
    expect(cache.peek('a')).toBe('data:a');
    expect(cache.peek('c')).toBe('data:c');
  });

  it('prefetch loads what is missing, once', async () => {
    const { load, cache } = setup();
    await cache.get('a');
    cache.prefetch(['a', 'b', null, 'b']);
    await cache.get('b');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a failed load resolves null and can be retried', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('data:a');
    const cache = createCoverCache({ load, decode: async () => {} });
    expect(await cache.get('a')).toBeNull();
    expect(cache.peek('a')).toBeUndefined();
    expect(await cache.get('a')).toBe('data:a');
  });
});
