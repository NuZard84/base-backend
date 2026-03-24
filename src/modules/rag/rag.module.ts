import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AttachmentsModule } from '../attachments/attachments.module';
import { DocumentsEventsModule } from '../documents/documents-events.module';
import { RedisModule } from '../../redis/redis.module';

// Processing
import { QUEUES } from './processing/processing.constants';
import { ProcessingService } from './processing/processing.service';
import { DocumentProcessor } from './processing/document.processor';
import { ChunkProcessor } from './processing/chunk.processor';
import { EmbedProcessor } from './processing/embed.processor';
import { PdfProcessorHelper } from './processing/processors/pdf.processor';
import { CsvProcessorHelper } from './processing/processors/csv.processor';
import { ImageProcessorHelper } from './processing/processors/image.processor';

// Chunking
import { FixedSizeStrategy } from './chunking/strategies/fixed-size.strategy';
import { SemanticStrategy } from './chunking/strategies/semantic.strategy';
import { CsvRowStrategy } from './chunking/strategies/csv-row.strategy';
import { ChunkingService } from './chunking/chunking.service';

// Embeddings
import { EmbeddingsCache } from './embeddings/embeddings.cache';
import { EmbeddingsService } from './embeddings/embeddings.service';

// Vector search
import { VectorSearchService } from './vector-search/vector-search.service';

// Query (RAG pipeline)
import { PromptBuilderService } from './query/prompt-builder.service';
import { QueryService } from './query/query.service';
import { QueryController } from './query/query.controller';

@Module({
  imports: [
    ConfigModule,
    AttachmentsModule,        // S3Service
    DocumentsEventsModule,    // DocumentsGateway (shared, no circular dep)
    RedisModule,              // RedisService for embeddings cache
    BullModule.registerQueue(
      { name: QUEUES.DOCUMENT_PROCESS },
      { name: QUEUES.DOCUMENT_CHUNK },
      { name: QUEUES.DOCUMENT_EMBED },
    ),
  ],
  providers: [
    // Processing workers
    ProcessingService,
    DocumentProcessor,
    ChunkProcessor,
    EmbedProcessor,
    PdfProcessorHelper,
    CsvProcessorHelper,
    ImageProcessorHelper,
    // Chunking strategies: constructors use primitives — Nest cannot inject them; use factories.
    {
      provide: FixedSizeStrategy,
      useFactory: () => new FixedSizeStrategy(512, 50),
    },
    {
      provide: SemanticStrategy,
      useFactory: () => new SemanticStrategy(800, 50, 1000),
    },
    {
      provide: CsvRowStrategy,
      useFactory: () => new CsvRowStrategy(20),
    },
    ChunkingService,
    // Embeddings
    EmbeddingsCache,
    EmbeddingsService,
    // Vector search
    VectorSearchService,
    // Query pipeline
    PromptBuilderService,
    QueryService,
  ],
  controllers: [QueryController],
  exports: [ProcessingService, ChunkingService, EmbeddingsService, VectorSearchService, QueryService],
})
export class RagModule {}
