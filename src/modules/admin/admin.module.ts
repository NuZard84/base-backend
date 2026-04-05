import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { RedisModule } from 'src/redis/redis.module';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [RedisModule, StripeModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
