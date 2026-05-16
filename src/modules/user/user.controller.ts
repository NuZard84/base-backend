import { Body, Controller, Get, Post, Req, UseGuards, Delete } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { PlanService } from '../../common/plans/plan.service';
import { CreditService } from '../../common/credits/credit.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('User')
@ApiBearerAuth()
@Controller('user')
export class UserController {
  constructor(
    private userService: UserService,
    private planService: PlanService,
    private creditService: CreditService,
  ) { }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Return the current user profile' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  getProfile(@Req() req) {
    return {
      message: 'This is a protected route!',
      user: req.user,
    };
  }

  @Post('/update-profile')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update user profile' })
  @ApiResponse({ status: 200, description: 'User profile updated successfully' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  updateProfile(@Body() body: UpdateUserDto, @Req() req) {
    return this.userService.updateProfile(req.user.userId, body);
  }

  @Delete('delete')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Delete current user account' })
  @ApiResponse({ status: 200, description: 'User account deleted successfully' })
  deleteAccount(@Req() req) {
    return this.userService.deleteAccount(req.user.userId);
  }

  // ─── Plan Endpoints ─────────────────────────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: 'Get all visible plan definitions (public)' })
  @ApiResponse({ status: 200, description: 'Returns all visible plan tiers with limits and features' })
  getPlans() {
    return this.planService.getVisiblePlans();
  }

  @Get('me/plan')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user plan details with usage' })
  @ApiResponse({ status: 200, description: 'Returns effective plan, trial info, and usage summary' })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  getMyPlan(@Req() req) {
    return this.planService.getUserPlanDetails(req.user.userId);
  }

  @Get('me/usage')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user usage summary' })
  @ApiResponse({ status: 200, description: 'Returns usage counts for all tracked resources' })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  getMyUsage(@Req() req) {
    return this.planService.getUsageSummary(req.user.userId);
  }

  // ─── Credit Endpoints ────────────────────────────────────────────────────────

  @Get('me/credits')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current credit balance' })
  @ApiResponse({ status: 200, description: 'Returns current credit balance' })
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async getMyCredits(@Req() req) {
    await this.creditService.grantMonthlyCredits(req.user.userId);
    const balance = await this.creditService.getBalance(req.user.userId);
    return { balance };
  }

  @Get('me/credits/history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get credit transaction history (last 50)' })
  @ApiResponse({ status: 200, description: 'Returns recent credit transactions' })
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  getMyCreditsHistory(@Req() req) {
    return this.creditService.getHistory(req.user.userId, 50);
  }
}

