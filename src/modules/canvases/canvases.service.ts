import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreateCanvasDto } from './dto/create-canvas.dto';
import { RenameCanvasDto } from './dto/rename-canvas.dto';

@Injectable()
export class CanvasesService {
    constructor(private prisma: PrismaService) { }

    private generateRandomString(length: number): string {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(length * Math.random());
        }
        return result;
    }

    async create(userId: string, createDto: CreateCanvasDto) {
        let name = createDto.name;
        let description = createDto.description;

        if (!name) {
            const randomSuffix = this.generateRandomString(4);
            name = `PROOJ-${randomSuffix}`;
        }

        if (!description) {
            description = `${name}'s description`;
        }

        return this.prisma.canvas.create({
            data: {
                userId,
                name,
                description,
                viewportX: createDto.viewportX,
                viewportY: createDto.viewportY,
            },
        });
    }

    async findAll(userId: string) {
        return this.prisma.canvas.findMany({
            where: {
                userId,
            },
            select: {
                id: true,
                name: true,
                updatedAt: true,
            },
            orderBy: {
                updatedAt: 'desc',
            },
        });
    }

    async findOne(userId: string, id: string) {
        const canvas = await this.prisma.canvas.findFirst({
            where: {
                id,
                userId,
            },
            include: {
                nodes: true,
                edges: true,
            },
        });

        if (!canvas) {
            throw new NotFoundException(`Canvas with ID ${id} not found`);
        }

        return canvas;
    }

    async rename(userId: string, id: string, renameDto: RenameCanvasDto) {
        const canvas = await this.prisma.canvas.findFirst({
            where: {
                id,
                userId,
            },
        });

        if (!canvas) {
            throw new NotFoundException(`Canvas with ID ${id} not found`);
        }

        return this.prisma.canvas.update({
            where: { id },
            data: {
                name: renameDto.name,
                description: renameDto.description,
            },
        });
    }

    async remove(userId: string, id: string) {
        const canvas = await this.prisma.canvas.findFirst({
            where: {
                id,
                userId,
            },
        });

        if (!canvas) {
            throw new NotFoundException(`Canvas with ID ${id} not found`);
        }

        return this.prisma.canvas.delete({
            where: { id },
        });
    }
}
