import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import { GoogleGenAI } from '@google/genai';
import { PrismaService } from 'prisma/prisma.service';
import { VectorSearchService } from '../vector-search/vector-search.service';
import { PromptBuilderService, ContextSource } from './prompt-builder.service';
import { RagQueryDto, VectorSearchDto } from './dto/rag-query.dto';
import { PlanService } from '../../../common/plans/plan.service';
import { RESOURCE_TYPES } from '../../../common/plans/plan-config';
import { normalizeTokenUsage } from '../../../common/ai/token-usage';

export interface RagQueryResponse {
  query: string;
  response: string;
  sources: ContextSource[];
  provider: string;
  model: string;
  retrievalTimeMs: number;
  generationTimeMs: number;
  queryId: string;
}

export interface StreamChunk {
  type: 'token' | 'sources' | 'done' | 'error';
  token?: string;
  sources?: ContextSource[];
  queryId?: string;
  error?: string;
}

const DEFAULT_MODEL = 'gemini-2.5-flash';
const COMPLEX_MODEL = 'gemini-2.5-pro';

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);
  private genAI: GoogleGenAI | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly vectorSearch: VectorSearchService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly planService: PlanService,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenAI({ apiKey });
    } else {
      this.logger.warn('GEMINI_API_KEY not set — QueryService inactive');
    }
  }

  // ── POST /rag/query ────────────────────────────────────────────────────────

  async query(userId: string, dto: RagQueryDto): Promise<RagQueryResponse> {
    this.ensureConfigured();

    const t0 = Date.now();

    // 1. Retrieve relevant chunks
    const chunks = await this.vectorSearch.search(dto.query, {
      userId,
      documentIds: dto.documentIds,
      limit: dto.limit ?? 10,
      similarityThreshold: dto.similarityThreshold ?? 0.35,
    });

    const retrievalTimeMs = Date.now() - t0;

    if (chunks.length === 0) {
      return {
        query: dto.query,
        response:
          "I couldn't find any relevant information in your documents for this question. " +
          'Try uploading more documents or rephrasing your query.',
        sources: [],
        provider: 'gemini',
        model: dto.model ?? DEFAULT_MODEL,
        retrievalTimeMs,
        generationTimeMs: 0,
        queryId: '',
      };
    }

    // 2. Build context + prompt
    const builtContext = this.promptBuilder.buildContext(chunks);
    const { systemPrompt, userMessage } = this.promptBuilder.buildPrompt(dto.query, builtContext);

    // 3. Generate
    const t1 = Date.now();
    const model = dto.model ?? DEFAULT_MODEL;

    const result = await this.genAI!.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      config: { systemInstruction: systemPrompt },
    });

    const responseText = result.text ?? '';
    const generationTimeMs = Date.now() - t1;
    const tokenUsage = normalizeTokenUsage('gemini', (result as any).usageMetadata);

    // 4. Persist to RAGQuery log
    const ragQuery = await this.prisma.rAGQuery.create({
      data: {
        userId,
        query: dto.query,
        retrievedChunkIds: builtContext.sources.map((s) => s.chunkId),
        contextText: builtContext.contextText,
        response: responseText,
        provider: dto.provider ?? 'gemini',
        model,
        retrievalTimeMs,
        generationTimeMs,
        documentIds: [...new Set(builtContext.sources.map((s) => s.documentId))],
      },
    });

    // Fire-and-forget usage log — never block the response
    this.planService.logUsage(
      userId,
      RESOURCE_TYPES.AI_REQUEST,
      1,
      { source: 'rag_query', model, queryId: ragQuery.id },
      tokenUsage?.totalTokens,
    ).catch((err) => this.logger.warn(`Failed to log RAG usage: ${err.message}`));

    this.logger.log(
      `RAG query done queryId=${ragQuery.id} chunks=${chunks.length} ` +
        `retrieval=${retrievalTimeMs}ms generation=${generationTimeMs}ms`,
    );

    return {
      query: dto.query,
      response: responseText,
      sources: builtContext.sources,
      provider: dto.provider ?? 'gemini',
      model,
      retrievalTimeMs,
      generationTimeMs,
      queryId: ragQuery.id,
    };
  }

  // ── POST /rag/query/stream ─────────────────────────────────────────────────

  streamQuery(userId: string, dto: RagQueryDto): Observable<MessageEvent> {
    this.ensureConfigured();

    const subject = new Subject<MessageEvent>();

    // Run the async pipeline and push events into the subject
    this.runStreamPipeline(userId, dto, subject).catch((err) => {
      this.logger.error(`Stream pipeline error: ${err.message}`, err.stack);
      subject.next(this.sseEvent({ type: 'error', error: err.message } satisfies StreamChunk));
      subject.complete();
    });

    return subject.asObservable();
  }

  private async runStreamPipeline(
    userId: string,
    dto: RagQueryDto,
    subject: Subject<MessageEvent>,
  ): Promise<void> {
    // 1. Retrieve + build context (same as non-streaming)
    const t0 = Date.now();
    const chunks = await this.vectorSearch.search(dto.query, {
      userId,
      documentIds: dto.documentIds,
      limit: dto.limit ?? 10,
      similarityThreshold: dto.similarityThreshold ?? 0.35,
    });
    const retrievalTimeMs = Date.now() - t0;

    if (chunks.length === 0) {
      subject.next(
        this.sseEvent({
          type: 'token',
          token: "I couldn't find relevant information in your documents for this question.",
        } satisfies StreamChunk),
      );
      subject.next(this.sseEvent({ type: 'sources', sources: [] } satisfies StreamChunk));
      subject.next(this.sseEvent({ type: 'done' } satisfies StreamChunk));
      subject.complete();
      return;
    }

    const builtContext = this.promptBuilder.buildContext(chunks);
    const { systemPrompt, userMessage } = this.promptBuilder.buildPrompt(dto.query, builtContext);

    // 2. Emit sources early so the UI can render them while tokens stream in
    subject.next(
      this.sseEvent({ type: 'sources', sources: builtContext.sources } satisfies StreamChunk),
    );

    // 3. Stream tokens from Gemini
    const t1 = Date.now();
    const model = dto.model ?? DEFAULT_MODEL;
    let fullResponse = '';
    let lastUsageMetadata: any = null;

    const stream = this.genAI!.models.generateContentStream({
      model,
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      config: { systemInstruction: systemPrompt },
    });

    for await (const chunk of await stream) {
      const token = chunk.text ?? '';
      if (token) {
        fullResponse += token;
        subject.next(this.sseEvent({ type: 'token', token } satisfies StreamChunk));
      }
      // usageMetadata appears on the last chunk
      if ((chunk as any).usageMetadata) {
        lastUsageMetadata = (chunk as any).usageMetadata;
      }
    }

    const generationTimeMs = Date.now() - t1;
    const tokenUsage = normalizeTokenUsage('gemini', lastUsageMetadata);

    // 4. Persist
    const ragQuery = await this.prisma.rAGQuery.create({
      data: {
        userId,
        query: dto.query,
        retrievedChunkIds: builtContext.sources.map((s) => s.chunkId),
        contextText: builtContext.contextText,
        response: fullResponse,
        provider: dto.provider ?? 'gemini',
        model,
        retrievalTimeMs,
        generationTimeMs,
        documentIds: [...new Set(builtContext.sources.map((s) => s.documentId))],
      },
    });

    // Fire-and-forget usage log for streaming queries
    this.planService.logUsage(
      userId,
      RESOURCE_TYPES.AI_REQUEST,
      1,
      { source: 'rag_stream', model, queryId: ragQuery.id },
      tokenUsage?.totalTokens,
    ).catch((err) => this.logger.warn(`Failed to log RAG stream usage: ${err.message}`));

    subject.next(this.sseEvent({ type: 'done', queryId: ragQuery.id } satisfies StreamChunk));
    subject.complete();
  }

  // ── GET /rag/search ────────────────────────────────────────────────────────

  async search(userId: string, dto: VectorSearchDto) {
    const results = await this.vectorSearch.search(dto.query, {
      userId,
      documentIds: dto.documentIds,
      limit: dto.limit ?? 10,
      similarityThreshold: dto.similarityThreshold ?? 0.35,
    });

    return {
      query: dto.query,
      results: results.map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        documentFilename: r.documentFilename,
        content: r.content,
        similarity: r.similarity,
        pageNumber: r.pageNumber,
        rowRange: r.rowRange,
      })),
      count: results.length,
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private ensureConfigured() {
    if (!this.genAI) {
      throw new BadRequestException('GEMINI_API_KEY is not configured on the server.');
    }
  }

  private sseEvent(data: StreamChunk): MessageEvent {
    // Pass the object directly — NestJS @Sse() calls JSON.stringify(event.data)
    // internally. Pre-serialising to a string caused double-encoding:
    //   SSE line → data: "{\"type\":\"done\"...}"   ← outer quotes from JSON.stringify(string)
    //   JSON.parse → returns a string, not an object
    //   chunk.type → undefined → switch never matched → node stuck forever
    return { data } as MessageEvent;
  }
}
