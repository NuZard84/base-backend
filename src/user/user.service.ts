import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) { }

  async updateName(userId: string, name: string) {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { name },
      });

      return user;
    } catch (error) {
      this.logger.error('Error updating name:', error);
      await this.prisma.handleDatabaseError(error, 'updateName');
      throw error;
    }
  }
}

