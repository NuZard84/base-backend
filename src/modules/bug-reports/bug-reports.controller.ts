import {
    Body,
    Controller,
    Get,
    Post,
    Req,
    UploadedFiles,
    UseGuards,
    UseInterceptors,
    BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { BugReportsService } from './bug-reports.service';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 5;

const ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
]);

@ApiTags('Bug Reports')
@ApiBearerAuth()
@Controller('bug-reports')
export class BugReportsController {
    constructor(private readonly bugReportsService: BugReportsService) {}

    @Get('my')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get bug reports submitted by the current user' })
    getMyReports(@Req() req) {
        return this.bugReportsService.findByUser(req.user.userId);
    }

    @Post()
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(
        FilesInterceptor('screenshots', MAX_FILES, {
            limits: { fileSize: MAX_FILE_BYTES },
        }),
    )
    @ApiOperation({ summary: 'Submit a bug report with optional screenshots (up to 5)' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['description'],
            properties: {
                description: { type: 'string' },
                screenshots: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                },
            },
        },
    })
    async create(
        @Req() req,
        @Body('description') description: string,
        @UploadedFiles() screenshots?: Express.Multer.File[],
    ) {
        if (!description?.trim()) {
            throw new BadRequestException('Description is required');
        }

        const files = screenshots ?? [];

        const invalid = files.find(f => !ALLOWED_MIME.has(f.mimetype));
        if (invalid) {
            throw new BadRequestException(
                'Screenshots must be JPEG, PNG, WebP, or GIF images',
            );
        }

        const { userId, email } = req.user;

        return this.bugReportsService.create(
            userId ?? null,
            email ?? null,
            description.trim(),
            files,
        );
    }
}
