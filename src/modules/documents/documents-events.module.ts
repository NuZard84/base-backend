import { Module } from '@nestjs/common';
import { DocumentsGateway } from './documents.gateway';

/** Standalone module so both DocumentsModule and RagModule can import it without circular deps */
@Module({
  providers: [DocumentsGateway],
  exports: [DocumentsGateway],
})
export class DocumentsEventsModule {}
