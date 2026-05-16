import { Global, Module } from '@nestjs/common';
import { PlanService } from './plan.service';
import { PlanGuard } from './plan.guard';

@Global()
@Module({
  providers: [PlanService, PlanGuard],
  exports: [PlanService, PlanGuard],
})
export class PlanModule {}
