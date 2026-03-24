import { CsvRowStrategy } from './csv-row.strategy';

const CSV_5_ROWS = `name,age,city
Alice,30,London
Bob,25,Paris
Charlie,35,Berlin
Diana,28,Tokyo
Eve,32,Sydney`;

const CSV_25_ROWS = [
  'id,product,price',
  ...Array.from({ length: 25 }, (_, i) => `${i + 1},Product${i + 1},${(i + 1) * 10}`),
].join('\n');

describe('CsvRowStrategy', () => {
  let strategy: CsvRowStrategy;

  beforeEach(() => {
    strategy = new CsvRowStrategy(20);
  });

  it('returns empty array for empty/headerless CSV', () => {
    expect(strategy.chunk('')).toEqual([]);
    expect(strategy.chunk('\n\n')).toEqual([]);
  });

  it('returns a single chunk for few rows (< rowsPerChunk)', () => {
    const chunks = strategy.chunk(CSV_5_ROWS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].rowRange).toBe('1-5');
    expect(chunks[0].strategy).toBe('CSV_ROW');
  });

  it('includes column names in each chunk content', () => {
    const chunks = strategy.chunk(CSV_5_ROWS);
    expect(chunks[0].content).toContain('name');
    expect(chunks[0].content).toContain('age');
    expect(chunks[0].content).toContain('city');
  });

  it('splits into 2 chunks for 25 rows with rowsPerChunk=20', () => {
    const chunks = strategy.chunk(CSV_25_ROWS);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].rowRange).toBe('1-20');
    expect(chunks[1].rowRange).toBe('21-25');
  });

  it('repeats header row in every chunk', () => {
    const chunks = strategy.chunk(CSV_25_ROWS);
    expect(chunks).toHaveLength(2);
    chunks.forEach((c) => {
      expect(c.content).toContain('id');
      expect(c.content).toContain('product');
      expect(c.content).toContain('price');
    });
  });

  it('sequential chunkIndex values', () => {
    const chunks = strategy.chunk(CSV_25_ROWS);
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('respects custom rowsPerChunk', () => {
    const s = new CsvRowStrategy(5);
    const chunks = s.chunk(CSV_25_ROWS);
    expect(chunks).toHaveLength(5);
    expect(chunks[0].rowRange).toBe('1-5');
    expect(chunks[4].rowRange).toBe('21-25');
  });

  it('charCount matches content length', () => {
    const chunks = strategy.chunk(CSV_5_ROWS);
    chunks.forEach((c) => {
      expect(c.charCount).toBe(c.content.length);
    });
  });

  it('handles CSV with a single data row', () => {
    const csv = 'col1,col2\nval1,val2';
    const chunks = strategy.chunk(csv);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].rowRange).toBe('1-1');
    expect(chunks[0].content).toContain('val1');
  });

  it('includes actual row data in chunk content', () => {
    const chunks = strategy.chunk(CSV_5_ROWS);
    expect(chunks[0].content).toContain('Alice');
    expect(chunks[0].content).toContain('London');
  });
});
