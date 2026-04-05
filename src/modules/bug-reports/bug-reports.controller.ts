import {
    Body,
    Controller,
    Get,
    Post,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { BugReportsService } from './bug-reports.service';

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB

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
        FileInterceptor('screenshot', {
            limits: { fileSize: MAX_SCREENSHOT_BYTES },
        }),
    )
    @ApiOperation({ summary: 'Submit a bug report with optional screenshot' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['description'],
            properties: {
                description: { type: 'string' },
                screenshot: { type: 'string', format: 'binary' },
            },
        },
    })
    async create(
        @Req() req,
        @Body('description') description: string,
        @UploadedFile() screenshot?: Express.Multer.File,
    ) {
        if (!description?.trim()) {
            throw new BadRequestException('Description is required');
        }

        if (screenshot && !ALLOWED_MIME.has(screenshot.mimetype)) {
            throw new BadRequestException(
                'Screenshot must be a JPEG, PNG, WebP, or GIF image',
            );
        }

        const { userId, email } = req.user;

        return this.bugReportsService.create(
            userId ?? null,
            email ?? null,
            description.trim(),
            screenshot,
        );
    }
}
