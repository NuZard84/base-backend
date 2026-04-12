import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    Logger,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsNumber, IsString, Min } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { PlanTier, PaymentStatus, SubscriptionStatus, WebhookEventStatus } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from 'prisma/prisma.service';
import { StripeService } from './stripe.service';
import { STRIPE_EVENTS } from './stripe.constants';
import { EmailService } from '../email/email.service';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export class CreateCheckoutDto {
    @IsNotEmpty() @IsString() tier: string;
    @IsNotEmpty() @IsString() successUrl: string;
    @IsNotEmpty() @IsString() cancelUrl: string;
    @IsOptional() @IsNumber() @Min(1) trialPeriodDays?: number;
}

export class CreatePortalDto {
    @IsNotEmpty() @IsString() returnUrl: string;
}

// ─── StripeController ─────────────────────────────────────────────────────────

@ApiTags('Stripe')
@Controller('stripe')
export class StripeController {
    private readonly logger = new Logger(StripeController.name);

    private readonly priceToTier: Map<string, PlanTier>;
    private readonly tierToPrice: Map<string, string>;

    constructor(
        private readonly stripeService: StripeService,
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
        private readonly email: EmailService,
    ) {
        const entries: [string, PlanTier][] = [
            [config.get<string>('STRIPE_PRICE_STARTER', ''), PlanTier.STARTER],
            [config.get<string>('STRIPE_PRICE_PRO', ''), PlanTier.PRO],
            [config.get<string>('STRIPE_PRICE_PLUS', ''), PlanTier.PLUS],
        ];
        this.priceToTier = new Map(entries.filter(([k]) => k));
        this.tierToPrice = new Map(entries.filter(([k]) => k).map(([k, v]) => [v, k]));

        this.logger.log(
            `Stripe price map: ${[...this.priceToTier.entries()].map(([k, v]) => `${k}→${v}`).join(', ') || '(none — set STRIPE_PRICE_PLUS / STRIPE_PRICE_PRO in env)'}`,
        );
    }

    // ─── Public config ────────────────────────────────────────────────────────

    @Get('config')
    @ApiOperation({ summary: 'Returns the Stripe publishable key for the frontend' })
    getConfig() {
        return { publishableKey: this.stripeService.getPublishableKey() };
    }

    // ─── Checkout ─────────────────────────────────────────────────────────────

    @Post('checkout')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('bearer')
    @ApiOperation({ summary: 'Create a Stripe Checkout session for a subscription upgrade' })
    async createCheckout(@Req() req, @Body() body: CreateCheckoutDto) {
        const { userId, email } = req.user;

        const priceId = this.tierToPrice.get(body.tier.toUpperCase());

        if (!priceId) {
            throw new BadRequestException(
                `No Stripe price configured for tier: ${body.tier}. Set STRIPE_PRICE_${body.tier.toUpperCase()} in env.`,
            );
        }

        const user = await this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { stripeId: true },
        });

        this.logger.log(`Creating checkout for user=${userId} email=${email} tier=${body.tier} priceId=${priceId}`);

        return this.stripeService.createCheckoutSession({
            userId,
            email,
            priceId,
            successUrl: body.successUrl,
            cancelUrl: body.cancelUrl,
            stripeCustomerId: user.stripeId ?? undefined,
            trialPeriodDays: body.trialPeriodDays,
            mode: 'subscription',
        });
    }

    // ─── Billing Portal ───────────────────────────────────────────────────────

    @Post('portal')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('bearer')
    async createPortal(@Req() req, @Body() body: CreatePortalDto) {
        const { userId } = req.user;
        const user = await this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { stripeId: true },
        });

        if (!user.stripeId) return { url: null, message: 'No active subscription found' };

        const url = await this.stripeService.createBillingPortalSession({
            stripeCustomerId: user.stripeId,
            returnUrl: body.returnUrl,
        });
        return { url };
    }

    // ─── Billing History (user-facing) ────────────────────────────────────────

    @Get('billing-history')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('bearer')
    async getBillingHistory(
        @Req() req,
        @Query('page') page = '1',
        @Query('pageSize') pageSize = '10',
    ) {
        const { userId } = req.user;
        const p = Math.max(1, parseInt(page, 10));
        const ps = Math.min(50, Math.max(1, parseInt(pageSize, 10)));

        const [payments, total, latestSucceeded] = await Promise.all([
            this.prisma.payment.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip: (p - 1) * ps,
                take: ps,
                select: {
                    id: true, plan: true, amountCents: true, currency: true,
                    status: true, invoiceUrl: true, invoicePdf: true,
                    periodStart: true, periodEnd: true, createdAt: true,
                },
            }),
            this.prisma.payment.count({ where: { userId } }),
            this.prisma.payment.findFirst({
                where: { userId, status: 'SUCCEEDED' },
                orderBy: { createdAt: 'desc' },
                select: { periodEnd: true },
            }),
        ]);

        const nextBillingAt = latestSucceeded?.periodEnd?.toISOString() ?? null;

        return { payments, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps), nextBillingAt };
    }

    // ─── Webhook ──────────────────────────────────────────────────────────────

    @Post('webhook')
    @HttpCode(200)
    @ApiOperation({ summary: 'Stripe webhook receiver — do not call directly' })
    async handleWebhook(
        @Req() req: Request & { rawBody?: Buffer },
        @Headers('stripe-signature') signature: string,
    ) {
        const rawBody = req.rawBody;

        // Guard: rawBody must be present (captured by main.ts middleware at /stripe/webhook)
        if (!rawBody) {
            this.logger.error(
                'Webhook received WITHOUT rawBody — this means the rawBody middleware is not matching ' +
                'the route. Check that main.ts registers the middleware at "/stripe/webhook" (no /api prefix).',
            );
            return { received: false, error: 'rawBody missing' };
        }

        if (!signature) {
            this.logger.warn('Webhook received without stripe-signature header — ignoring');
            return { received: false, error: 'missing signature' };
        }

        let event: any;
        try {
            event = this.stripeService.constructWebhookEvent(rawBody, signature);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Webhook signature verification FAILED: ${msg}`);
            // Persist failed verification attempt for audit
            await this.prisma.webhookLog.create({
                data: {
                    eventId: `sig-fail-${Date.now()}`,
                    eventType: 'signature_verification_failed',
                    status: WebhookEventStatus.FAILED,
                    error: msg,
                    payload: { rawLength: rawBody.length },
                },
            }).catch(() => {}); // don't throw if DB write fails
            return { received: false, error: 'invalid signature' };
        }

        this.logger.log(`Webhook received: ${event.type} [${event.id}]`);

        // Idempotency: skip if this event was already successfully processed.
        // The upsert update is a no-op so we never overwrite a PROCESSED status
        // (prevents a Stripe retry from re-running a handler that already succeeded).
        const existingLog = await this.prisma.webhookLog.findUnique({ where: { eventId: event.id } });
        if (existingLog?.status === WebhookEventStatus.PROCESSED) {
            this.logger.log(`Webhook ${event.id} already processed — skipping (idempotent)`);
            return { received: true, duplicate: true };
        }

        const log = await this.prisma.webhookLog.upsert({
            where: { eventId: event.id },
            create: {
                eventId: event.id,
                eventType: event.type,
                status: WebhookEventStatus.RECEIVED,
                payload: event as any,
            },
            update: {
                // Only re-open a FAILED event for retry — never overwrite PROCESSED
                status: existingLog?.status === WebhookEventStatus.FAILED
                    ? WebhookEventStatus.RECEIVED
                    : existingLog?.status ?? WebhookEventStatus.RECEIVED,
            },
        });

        let processingError: string | null = null;
        let resolvedUserId: string | null = null;

        try {
            switch (event.type) {
                case STRIPE_EVENTS.CHECKOUT_COMPLETED:
                    resolvedUserId = await this.onCheckoutCompleted(event.data.object);
                    break;
                case STRIPE_EVENTS.SUBSCRIPTION_CREATED:
                case STRIPE_EVENTS.SUBSCRIPTION_UPDATED:
                    resolvedUserId = await this.onSubscriptionUpserted(event.data.object);
                    break;
                case STRIPE_EVENTS.SUBSCRIPTION_DELETED:
                    resolvedUserId = await this.onSubscriptionDeleted(event.data.object);
                    break;
                case STRIPE_EVENTS.INVOICE_PAID:
                    resolvedUserId = await this.onInvoicePaid(event.data.object);
                    break;
                case STRIPE_EVENTS.INVOICE_PAYMENT_FAILED:
                    resolvedUserId = await this.onInvoicePaymentFailed(event.data.object);
                    break;
                case STRIPE_EVENTS.CHARGE_REFUNDED:
                    resolvedUserId = await this.onChargeRefunded(event.data.object);
                    break;
                case STRIPE_EVENTS.TRIAL_WILL_END:
                    this.logger.log(`Trial ending soon: sub=${(event.data.object as any).id}`);
                    break;
                default:
                    this.logger.debug(`Unhandled event type: ${event.type}`);
            }
        } catch (err: unknown) {
            processingError = err instanceof Error ? err.message : String(err);
            this.logger.error(`Error processing ${event.type} [${event.id}]: ${processingError}`);
        }

        // Update log with final status
        await this.prisma.webhookLog.update({
            where: { id: log.id },
            data: {
                status: processingError ? WebhookEventStatus.FAILED : WebhookEventStatus.PROCESSED,
                error: processingError,
                userId: resolvedUserId,
                processedAt: new Date(),
            },
        }).catch((e) => this.logger.warn(`Failed to update webhook log: ${e.message}`));

        return { received: true };
    }

    // ─── Event handlers ───────────────────────────────────────────────────────

    private async onCheckoutCompleted(session: any): Promise<string | null> {
        const userId = session.metadata?.userId;
        if (!userId) {
            this.logger.warn(`checkout.session.completed [${session.id}]: no userId in metadata`);
            return null;
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: { stripeId: session.customer },
        });

        this.logger.log(`checkout.completed: user=${userId} stripeCustomer=${session.customer}`);
        return userId;
    }

    private async onSubscriptionUpserted(subscription: any): Promise<string | null> {
        const userId = subscription.metadata?.userId;
        if (!userId) {
            this.logger.warn(
                `subscription.upserted [${subscription.id}]: no userId in metadata. ` +
                `status=${subscription.status} — ensure subscription_data.metadata.userId is set in checkout.`,
            );
            return null;
        }

        const priceId = subscription.items?.data?.[0]?.price?.id;
        const planTier = priceId ? (this.priceToTier.get(priceId) ?? PlanTier.FREE) : PlanTier.FREE;
        const status = this.mapStatus(subscription.status);

        // When activating a paid plan, clear any active trial so it doesn't
        // shadow the real plan in effective-tier resolution.
        const isPaid = planTier === PlanTier.PLUS || planTier === PlanTier.PRO;

        await this.prisma.user.update({
            where: { id: userId },
            data: {
                plan: planTier,
                status,
                subscriptionId: subscription.id,
                ...(isPaid && { trialEndsAt: null, trialTier: null }),
            },
        });

        this.logger.log(
            `subscription.upserted: user=${userId} plan=${planTier} status=${status} ` +
            `sub=${subscription.id} priceId=${priceId ?? 'none'}`,
        );
        return userId;
    }

    private async onSubscriptionDeleted(subscription: any): Promise<string | null> {
        const userId = subscription.metadata?.userId;
        if (!userId) {
            this.logger.warn(`subscription.deleted [${subscription.id}]: no userId in metadata`);
            return null;
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: {
                plan: PlanTier.FREE,
                status: SubscriptionStatus.CANCELED,
                subscriptionId: null,
                trialEndsAt: null,
                trialTier: null,
            },
        });

        this.logger.log(`subscription.deleted: user=${userId} → downgraded to FREE, trial cleared`);
        return userId;
    }

    private async onInvoicePaid(invoice: any): Promise<string | null> {
        // Resolve user: try subscriptionId first (most reliable), then stripeId (customer)
        const user = await this.resolveUserFromInvoice(invoice);

        if (!user) {
            this.logger.warn(
                `invoice.paid [${invoice.id}]: cannot resolve user. ` +
                `subscription=${invoice.subscription} customer=${invoice.customer}`,
            );
            return null;
        }

        const lineItem = invoice.lines?.data?.[0];
        const priceId = lineItem?.price?.id;
        const plan = priceId ? (this.priceToTier.get(priceId) ?? user.plan) : user.plan;
        const periodStart = lineItem?.period?.start ? new Date(lineItem.period.start * 1000) : undefined;
        const periodEnd = lineItem?.period?.end ? new Date(lineItem.period.end * 1000) : undefined;

        await this.prisma.payment.upsert({
            where: { stripeInvoiceId: invoice.id },
            create: {
                userId: user.id,
                stripeInvoiceId: invoice.id,
                plan,
                amountCents: invoice.amount_paid,
                currency: invoice.currency ?? 'usd',
                status: PaymentStatus.SUCCEEDED,
                periodStart,
                periodEnd,
                invoiceUrl: invoice.hosted_invoice_url ?? null,
                invoicePdf: invoice.invoice_pdf ?? null,
            },
            update: {
                status: PaymentStatus.SUCCEEDED,
                amountCents: invoice.amount_paid,
                invoiceUrl: invoice.hosted_invoice_url ?? null,
                invoicePdf: invoice.invoice_pdf ?? null,
            },
        });

        // Always sync plan + status on a paid invoice — makes this handler resilient
        // to subscription event ordering (invoice.paid may arrive before subscription.created).
        const isPaidPlan = plan === PlanTier.PLUS || plan === PlanTier.PRO;
        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                plan: plan as PlanTier,
                status: SubscriptionStatus.ACTIVE,
                // Stamp subscriptionId if we know it (from the invoice)
                ...(invoice.subscription && { subscriptionId: invoice.subscription }),
                // Clear stale trial fields when upgrading to a paid plan
                ...(isPaidPlan && { trialEndsAt: null, trialTier: null }),
            },
        });

        this.logger.log(
            `invoice.paid: user=${user.id} plan=${plan} amount=${invoice.amount_paid} ` +
            `invoice=${invoice.id} trialCleared=${isPaidPlan}`,
        );

        // Send subscription confirmation email (fire-and-forget)
        if (isPaidPlan) {
            const fullUser = await this.prisma.user.findUnique({
                where: { id: user.id },
                select: { email: true, name: true },
            });
            if (fullUser?.email) {
                const amountDollars = invoice.amount_paid
                    ? `$${(invoice.amount_paid / 100).toFixed(2)}`
                    : '';
                const nextBilling = periodEnd
                    ? periodEnd.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                    : '';
                const frontendUrl = this.config.get<string>('FRONTEND_URL', 'https://trydraft.app');

                void this.email.sendSubscriptionConfirmation({
                    toEmail: fullUser.email,
                    userName: fullUser.name ?? 'there',
                    planName: plan === PlanTier.PRO ? 'Pro' : 'Plus',
                    amount: amountDollars,
                    billingDate: nextBilling,
                    manageUrl: frontendUrl,
                });
            }
        }

        return user.id;
    }

    private async onInvoicePaymentFailed(invoice: any): Promise<string | null> {
        const user = await this.resolveUserFromInvoice(invoice);

        if (!user) {
            this.logger.warn(
                `invoice.payment_failed [${invoice.id}]: cannot resolve user. ` +
                `subscription=${invoice.subscription} customer=${invoice.customer}`,
            );
            return null;
        }

        const lineItem = invoice.lines?.data?.[0];
        const priceId = lineItem?.price?.id;
        const plan = priceId ? (this.priceToTier.get(priceId) ?? user.plan) : user.plan;
        const periodStart = lineItem?.period?.start ? new Date(lineItem.period.start * 1000) : undefined;
        const periodEnd = lineItem?.period?.end ? new Date(lineItem.period.end * 1000) : undefined;

        await this.prisma.payment.upsert({
            where: { stripeInvoiceId: invoice.id },
            create: {
                userId: user.id,
                stripeInvoiceId: invoice.id,
                plan,
                amountCents: invoice.amount_due,
                currency: invoice.currency ?? 'usd',
                status: PaymentStatus.FAILED,
                periodStart,
                periodEnd,
            },
            update: { status: PaymentStatus.FAILED },
        });

        await this.prisma.user.update({
            where: { id: user.id },
            data: { status: SubscriptionStatus.PAUSED },
        });

        this.logger.warn(`invoice.payment_failed: user=${user.id} → PAUSED`);
        return user.id;
    }

    private async onChargeRefunded(charge: any): Promise<string | null> {
        if (charge.invoice) {
            const updated = await this.prisma.payment.updateMany({
                where: { stripeInvoiceId: charge.invoice },
                data: { status: PaymentStatus.REFUNDED, stripeChargeId: charge.id },
            });
            if (updated.count > 0) {
                this.logger.log(`charge.refunded: invoice=${charge.invoice} marked REFUNDED`);
                return null; // userId unknown at this point, OK
            }
        }

        // Fallback: find by customer
        if (charge.customer) {
            const user = await this.prisma.user.findFirst({
                where: { stripeId: charge.customer },
                select: { id: true, plan: true },
            });
            if (user) {
                await this.prisma.payment.create({
                    data: {
                        userId: user.id,
                        stripeChargeId: charge.id,
                        plan: user.plan,
                        amountCents: -charge.amount_refunded,
                        currency: charge.currency ?? 'usd',
                        status: PaymentStatus.REFUNDED,
                    },
                });
                this.logger.log(`charge.refunded: refund record created for user=${user.id}`);
                return user.id;
            }
        }

        this.logger.warn(`charge.refunded [${charge.id}]: cannot resolve user`);
        return null;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Resolve a user from an invoice object.
     * Tries subscriptionId first, then stripeId (customer), both in one query.
     */
    private async resolveUserFromInvoice(
        invoice: { subscription?: string; customer?: string },
    ): Promise<{ id: string; plan: PlanTier; status: SubscriptionStatus } | null> {
        const conditions: any[] = [];
        if (invoice.subscription) conditions.push({ subscriptionId: invoice.subscription });
        if (invoice.customer)     conditions.push({ stripeId: invoice.customer });
        if (conditions.length === 0) return null;

        return this.prisma.user.findFirst({
            where: { OR: conditions },
            select: { id: true, plan: true, status: true },
        });
    }

    private mapStatus(stripeStatus: string): SubscriptionStatus {
        switch (stripeStatus) {
            case 'active':    return SubscriptionStatus.ACTIVE;
            case 'trialing':  return SubscriptionStatus.TRIALING;
            case 'past_due':
            case 'paused':
            case 'incomplete': return SubscriptionStatus.PAUSED;
            case 'canceled':
            case 'incomplete_expired':
            case 'unpaid':    return SubscriptionStatus.CANCELED;
            default:          return SubscriptionStatus.ACTIVE;
        }
    }
}
