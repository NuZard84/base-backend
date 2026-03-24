import { FixedSizeStrategy } from './fixed-size.strategy';

describe('FixedSizeStrategy', () => {
  let strategy: FixedSizeStrategy;

  beforeEach(() => {
    strategy = new FixedSizeStrategy(512, 50);
  });

  it('throws if overlapTokens >= targetTokens', () => {
    expect(() => new FixedSizeStrategy(100, 100)).toThrow(
      'overlapTokens (100) must be less than targetTokens (100)',
    );
    expect(() => new FixedSizeStrategy(50, 60)).toThrow(
      'overlapTokens (60) must be less than targetTokens (50)',
    );
  });

  it('returns empty array for empty/whitespace text', () => {
    expect(strategy.chunk('')).toEqual([]);
    expect(strategy.chunk('   ')).toEqual([]);
    expect(strategy.chunk('\r\n\r\n')).toEqual([]);
  });

  it('returns a single chunk for short text', () => {
    const text = 'Hello world.';
    const chunks = strategy.chunk(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].content).toBe('Hello world.');
    expect(chunks[0].strategy).toBe('FIXED_SIZE');
  });

  it('assigns sequential chunkIndex values', () => {
    // targetTokens=10 → targetChars=40, overlap=2 → overlapChars=8
    const s = new FixedSizeStrategy(10, 2);
    const text = 'A'.repeat(200);
    const chunks = s.chunk(text);
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('produces multiple chunks for long text', () => {
    // targetTokens=10 (40 chars), overlap=2 (8 chars) → step=32 chars
    const s = new FixedSizeStrategy(10, 2);
    const text = 'X'.repeat(200);
    const chunks = s.chunk(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('chunk content length does not exceed targetChars', () => {
    const targetTokens = 20;
    const s = new FixedSizeStrategy(targetTokens, 2);
    const text = 'B'.repeat(500);
    const chunks = s.chunk(text);
    chunks.forEach((c) => {
      expect(c.charCount).toBeLessThanOrEqual(targetTokens * 4);
    });
  });

  it('consecutive chunks share overlap content', () => {
    // targetTokens=10 → 40 chars, overlap=2 → 8 chars; step = 32
    const s = new FixedSizeStrategy(10, 2);
    const text = 'ABCDEFGHIJ'.repeat(20); // 200 chars, repeating pattern
    const chunks = s.chunk(text);
    if (chunks.length >= 2) {
      // The end of chunk[0] should appear at the start of chunk[1]
      const endOfFirst = chunks[0].content.slice(-8);
      expect(chunks[1].content.startsWith(endOfFirst)).toBe(true);
    }
  });

  it('normalises \\r\\n to \\n', () => {
    const text = 'line1\r\nline2\r\nline3';
    const chunks = strategy.chunk(text);
    expect(chunks[0].content).not.toContain('\r');
  });

  it('tokenCount and charCount are consistent', () => {
    const chunks = strategy.chunk('The quick brown fox jumped over the lazy dog. '.repeat(50));
    chunks.forEach((c) => {
      expect(c.charCount).toBe(c.content.length);
      // estimateTokens uses chars/4
      expect(c.tokenCount).toBe(Math.ceil(c.content.length / 4));
    });
  });
});
