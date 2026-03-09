import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CreatePrePromptDto } from './dto/create-pre-prompt.dto';
import { UpdatePrePromptDto } from './dto/update-pre-prompt.dto';
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

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Edit a pre-prompt template' })
  @ApiResponse({ status: 200, description: 'The template has been successfully updated.' })
  @ApiResponse({ status: 403, description: 'Forbidden: system templates cannot be edited or not owned by user.' })
  @ApiResponse({ status: 404, description: 'Template not found.' })
  update(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: UpdatePrePromptDto,
  ) {
    return this.prePromptsService.update(req.user.userId, id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete a pre-prompt template' })
  @ApiResponse({ status: 200, description: 'The template has been successfully deleted.' })
  @ApiResponse({ status: 403, description: 'Forbidden: system templates cannot be deleted or not owned by user.' })
  @ApiResponse({ status: 404, description: 'Template not found.' })
  remove(@Req() req: { user: { userId: string } }, @Param('id') id: string) {
    return this.prePromptsService.remove(req.user.userId, id);
  }
}
