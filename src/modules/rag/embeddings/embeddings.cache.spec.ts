import { EmbeddingsCache } from './embeddings.cache';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

describe('EmbeddingsCache', () => {
  let cache: EmbeddingsCache;

  beforeEach(() => {
    jest.clearAllMocks();
    cache = new EmbeddingsCache(mockRedis as any);
  });

  // ── get ──────────────────────────────────────────────────────────────────

  it('returns null on cache miss', async () => {
    mockRedis.get.mockResolvedValue(null);
    const result = await cache.get('text-embedding-004', 'hello world');
    expect(result).toBeNull();
  });

  it('returns parsed embedding on cache hit', async () => {
    const embedding = [0.1, 0.2, 0.3];
    mockRedis.get.mockResolvedValue(JSON.stringify(embedding));
    const result = await cache.get('text-embedding-004', 'hello world');
    expect(result).toEqual(embedding);
  });

  it('returns null on Redis error (non-fatal)', async () => {
    mockRedis.get.mockRejectedValue(new Error('Redis down'));
    const result = await cache.get('text-embedding-004', 'some text');
    expect(result).toBeNull();
  });

  it('uses a stable deterministic key (same inputs → same key)', async () => {
    mockRedis.get.mockResolvedValue(null);
    await cache.get('model-a', 'test-text');
    await cache.get('model-a', 'test-text');
    // Both calls should use the exact same key
    const [call1Key] = mockRedis.get.mock.calls[0];
    const [call2Key] = mockRedis.get.mock.calls[1];
    expect(call1Key).toBe(call2Key);
  });

  it('uses different keys for different models', async () => {
    mockRedis.get.mockResolvedValue(null);
    await cache.get('model-a', 'same-text');
    await cache.get('model-b', 'same-text');
    const key1 = mockRedis.get.mock.calls[0][0];
    const key2 = mockRedis.get.mock.calls[1][0];
    expect(key1).not.toBe(key2);
  });

  it('uses different keys for different texts', async () => {
    mockRedis.get.mockResolvedValue(null);
    await cache.get('model-a', 'text-one');
    await cache.get('model-a', 'text-two');
    const key1 = mockRedis.get.mock.calls[0][0];
    const key2 = mockRedis.get.mock.calls[1][0];
    expect(key1).not.toBe(key2);
  });

  it('key starts with embed:v1: prefix', async () => {
    mockRedis.get.mockResolvedValue(null);
    await cache.get('model-a', 'my-text');
    const key = mockRedis.get.mock.calls[0][0] as string;
    expect(key.startsWith('embed:v1:')).toBe(true);
  });

  // ── set ──────────────────────────────────────────────────────────────────

  it('writes embedding as JSON with 7-day TTL', async () => {
    mockRedis.set.mockResolvedValue('OK');
    const embedding = [0.5, 0.6];
    await cache.set('text-embedding-004', 'hello', embedding);
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    const [_key, value, ttl] = mockRedis.set.mock.calls[0];
    expect(JSON.parse(value)).toEqual(embedding);
    expect(ttl).toBe(7 * 24 * 60 * 60);
  });

  it('does not throw on Redis set error (non-fatal)', async () => {
    mockRedis.set.mockRejectedValue(new Error('Redis write failed'));
    await expect(cache.set('model', 'text', [0.1])).resolves.not.toThrow();
  });

  // ── getMany ───────────────────────────────────────────────────────────────

  it('getMany returns a map with nulls for misses', async () => {
    mockRedis.get.mockResolvedValue(null);
    const map = await cache.getMany('model', ['a', 'b', 'c']);
    expect(map.get('a')).toBeNull();
    expect(map.get('b')).toBeNull();
    expect(map.get('c')).toBeNull();
  });

  it('getMany returns hits and nulls for mixed results', async () => {
    const embedding = [0.1, 0.2];
    mockRedis.get
      .mockResolvedValueOnce(JSON.stringify(embedding)) // 'a' → hit
      .mockResolvedValueOnce(null) // 'b' → miss
      .mockResolvedValueOnce(JSON.stringify([0.9])); // 'c' → hit

    const map = await cache.getMany('model', ['a', 'b', 'c']);
    expect(map.get('a')).toEqual(embedding);
    expect(map.get('b')).toBeNull();
    expect(map.get('c')).toEqual([0.9]);
  });

  // ── setMany ───────────────────────────────────────────────────────────────

  it('setMany calls set for each pair', async () => {
    mockRedis.set.mockResolvedValue('OK');
    const pairs = [
      { text: 'foo', embedding: [0.1, 0.2] },
      { text: 'bar', embedding: [0.3, 0.4] },
    ];
    await cache.setMany('model', pairs);
    expect(mockRedis.set).toHaveBeenCalledTimes(2);
  });

  it('setMany handles empty pairs array', async () => {
    await expect(cache.setMany('model', [])).resolves.not.toThrow();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });
});
