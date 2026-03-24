import {
  EmbeddingsService,
  EMBEDDING_CACHE_KEY,
  EMBEDDING_DIMENSIONS,
} from './embeddings.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockEmbedContent = jest.fn();
const mockGenAI = {
  models: { embedContent: mockEmbedContent },
};

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => mockGenAI),
}));

const mockCacheGetMany = jest.fn();
const mockCacheSetMany = jest.fn();
const mockCache = {
  getMany: mockCacheGetMany,
  setMany: mockCacheSetMany,
};

const mockConfig = {
  get: jest.fn().mockReturnValue('test-api-key'),
};

// Helper to build a mock embedding response
function mockEmbeddingResponse(count: number, dims = EMBEDDING_DIMENSIONS) {
  return {
    embeddings: Array.from({ length: count }, () => ({
      values: new Array(dims).fill(0).map((_, i) => i / dims),
    })),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('EmbeddingsService', () => {
  let service: EmbeddingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCacheGetMany.mockResolvedValue(new Map());
    mockCacheSetMany.mockResolvedValue(undefined);
    service = new EmbeddingsService(mockConfig as any, mockCache as any);
  });

  // ── Configuration ──────────────────────────────────────────────────────

  it('initialises genAI when API key is set', () => {
    expect(service).toBeDefined();
  });

  it('throws if GEMINI_API_KEY is not configured', async () => {
    mockConfig.get.mockReturnValueOnce(undefined);
    const noKeyService = new EmbeddingsService(mockConfig as any, mockCache as any);
    await expect(noKeyService.embedOne('hello')).rejects.toThrow(
      'Gemini API key not configured',
    );
  });

  // ── embedOne ─────────────────────────────────────────────────────────

  it('embedOne returns a flat number array', async () => {
    mockEmbedContent.mockResolvedValue(mockEmbeddingResponse(1));
    const result = await service.embedOne('hello world');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('embedOne returns cached value without calling Gemini', async () => {
    const cached = new Array(EMBEDDING_DIMENSIONS).fill(0.5);
    mockCacheGetMany.mockResolvedValue(new Map([['hello world', cached]]));
    const result = await service.embedOne('hello world');
    expect(result).toEqual(cached);
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  // ── embedBatch ────────────────────────────────────────────────────────

  it('embedBatch returns empty array for empty input', async () => {
    const result = await service.embedBatch([]);
    expect(result).toEqual([]);
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  it('embedBatch returns results with fromCache=false for fresh embeddings', async () => {
    const texts = ['text1', 'text2'];
    mockEmbedContent.mockResolvedValue(mockEmbeddingResponse(2));
    const results = await service.embedBatch(texts);
    expect(results).toHaveLength(2);
    results.forEach((r) => expect(r.fromCache).toBe(false));
  });

  it('embedBatch returns fromCache=true for cached items', async () => {
    const cached1 = new Array(EMBEDDING_DIMENSIONS).fill(0.1);
    const cached2 = new Array(EMBEDDING_DIMENSIONS).fill(0.2);
    mockCacheGetMany.mockResolvedValue(
      new Map([
        ['text1', cached1],
        ['text2', cached2],
      ]),
    );
    const results = await service.embedBatch(['text1', 'text2']);
    expect(results).toHaveLength(2);
    results.forEach((r) => expect(r.fromCache).toBe(true));
    expect(mockEmbedContent).not.toHaveBeenCalled();
  });

  it('embedBatch mixes cached and fresh correctly', async () => {
    const cached = new Array(EMBEDDING_DIMENSIONS).fill(0.1);
    mockCacheGetMany.mockResolvedValue(
      new Map([
        ['text1', cached],
        ['text2', null],
      ]),
    );
    mockEmbedContent.mockResolvedValue(mockEmbeddingResponse(1));
    const results = await service.embedBatch(['text1', 'text2']);
    expect(results[0].fromCache).toBe(true);
    expect(results[1].fromCache).toBe(false);
    expect(mockEmbedContent).toHaveBeenCalledTimes(1);
  });

  it('writes fresh embeddings to cache', async () => {
    mockEmbedContent.mockResolvedValue(mockEmbeddingResponse(2));
    await service.embedBatch(['a', 'b']);
    expect(mockCacheSetMany).toHaveBeenCalledTimes(1);
    const [[model, pairs]] = mockCacheSetMany.mock.calls;
    expect(model).toBe(EMBEDDING_CACHE_KEY);
    expect(pairs).toHaveLength(2);
  });

  it('does not call setMany when all results are from cache', async () => {
    const cached = new Array(EMBEDDING_DIMENSIONS).fill(0.5);
    mockCacheGetMany.mockResolvedValue(new Map([['text', cached]]));
    await service.embedBatch(['text']);
    expect(mockCacheSetMany).not.toHaveBeenCalled();
  });

  it('throws if Gemini returns wrong number of embeddings', async () => {
    mockEmbedContent.mockResolvedValue({ embeddings: [{ values: new Array(EMBEDDING_DIMENSIONS).fill(0) }] });
    // 2 texts but only 1 embedding returned
    await expect(service.embedBatch(['text1', 'text2'])).rejects.toThrow(
      'Gemini returned 1 embeddings for 2 inputs',
    );
  });

  it('throws if embedding has wrong dimensions', async () => {
    mockEmbedContent.mockResolvedValue({ embeddings: [{ values: new Array(512).fill(0) }] });
    await expect(service.embedBatch(['text1'])).rejects.toThrow(
      `Unexpected embedding dimension: got 512, expected ${EMBEDDING_DIMENSIONS}`,
    );
  });

  it('preserves order: results[i] corresponds to texts[i]', async () => {
    const texts = ['alpha', 'beta', 'gamma'];
    mockEmbedContent.mockResolvedValue(mockEmbeddingResponse(3));
    const results = await service.embedBatch(texts);
    results.forEach((r, i) => expect(r.text).toBe(texts[i]));
  });
});
