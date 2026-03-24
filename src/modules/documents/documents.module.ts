import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AiProviderModule } from '../ai-model-api/ai-provider.module';
import { RagModule } from '../rag/rag.module';
import { DocumentsEventsModule } from './documents-events.module';
import { PdfParser } from './parsers/pdf.parser';
import { CsvParser } from './parsers/csv.parser';
import { ImageParser } from './parsers/image.parser';
import { FileParserService } from './parsers/file-parser.service';
import { SummarizeService } from './summarize.service';
import { SummarizeController } from './summarize.controller';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';

@Module({
  imports: [
    AttachmentsModule,        // S3Service, AttachmentsService
    AiProviderModule,         // AiProviderFactory (Gemini, OpenAI, Claude)
    RagModule,                // ProcessingService (BullMQ job enqueue)
    DocumentsEventsModule,    // DocumentsGateway
  ],
  controllers: [DocumentsController, SummarizeController],
  providers: [
    DocumentsService,
    PdfParser,
    CsvParser,
    ImageParser,
    FileParserService,
    SummarizeService,
  ],
  exports: [DocumentsService, SummarizeService, FileParserService],
})
export class DocumentsModule {}
