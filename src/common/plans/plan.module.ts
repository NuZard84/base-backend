import { Global, Module } from '@nestjs/common';
import { PlanService } from './plan.service';

@Global()
@Module({
  providers: [PlanService],
  exports: [PlanService],
})
export class PlanModule {}
