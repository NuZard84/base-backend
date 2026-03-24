import { PromptBuilderService } from './prompt-builder.service';
import { VectorSearchResult } from '../vector-search/vector-search.service';

function makeChunk(overrides: Partial<VectorSearchResult> = {}): VectorSearchResult {
  return {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    chunkIndex: 0,
    content: 'The quick brown fox jumped over the lazy dog.',
    pageNumber: null,
    rowRange: null,
    similarity: 0.85,
    documentFilename: 'test.pdf',
    ...overrides,
  };
}

describe('PromptBuilderService', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    service = new PromptBuilderService();
  });

  // ── buildContext ──────────────────────────────────────────────────────────

  it('returns empty context for empty chunks array', () => {
    const result = service.buildContext([]);
    expect(result.contextText).toBe('');
    expect(result.sources).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('builds context with numbered citations', () => {
    const chunks = [makeChunk({ chunkId: 'c1', similarity: 0.9 })];
    const { contextText, sources } = service.buildContext(chunks);
    expect(contextText).toContain('[1]');
    expect(sources).toHaveLength(1);
    expect(sources[0].index).toBe(1);
    expect(sources[0].chunkId).toBe('c1');
  });

  it('sorts chunks by similarity descending', () => {
    const chunks = [
      makeChunk({ chunkId: 'low', similarity: 0.7 }),
      makeChunk({ chunkId: 'high', similarity: 0.95 }),
      makeChunk({ chunkId: 'mid', similarity: 0.82 }),
    ];
    const { sources } = service.buildContext(chunks);
    expect(sources[0].chunkId).toBe('high');
    expect(sources[1].chunkId).toBe('mid');
    expect(sources[2].chunkId).toBe('low');
  });

  it('includes page number in context when present', () => {
    const { contextText } = service.buildContext([makeChunk({ pageNumber: 5 })]);
    expect(contextText).toContain('Page 5');
  });

  it('includes row range in context when present', () => {
    const { contextText } = service.buildContext([makeChunk({ rowRange: '1-20' })]);
    expect(contextText).toContain('Rows 1-20');
  });

  it('includes document filename in context', () => {
    const { contextText } = service.buildContext([makeChunk({ documentFilename: 'report.pdf' })]);
    expect(contextText).toContain('report.pdf');
  });

  it('separates multiple chunks with separator', () => {
    const chunks = [
      makeChunk({ chunkId: 'a', similarity: 0.9, content: 'First chunk content.' }),
      makeChunk({ chunkId: 'b', similarity: 0.8, content: 'Second chunk content.' }),
    ];
    const { contextText } = service.buildContext(chunks);
    expect(contextText).toContain('---');
  });

  it('truncates when context exceeds 16KB budget', () => {
    // Each chunk ~2000 chars, 16000 / 2000 = 8 fit, 9th should be dropped
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk({
        chunkId: `c${i}`,
        similarity: (10 - i) / 10,
        content: 'X'.repeat(1800),
      }),
    );
    const { truncated, sources } = service.buildContext(chunks);
    expect(truncated).toBe(true);
    expect(sources.length).toBeLessThan(10);
  });

  it('sets truncated=false when all chunks fit in budget', () => {
    const chunks = [makeChunk()];
    const { truncated } = service.buildContext(chunks);
    expect(truncated).toBe(false);
  });

  // ── buildPrompt ───────────────────────────────────────────────────────────

  it('includes the query in the user message', () => {
    const builtContext = service.buildContext([makeChunk()]);
    const { userMessage } = service.buildPrompt('What is a fox?', builtContext);
    expect(userMessage).toContain('What is a fox?');
  });

  it('includes the context text in the user message', () => {
    const builtContext = service.buildContext([makeChunk({ content: 'Unique content ABC' })]);
    const { userMessage } = service.buildPrompt('query', builtContext);
    expect(userMessage).toContain('Unique content ABC');
  });

  it('adds truncation note when context was truncated', () => {
    // Force truncation by passing pre-built context with truncated=true
    const builtContext = { contextText: 'some context', sources: [], truncated: true };
    const { userMessage } = service.buildPrompt('query', builtContext);
    expect(userMessage).toContain('omitted due to length limits');
  });

  it('does not add truncation note when context was not truncated', () => {
    const builtContext = { contextText: 'some context', sources: [], truncated: false };
    const { userMessage } = service.buildPrompt('query', builtContext);
    expect(userMessage).not.toContain('omitted');
  });

  it('system prompt includes citation instruction', () => {
    const builtContext = service.buildContext([]);
    const { systemPrompt } = service.buildPrompt('q', builtContext);
    expect(systemPrompt).toContain('[1]');
    expect(systemPrompt).toContain('cite');
  });

  it('system prompt instructs not to fabricate', () => {
    const builtContext = service.buildContext([]);
    const { systemPrompt } = service.buildPrompt('q', builtContext);
    expect(systemPrompt).toContain('fabricate');
  });
});
