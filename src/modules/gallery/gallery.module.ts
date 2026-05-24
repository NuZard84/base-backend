import { Module } from '@nestjs/common';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { S3Service } from '../attachments/s3.service';

@Module({
    imports: [PrismaModule],
    controllers: [GalleryController],
    providers: [GalleryService, S3Service],
})
export class GalleryModule {}
