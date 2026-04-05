import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Blocks all /admin API calls whose Origin does not come from an
 * authorised admin frontend host.
 *
 * Production origins are loaded exclusively from ADMIN_ALLOWED_ORIGINS env
 * (comma-separated). No production domains are hardcoded in code.
 *
 * Dev default: http://admin.localhost (any port) is always allowed when NODE_ENV !== production.
 *
 * Example:
 *   ADMIN_ALLOWED_ORIGINS=https://backoffice.trydraft.app
 */
@Injectable()
export class AdminOriginGuard implements CanActivate {
    private readonly logger = new Logger(AdminOriginGuard.name);
    private readonly allowedOrigins: Set<string>;
    private readonly isDev: boolean;

    constructor(private readonly config: ConfigService) {
        this.isDev = config.get<string>('NODE_ENV', 'development') !== 'production';

        const envOrigins = config.get<string>('ADMIN_ALLOWED_ORIGINS', '');
        const configured = envOrigins
            ? envOrigins.split(',').map(o => o.trim()).filter(Boolean)
            : [];

        this.allowedOrigins = new Set(configured);

        if (!this.isDev && configured.length === 0) {
            this.logger.error(
                'ADMIN_ALLOWED_ORIGINS is not set in production! All admin API calls will be blocked.',
            );
        }
    }

    canActivate(context: ExecutionContext): boolean {
        const req = context.switchToHttp().getRequest<Request>();
        const origin = req.headers['origin'] ?? '';
        const referer = req.headers['referer'] ?? '';

        // Allow exact match on Origin header
        if (this.isAllowed(origin)) return true;

        // Fallback: check Referer host (some clients send referer instead of origin)
        if (referer) {
            try {
                const refererOrigin = new URL(referer).origin;
                if (this.isAllowed(refererOrigin)) return true;
            } catch {
                // malformed referer — deny
            }
        }

        this.logger.warn(
            `Admin API blocked — unauthorized origin: "${origin}" referer: "${referer}" ip: ${req.ip}`,
        );

        throw new ForbiddenException(
            'Admin access is not permitted from this origin.',
        );
    }

    private isAllowed(origin: string): boolean {
        if (!origin) return false;
        if (this.allowedOrigins.has(origin)) return true;

        // In dev only: allow http://admin.localhost with any port
        if (this.isDev) {
            try {
                const url = new URL(origin);
                if (
                    url.protocol === 'http:' &&
                    /^admin\.localhost$/.test(url.hostname)
                ) {
                    return true;
                }
            } catch {
                // not a valid URL — deny
            }
        }

        return false;
    }
}
