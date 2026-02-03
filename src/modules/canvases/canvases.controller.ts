import { Controller, Post, Body, UseGuards, Req, Get, Param, Patch, Delete } from '@nestjs/common';
import { CreateCanvasDto } from './dto/create-canvas.dto';
import { RenameCanvasDto } from './dto/rename-canvas.dto';
import { CanvasesService } from './canvases.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';

@ApiTags('Canvases')
@ApiBearerAuth()
@Controller('canvases')
export class CanvasesController {
    constructor(private readonly canvasesService: CanvasesService) { }

    @Post()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Create a new canvas' })
    @ApiResponse({ status: 201, description: 'The canvas has been successfully created.' })
    create(@Req() req, @Body() createDto: CreateCanvasDto) {
        return this.canvasesService.create(req.user.userId, createDto);
    }

    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get all canvases for the current user' })
    @ApiResponse({ status: 200, description: 'Return all canvases.' })
    findAll(@Req() req) {
        return this.canvasesService.findAll(req.user.userId);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get a specific canvas by ID' })
    @ApiResponse({ status: 200, description: 'Return the canvas.' })
    @ApiResponse({ status: 404, description: 'Canvas not found.' })
    findOne(@Req() req, @Param('id') id: string) {
        return this.canvasesService.findOne(req.user.userId, id);
    }

    @Patch(':id/rename')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Rename a specific canvas' })
    @ApiResponse({ status: 200, description: 'The canvas has been successfully renamed.' })
    @ApiResponse({ status: 404, description: 'Canvas not found.' })
    rename(@Req() req, @Param('id') id: string, @Body() renameDto: RenameCanvasDto) {
        return this.canvasesService.rename(req.user.userId, id, renameDto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Delete a specific canvas' })
    @ApiResponse({ status: 200, description: 'The canvas has been successfully deleted.' })
    @ApiResponse({ status: 404, description: 'Canvas not found.' })
    remove(@Req() req, @Param('id') id: string) {
        return this.canvasesService.remove(req.user.userId, id);
    }
}
