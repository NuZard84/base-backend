import { Module } from '@nestjs/common';
import { BugReportsController } from './bug-reports.controller';
import { BugReportsService } from './bug-reports.service';
import { AttachmentsModule } from '../attachments/attachments.module';

@Module({
    imports: [AttachmentsModule],
    controllers: [BugReportsController],
    providers: [BugReportsService],
    exports: [BugReportsService],
})
export class BugReportsModule {}
