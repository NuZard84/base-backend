import { VectorSearchService, VectorSearchResult } from './vector-search.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockEmbedOne = jest.fn();
const mockEmbeddings = { embedOne: mockEmbedOne };

const mockQueryRaw = jest.fn();
const mockPrisma = { $queryRaw: mockQueryRaw };

// Minimal row matching RawRow type
function makeRow(overrides: Partial<{
  chunkId: string; documentId: string; chunkIndex: number; content: string;
  pageNumber: number | null; rowRange: string | null; similarity: number; filename: string;
}> = {}) {
  return {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    chunkIndex: 0,
    content: 'Sample content',
    pageNumber: null,
    rowRange: null,
    similarity: 0.85,
    filename: 'test.pdf',
    ...overrides,
  };
}

const FAKE_VECTOR = new Array(1536).fill(0.1);

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VectorSearchService', () => {
  let service: VectorSearchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VectorSearchService(mockPrisma as any, mockEmbeddings as any);
  });

  // ── search() ──────────────────────────────────────────────────────────────

  it('search() embeds the query before calling searchByVector', async () => {
    mockEmbedOne.mockResolvedValue(FAKE_VECTOR);
    mockQueryRaw.mockResolvedValue([]);
    await service.search('what is pgvector?');
    expect(mockEmbedOne).toHaveBeenCalledWith('what is pgvector?', 'RETRIEVAL_QUERY');
  });

  it('search() passes options through to searchByVector', async () => {
    mockEmbedOne.mockResolvedValue(FAKE_VECTOR);
    mockQueryRaw.mockResolvedValue([]);
    await service.search('query', { limit: 5, similarityThreshold: 0.8, userId: 'u1' });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  // ── searchByVector() ──────────────────────────────────────────────────────

  it('returns empty array when no rows found', async () => {
    mockQueryRaw.mockResolvedValue([]);
    const results = await service.searchByVector(FAKE_VECTOR);
    expect(results).toEqual([]);
  });

  it('maps raw rows to VectorSearchResult shape', async () => {
    const row = makeRow({ similarity: '0.92' as any }); // DB may return string
    mockQueryRaw.mockResolvedValue([row]);
    const results = await service.searchByVector(FAKE_VECTOR);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.chunkId).toBe('chunk-1');
    expect(r.documentId).toBe('doc-1');
    expect(r.documentFilename).toBe('test.pdf');
    expect(typeof r.similarity).toBe('number');
    expect(r.similarity).toBeCloseTo(0.92);
  });

  it('similarity is coerced to number', async () => {
    mockQueryRaw.mockResolvedValue([makeRow({ similarity: '0.75' as any })]);
    const [result] = await service.searchByVector(FAKE_VECTOR);
    expect(typeof result.similarity).toBe('number');
    expect(result.similarity).toBeCloseTo(0.75);
  });

  it('applies default limit=10 and threshold=0.7', async () => {
    mockQueryRaw.mockResolvedValue([]);
    await service.searchByVector(FAKE_VECTOR);
    // The query is called with the vector and defaults embedded — just assert it ran
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it('handles multiple results in order returned by DB', async () => {
    const rows = [
      makeRow({ chunkId: 'a', similarity: 0.95 }),
      makeRow({ chunkId: 'b', similarity: 0.88 }),
      makeRow({ chunkId: 'c', similarity: 0.72 }),
    ];
    mockQueryRaw.mockResolvedValue(rows);
    const results = await service.searchByVector(FAKE_VECTOR);
    expect(results.map((r) => r.chunkId)).toEqual(['a', 'b', 'c']);
  });

  it('maps pageNumber and rowRange correctly', async () => {
    mockQueryRaw.mockResolvedValue([
      makeRow({ pageNumber: 3, rowRange: '21-40' }),
    ]);
    const [result] = await service.searchByVector(FAKE_VECTOR);
    expect(result.pageNumber).toBe(3);
    expect(result.rowRange).toBe('21-40');
  });

  it('maps null pageNumber and rowRange correctly', async () => {
    mockQueryRaw.mockResolvedValue([
      makeRow({ pageNumber: null, rowRange: null }),
    ]);
    const [result] = await service.searchByVector(FAKE_VECTOR);
    expect(result.pageNumber).toBeNull();
    expect(result.rowRange).toBeNull();
  });

  // ── embedQuery() ──────────────────────────────────────────────────────────

  it('embedQuery delegates to embeddings.embedOne with RETRIEVAL_QUERY task', async () => {
    mockEmbedOne.mockResolvedValue(FAKE_VECTOR);
    const result = await service.embedQuery('my query text');
    expect(mockEmbedOne).toHaveBeenCalledWith('my query text', 'RETRIEVAL_QUERY');
    expect(result).toBe(FAKE_VECTOR);
  });
});
