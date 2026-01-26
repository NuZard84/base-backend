import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
    private readonly logger = new Logger(GoogleAuthGuard.name);

    handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        const res = context.switchToHttp().getResponse();

        // 1. If it's the initial trigger (not callback), just pass through
        if (!req.url.includes('callback/google')) {
            if (err) throw err;
            return user || null;
        }

        // 2. We are in the callback phase.
        if (user && !err) {
            return user;
        }

        // 3. Handle actual failure during callback
        // ONLY redirect to frontend if we have a definitive error or message
        if (!res.headersSent && (err || info?.message)) {
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            const errorMessage = err?.message || info?.message || 'Authentication failed';

            this.logger.error(`Google Authentication Callback Failure: ${errorMessage}`);
            res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(errorMessage)}`);
        }

        // If we reach here with no user and no explicit redirect was sent, 
        // just throw the standard exception so Nest handles it normally (401).
        throw err || new UnauthorizedException(info?.message || 'Authentication failed');
    }
}
