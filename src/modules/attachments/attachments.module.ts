import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { S3Service } from './s3.service';

@Module({
    controllers: [AttachmentsController],
    providers: [AttachmentsService, S3Service],
    exports: [AttachmentsService],
})
export class AttachmentsModule {}
