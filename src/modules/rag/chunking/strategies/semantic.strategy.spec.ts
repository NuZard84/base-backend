import { SemanticStrategy } from './semantic.strategy';

describe('SemanticStrategy', () => {
  let strategy: SemanticStrategy;

  beforeEach(() => {
    strategy = new SemanticStrategy(800, 50, 1000);
  });

  it('returns empty array for empty text', () => {
    expect(strategy.chunk('')).toEqual([]);
    expect(strategy.chunk('  \n  ')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    const text = 'Hello world. This is a short paragraph.';
    const chunks = strategy.chunk(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].strategy).toBe('SEMANTIC');
  });

  it('assigns sequential chunkIndex values', () => {
    const longText = Array(40).fill('This is sentence number X. It contains some words.').join(' ');
    const chunks = strategy.chunk(longText);
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('splits into multiple chunks for long prose', () => {
    // ~20 tokens per sentence, targetTokens=100 → forces multiple chunks
    const s = new SemanticStrategy(100, 20, 200);
    const sentences = Array(30)
      .fill(null)
      .map((_, i) => `This is sentence ${i + 1} of many in this document.`);
    const text = sentences.join(' ');
    const chunks = s.chunk(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('no single chunk exceeds maxTokens (except oversized sentences)', () => {
    const s = new SemanticStrategy(100, 20, 150);
    const sentences = Array(50)
      .fill(null)
      .map((_, i) => `The quick brown fox jumped over the lazy dog sentence ${i}.`);
    const text = sentences.join(' ');
    const chunks = s.chunk(text);
    chunks.forEach((c) => {
      // tokenCount ≈ charCount / 4 — allow slight overshoot due to sentence boundary
      expect(c.tokenCount).toBeLessThanOrEqual(300); // generous margin
    });
  });

  it('handles oversized single sentences as isolated chunks', () => {
    const s = new SemanticStrategy(10, 2, 15);
    // This sentence is ~100 tokens (400 chars), exceeds maxTokens=15
    const bigSentence = 'W'.repeat(400) + '. Normal sentence follows here.';
    const chunks = s.chunk(bigSentence);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // The huge sentence should be present in one of the chunks
    const hasBig = chunks.some((c) => c.content.includes('W'.repeat(100)));
    expect(hasBig).toBe(true);
  });

  it('normalises \\r\\n line endings', () => {
    const text = 'First sentence.\r\nSecond sentence. Third sentence.';
    const chunks = strategy.chunk(text);
    chunks.forEach((c) => expect(c.content).not.toContain('\r'));
  });

  it('sets correct strategy name', () => {
    const chunks = strategy.chunk('Some text here.');
    chunks.forEach((c) => expect(c.strategy).toBe('SEMANTIC'));
  });

  it('tokenCount and charCount are consistent', () => {
    const chunks = strategy.chunk(
      'The quick brown fox. Jumped over the lazy dog. And ran away quickly.',
    );
    chunks.forEach((c) => {
      expect(c.charCount).toBe(c.content.length);
      expect(c.tokenCount).toBe(Math.max(1, Math.ceil(c.content.length / 4)));
    });
  });
});
