import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { S3Service } from '../attachments/s3.service';
import { BugReportStatus } from '@prisma/client';

@Injectable()
export class BugReportsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly s3: S3Service,
    ) {}

    async create(
        userId: string | null,
        userEmail: string | null,
        description: string,
        screenshotFiles: Express.Multer.File[] = [],
    ) {
        // Upload all screenshots in parallel
        const screenshotKeys = await Promise.all(
            screenshotFiles.map(async (file) => {
                const ext = file.originalname.split('.').pop() ?? 'png';
                const key = `bug-reports/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                await this.s3.upload({
                    key,
                    body: file.buffer,
                    contentType: file.mimetype,
                });
                return key;
            }),
        );

        // Fetch user name if we have userId
        let userName: string | null = null;
        if (userId) {
            const u = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { name: true },
            });
            userName = u?.name ?? null;
        }

        return this.prisma.bugReport.create({
            data: {
                userId: userId ?? undefined,
                userEmail,
                userName,
                description,
                screenshotKey: screenshotKeys[0] ?? null,   // keep legacy field populated
                screenshotKeys,
            },
            select: {
                id: true,
                status: true,
                createdAt: true,
            },
        });
    }

    async findAll(params: {
        page: number;
        pageSize: number;
        status?: string;
    }) {
        const { page, pageSize, status } = params;
        const skip = (page - 1) * pageSize;

        const where = status
            ? { status: status as BugReportStatus }
            : undefined;

        const [items, total] = await Promise.all([
            this.prisma.bugReport.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: pageSize,
                select: {
                    id: true,
                    description: true,
                    screenshotKey: true,
                    screenshotKeys: true,
                    status: true,
                    userEmail: true,
                    userName: true,
                    adminNote: true,
                    createdAt: true,
                    updatedAt: true,
                    user: {
                        select: { id: true, email: true, name: true, image: true, plan: true },
                    },
                },
            }),
            this.prisma.bugReport.count({ where }),
        ]);

        // Attach presigned screenshot URLs for all images
        const itemsWithUrls = await Promise.all(
            items.map(async (r) => {
                const keys = r.screenshotKeys.length > 0
                    ? r.screenshotKeys
                    : (r.screenshotKey ? [r.screenshotKey] : []);

                const screenshotUrls = await Promise.all(
                    keys.map(key => this.s3.getPresignedUrl({ key, disposition: 'inline', expiresIn: 3600 })),
                );
                return { ...r, screenshotUrls };
            }),
        );

        return {
            items: itemsWithUrls,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        };
    }

    async updateStatus(id: string, status: BugReportStatus, adminNote?: string) {
        const report = await this.prisma.bugReport.findUnique({ where: { id } });
        if (!report) throw new NotFoundException('Bug report not found');

        return this.prisma.bugReport.update({
            where: { id },
            data: {
                status,
                ...(adminNote !== undefined ? { adminNote } : {}),
            },
            select: {
                id: true,
                status: true,
                adminNote: true,
                updatedAt: true,
            },
        });
    }

    async findByUser(userId: string) {
        const items = await this.prisma.bugReport.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
                id: true,
                description: true,
                screenshotKey: true,
                screenshotKeys: true,
                status: true,
                adminNote: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return Promise.all(
            items.map(async (r) => {
                const keys = r.screenshotKeys.length > 0
                    ? r.screenshotKeys
                    : (r.screenshotKey ? [r.screenshotKey] : []);

                const screenshotUrls = await Promise.all(
                    keys.map(key => this.s3.getPresignedUrl({ key, disposition: 'inline', expiresIn: 3600 })),
                );
                return { ...r, screenshotUrls };
            }),
        );
    }

    async getStats() {
        const counts = await this.prisma.bugReport.groupBy({
            by: ['status'],
            _count: { _all: true },
        });
        return counts.reduce(
            (acc, c) => ({ ...acc, [c.status]: c._count._all }),
            {} as Record<string, number>,
        );
    }
}
