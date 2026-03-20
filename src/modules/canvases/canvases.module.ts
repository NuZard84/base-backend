import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CanvasesService } from './canvases.service';
import { CanvasesController } from './canvases.controller';
import { CanvasSharesService } from './canvas-shares/canvas-shares.service';
import { CanvasSharesController } from './canvas-shares/canvas-shares.controller';
import { CanvasesGateway } from './canvases.gateway';

@Module({
    imports: [JwtModule.register({})],
    controllers: [CanvasesController, CanvasSharesController],
    providers: [CanvasesService, CanvasSharesService, CanvasesGateway],
    exports: [CanvasSharesService],
})
export class CanvasesModule { }
