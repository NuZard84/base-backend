import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreatePrePromptDto } from './dto/create-pre-prompt.dto';
import { UpdatePrePromptDto } from './dto/update-pre-prompt.dto';
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

  async update(userId: string, id: string, dto: UpdatePrePromptDto) {
    const template = await this.prisma.prePromptTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    if (template.userId === null) {
      throw new ForbiddenException('System templates cannot be edited');
    }
    if (template.userId !== userId) {
      throw new ForbiddenException('You can only edit your own templates');
    }
    const updated = await this.prisma.prePromptTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.prompt !== undefined && { prompt: dto.prompt }),
        ...(dto.type !== undefined && { type: this.mapTypeToEnum(dto.type) }),
      },
    });
    return this.toResponse(updated);
  }

  async remove(userId: string, id: string) {
    const template = await this.prisma.prePromptTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    if (template.userId === null) {
      throw new ForbiddenException('System templates cannot be deleted');
    }
    if (template.userId !== userId) {
      throw new ForbiddenException('You can only delete your own templates');
    }
    await this.prisma.prePromptTemplate.delete({
      where: { id },
    });
    return { success: true };
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
