import { Injectable } from '@nestjs/common';
import { VectorSearchResult } from '../vector-search/vector-search.service';

/** Max characters of context sent to the LLM (~8000 tokens) */
const MAX_CONTEXT_CHARS = 32_000;

export interface BuiltContext {
  contextText: string;
  sources: ContextSource[];
  truncated: boolean;
}

export interface ContextSource {
  index: number;
  chunkId: string;
  documentId: string;
  documentFilename: string;
  pageNumber: number | null;
  rowRange: string | null;
  similarity: number;
  content: string;
}

export interface RagPromptParts {
  systemPrompt: string;
  userMessage: string;
}

@Injectable()
export class PromptBuilderService {
  /**
   * Assembles retrieved chunks into a numbered context block with source citations.
   * Respects MAX_CONTEXT_CHARS budget — drops lowest-similarity chunks if needed.
   */
  buildContext(chunks: VectorSearchResult[]): BuiltContext {
    // Sort by similarity descending; highest-relevance chunks go first
    const sorted = [...chunks].sort((a, b) => b.similarity - a.similarity);

    const sources: ContextSource[] = [];
    const parts: string[] = [];
    let totalChars = 0;
    let truncated = false;

    for (let i = 0; i < sorted.length; i++) {
      const chunk = sorted[i];
      const location = this.formatLocation(chunk);
      const block = `[${i + 1}] ${chunk.documentFilename}${location}\n${chunk.content}`;

      if (totalChars + block.length > MAX_CONTEXT_CHARS) {
        truncated = true;
        break;
      }

      parts.push(block);
      totalChars += block.length;
      sources.push({
        index: i + 1,
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentFilename: chunk.documentFilename,
        pageNumber: chunk.pageNumber,
        rowRange: chunk.rowRange,
        similarity: chunk.similarity,
        content: chunk.content,
      });
    }

    const contextText = parts.join('\n\n---\n\n');
    return { contextText, sources, truncated };
  }

  /**
   * Builds the system + user prompt for the RAG generation call.
   */
  buildPrompt(query: string, builtContext: BuiltContext): RagPromptParts {
    const systemPrompt = `You are an expert document assistant. Answer questions using ONLY the provided document context.

Rules:
- Cite every claim with [1], [2], … matching the source numbers in the context block.
- If the context does not contain enough information, say so — never fabricate or guess.
- Be thorough yet concise. Use bullet points, numbered lists, or markdown tables when they improve clarity.
- Reproduce numbers, dates, names, and figures exactly as they appear in the sources.

Handling different content types:
- **CSV / tabular data**: Summarise patterns, totals, and notable values. If asked "what is in this file", describe the columns, row count, and the kind of data it contains.
- **PDF documents**: Reference page numbers when citing.
- **Images**: Describe what was extracted (OCR text or visual description).

If multiple sources are relevant, synthesise them into one coherent answer rather than listing each source separately.`;

    const truncationNote = builtContext.truncated
      ? '\n\n[Note: Some context was omitted due to length limits.]'
      : '';

    const userMessage =
      `Context from your documents:\n\n${builtContext.contextText}${truncationNote}\n\n---\n\nQuestion: ${query}`;

    return { systemPrompt, userMessage };
  }

  private formatLocation(chunk: VectorSearchResult): string {
    if (chunk.pageNumber != null) return ` (Page ${chunk.pageNumber})`;
    if (chunk.rowRange) return ` (Rows ${chunk.rowRange})`;
    return '';
  }
}
