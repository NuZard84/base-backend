import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  UseGuards,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { PlanGuard } from '../../../common/plans/plan.guard';
import { CheckLimit } from '../../../common/plans/plan.decorator';
import { QueryService } from './query.service';
import { RagQueryDto, VectorSearchDto } from './dto/rag-query.dto';

@ApiTags('RAG')
@ApiBearerAuth()
@Controller('rag')
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @Post('query')
  @UseGuards(JwtAuthGuard, PlanGuard)
  @CheckLimit('ai_requests')
  @ApiOperation({
    summary: 'Query documents using retrieval-augmented generation',
    description:
      'Embeds the query, retrieves the top-K most relevant chunks via pgvector, ' +
      'assembles context, and generates a grounded answer with source citations.',
  })
  @ApiResponse({ status: 201, description: 'RAG response with sources and timing.' })
  @ApiResponse({ status: 400, description: 'No documents found or API not configured.' })
  query(@Req() req, @Body() dto: RagQueryDto) {
    return this.queryService.query(req.user.userId, dto);
  }

  @Post('query/stream')
  @UseGuards(JwtAuthGuard, PlanGuard)
  @CheckLimit('ai_requests')
  @Sse()
  @ApiOperation({
    summary: 'Stream a RAG response via Server-Sent Events',
    description:
      'Same as POST /rag/query but streams tokens as they are generated. ' +
      'Sources are emitted first, then tokens, then a final "done" event.',
  })
  streamQuery(@Req() req, @Body() dto: RagQueryDto): Observable<MessageEvent> {
    return this.queryService.streamQuery(req.user.userId, dto);
  }

  @Get('search')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Vector similarity search (no LLM generation)',
    description: 'Returns the top-K most similar chunks for the query. No AI generation.',
  })
  @ApiResponse({ status: 200, description: 'Ranked list of matching chunks.' })
  search(@Req() req, @Query() dto: VectorSearchDto) {
    return this.queryService.search(req.user.userId, dto);
  }
}
