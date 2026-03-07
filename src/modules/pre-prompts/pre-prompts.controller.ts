import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CreatePrePromptDto } from './dto/create-pre-prompt.dto';
import { PrePromptsService } from './pre-prompts.service';

@ApiTags('Pre-Prompts')
@ApiBearerAuth()
@Controller('api/pre-prompts')
export class PrePromptsController {
  constructor(private readonly prePromptsService: PrePromptsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a new pre-prompt template' })
  @ApiResponse({ status: 201, description: 'The template has been successfully created.' })
  create(@Req() req: { user: { userId: string } }, @Body() dto: CreatePrePromptDto) {
    return this.prePromptsService.create(req.user.userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Fetch all pre-prompt templates' })
  @ApiResponse({ status: 200, description: 'Return all templates.' })
  findAll(@Req() req: { user: { userId: string } }) {
    return this.prePromptsService.findAll(req.user.userId);
  }
}
