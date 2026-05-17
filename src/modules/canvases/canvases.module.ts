import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CanvasesService } from './canvases.service';
import { CanvasesController } from './canvases.controller';
import { CanvasSharesService } from './canvas-shares/canvas-shares.service';
import { CanvasSharesController } from './canvas-shares/canvas-shares.controller';
import { CanvasesGateway } from './canvases.gateway';
import { CanvasCollabService } from './canvas-collab.service';
import { CommentsService } from './comments/comments.service';
import { CommentsController } from './comments/comments.controller';
import { RedisModule } from '../../redis/redis.module';
import { EmailModule } from '../email/email.module';

@Module({
    imports: [JwtModule.register({}), RedisModule, EmailModule],
    controllers: [CanvasesController, CanvasSharesController, CommentsController],
    providers: [
        CanvasesService,
        CanvasSharesService,
        CanvasesGateway,
        CanvasCollabService,
        CommentsService,
    ],
    exports: [CanvasSharesService],
})
export class CanvasesModule {}
