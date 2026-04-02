import { Injectable, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

function getAllowedOrigins(): string[] {
    return (process.env.FRONTEND_URL || '')
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);
}

function resolveFrontendUrl(stateOrigin: string | undefined): string {
    const allowed = getAllowedOrigins();
    return stateOrigin && allowed.includes(stateOrigin)
        ? stateOrigin
        : allowed[0] || 'http://localhost:3000';
}

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
    private readonly logger = new Logger(GoogleAuthGuard.name);

    getAuthenticateOptions(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest();
        // On the initial login request, encode the requesting origin as OAuth state
        // so we can redirect back to the correct frontend after auth
        if (!req.url.includes('callback/google')) {
            const origin = req.query.origin as string | undefined;
            const allowed = getAllowedOrigins();
            if (origin && allowed.includes(origin)) {
                return { state: origin };
            }
        }
        return {};
    }

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
            const frontendUrl = resolveFrontendUrl(req.query.state as string | undefined);
            const errorMessage = err?.message || info?.message || 'Authentication failed';

            this.logger.error(`Google Authentication Callback Failure: ${errorMessage}`);
            res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(errorMessage)}`);
        }

        // If we reach here with no user and no explicit redirect was sent,
        // just throw the standard exception so Nest handles it normally (401).
        throw err || new UnauthorizedException(info?.message || 'Authentication failed');
    }
}
