import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreatePrePromptDto } from './dto/create-pre-prompt.dto';
import { PrePromptTemplateType } from '@prisma/client';

@Injectable()
export class PrePromptsService {
  constructor(private prisma: PrismaService) {}

  private mapTypeToEnum(
    type: 'system' | 'user' | 'feature' | undefined,
  ): PrePromptTemplateType {
    if (!type || type === 'system') return PrePromptTemplateType.SYSTEM;
    if (type === 'user') return PrePromptTemplateType.USER;
    return PrePromptTemplateType.FEATURE;
  }

  private mapEnumToType(type: PrePromptTemplateType): string {
    return type.toLowerCase();
  }

  async create(userId: string, dto: CreatePrePromptDto) {
    const template = await this.prisma.prePromptTemplate.create({
      data: {
        name: dto.name,
        prompt: dto.prompt,
        type: this.mapTypeToEnum(dto.type),
        userId, // User-created templates are linked to the user; system templates from seed have userId: null
      },
    });
    return this.toResponse(template);
  }

  async findAll(userId: string) {
    const templates = await this.prisma.prePromptTemplate.findMany({
      where: {
        OR: [{ userId: null }, { userId }],
      },
      orderBy: { createdAt: 'asc' },
    });
    return templates.map((t) => this.toResponse(t));
  }

  private toResponse(template: {
    id: string;
    name: string;
    prompt: string;
    type: PrePromptTemplateType;
  }) {
    return {
      id: template.id,
      name: template.name,
      prompt: template.prompt,
      type: this.mapEnumToType(template.type),
    };
  }
}
