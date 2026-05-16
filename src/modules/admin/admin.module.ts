import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { AdminOriginGuard } from './admin-origin.guard';
import { RedisModule } from 'src/redis/redis.module';
import { StripeModule } from '../stripe/stripe.module';
import { BugReportsModule } from '../bug-reports/bug-reports.module';
import { CreditModule } from 'src/common/credits/credit.module';

@Module({
  imports: [RedisModule, StripeModule, BugReportsModule, CreditModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard, AdminOriginGuard],
})
export class AdminModule {}
