import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { AuthModule } from 'src/auth/auth.module';
import { RedisModule } from 'src/redis/redis.module';
import { CreditModule } from 'src/common/credits/credit.module';

@Module({
  imports: [AuthModule, RedisModule, CreditModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule { }

