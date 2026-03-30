import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AuthService } from './auth.service';

@Processor('cleanup')
export class CleanupProcessor extends WorkerHost {
  constructor(private authService: AuthService) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'cleanup-revoked-sessions') {
      return await this.authService.cleanupRevokedSessions();
    }
  }
}
