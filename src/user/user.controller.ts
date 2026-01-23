import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service';
import { UpdateNameDto } from 'src/auth/dto/update-name.dto';

@Controller('user')
export class UserController {
  constructor(private userService: UserService) { }

  @Get('me')
  @UseGuards(JwtAuthGuard) // protect this route
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  getProfile(@Req() req) {
    // req.user comes from JwtStrategy.validate
    return {
      message: 'This is a protected route!',
      user: req.user,
    };
  }

  @Post('/update-name')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  updateName(@Body() body: UpdateNameDto, @Req() req) {
    return this.userService.updateName(req.user.userId, body.name);
  }
}

