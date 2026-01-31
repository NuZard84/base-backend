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

  async updateProfile(userId: string, data: { name?: string; image?: string }) {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data,
      });

      return user;
    } catch (error) {
      this.logger.error('Error updating profile:', error);
      throw error;
    }
  }

  async deleteAccount(userId: string) {
    try {
      await this.prisma.user.delete({
        where: { id: userId },
      });
      // Optionally clear session from redis if you are storing it there
      // await this.redis.del(`user:${userId}`); 

      this.logger.log(`User deleted: ${userId}`);
      return { message: 'User deleted successfully' };
    } catch (error) {
      this.logger.error('Error deleting user:', error);
      throw error;
    }
  }
}

