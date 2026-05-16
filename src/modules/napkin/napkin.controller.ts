import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    Query,
    Res,
    Req,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { NapkinService } from './napkin.service';
import { PlanService } from '../../common/plans/plan.service';
import { CreditService } from '../../common/credits/credit.service';
import { RESOURCE_TYPES } from '../../common/plans/plan-config';
import { GenerateVisualDto } from './dto/generate-visual.dto';

@ApiTags('Napkin Visuals')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('napkin')
export class NapkinController {
    constructor(
        private readonly napkinService: NapkinService,
        private readonly planService: PlanService,
        private readonly creditService: CreditService,
    ) {}

    @Post('generate')
    @ApiOperation({ summary: 'Submit a text-to-visual generation request (async)' })
    async generate(@Req() req: any, @Body() dto: GenerateVisualDto) {
        const userId = req.user?.userId ?? req.user?.id;
        await this.planService.requireFeature(userId, 'vizoraInfographic');
        await this.planService.checkLimit(userId, 'vizora_gen');
        const cost = await this.creditService.getCost('vizora_gen');
        await this.creditService.check(userId, cost);
        const result = await this.napkinService.createVisualRequest(dto);
        await this.planService.logUsage(userId, RESOURCE_TYPES.VIZORA_GEN, 1, {
            requestId: result.request_id,
            numVisuals: dto.number_of_visuals ?? 1,
        });
        await this.creditService.deduct(userId, cost, 'vizora_gen', RESOURCE_TYPES.VIZORA_GEN);
        return result;
    }

    @Get('status/:requestId')
    @ApiParam({ name: 'requestId', description: 'Request ID returned by /napkin/generate' })
    @ApiOperation({ summary: 'Poll the status of a visual generation request' })
    async status(@Param('requestId') requestId: string) {
        return this.napkinService.getVisualStatus(requestId);
    }

    @Get('download')
    @ApiQuery({ name: 'url', description: 'Napkin file URL to proxy-download (so the API key stays server-side)' })
    @ApiOperation({ summary: 'Proxy-download a generated file using the server API key' })
    async download(@Query('url') fileUrl: string, @Res() res: Response) {
        if (!fileUrl) throw new BadRequestException('url query param is required');

        const { data, contentType } = await this.napkinService.downloadFile(fileUrl);

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=600');
        res.send(data);
    }
}
