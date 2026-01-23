import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('Database disconnected successfully');
    } catch (error) {
      this.logger.error('Error disconnecting from database:', error);
    }
  }

  async handleDatabaseError(error: any, operation: string) {
    this.logger.error(`Database error during ${operation}:`, error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      switch (error.code) {
        case 'P2002':
          throw new Error('Unique constraint violation');
        case 'P2025':
          throw new Error('Record not found');
        case 'P2003':
          throw new Error('Foreign key constraint violation');
        default:
          throw new Error('Database operation failed');
      }
    }

    throw new Error('Database operation failed');
  }
}
