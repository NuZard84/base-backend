import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { S3Service } from '../attachments/s3.service';
import { FileParserService } from './parsers/file-parser.service';
import { AiProviderFactory } from '../ai-model-api/ai-provider.factory';
import { SummarizeAttachmentDto } from './dto/summarize-attachment.dto';

@Injectable()
export class SummarizeService {
  private readonly logger = new Logger(SummarizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly fileParser: FileParserService,
    private readonly aiProviderFactory: AiProviderFactory,
  ) {}

  async summarizeAttachment(userId: string, attachmentId: string, dto: SummarizeAttachmentDto) {
    // 1. Fetch attachment from DB
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment) {
      throw new NotFoundException(`Attachment "${attachmentId}" not found`);
    }
    if (attachment.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    this.logger.log(
      `Summarizing attachment "${attachment.filename}" for user=${userId} via provider=${dto.provider ?? 'default'}`,
    );

    // 2. Download file from S3
    const buffer = await this.s3.getBuffer(attachment.key);

    // 3. Parse the file content
    const parsedContent = await this.fileParser.parse(
      buffer,
      attachment.filename,
      attachment.mimeType,
    );

    // 4. Resolve AI provider and summarize
    const provider = this.aiProviderFactory.getProvider(dto.provider);
    const result = await provider.summarize(parsedContent, {
      customPrompt: dto.customPrompt,
      responseLength: dto.responseLength,
      model: dto.model,
    });

    return {
      attachmentId: attachment.id,
      filename: attachment.filename,
      fileType: attachment.type,
      mimeType: attachment.mimeType,
      summary: result.summary,
      provider: result.provider,
      model: result.model,
      meta: parsedContent.meta ?? {},
    };
  }

  /** Returns all available providers and their configuration status */
  listProviders() {
    return this.aiProviderFactory.listProviders();
  }
}
