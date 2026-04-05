import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import StripeLib from 'stripe';
import { STRIPE_API_VERSION } from './stripe.constants';

// Stripe's CJS export is typed as a plain function, not a class constructor.
// This cast lets us call `new` on it while preserving full instance type inference.
const StripeClass = StripeLib as unknown as new (
    secretKey: string,
    config: Parameters<typeof StripeLib>[1],
) => ReturnType<typeof StripeLib>;

// ─── Input / Output types ────────────────────────────────────────────────────

export type ProrationBehavior = 'create_prorations' | 'none' | 'always_invoice';

export interface CreateCheckoutSessionInput {
    userId: string;
    email: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    /** Pre-existing Stripe customer ID, if available */
    stripeCustomerId?: string;
    /** Pass a trial period in days to start a free trial */
    trialPeriodDays?: number;
    /** Arbitrary metadata stored on the session (e.g. planTier) */
    metadata?: Record<string, string>;
}

export interface CreateCheckoutSessionResult {
    sessionId: string;
    url: string;
}

export interface CreateBillingPortalSessionInput {
    stripeCustomerId: string;
    returnUrl: string;
}

export interface UpdateSubscriptionInput {
    subscriptionId: string;
    newPriceId: string;
    /** Defaults to create_prorations — prorate and charge/credit immediately */
    prorationBehavior?: ProrationBehavior;
}

export interface CancelSubscriptionInput {
    subscriptionId: string;
    /** true (default) = cancel at period end; false = cancel immediately */
    atPeriodEnd?: boolean;
}

// ─── StripeService ───────────────────────────────────────────────────────────

@Injectable()
export class StripeService implements OnModuleInit {
    private readonly logger = new Logger(StripeService.name);
    private readonly stripe: ReturnType<typeof StripeLib>;
    private readonly webhookSecret: string;

    constructor(private readonly config: ConfigService) {
        const secretKey = this.config.getOrThrow<string>('STRIPE_SECRET_KEY');
        const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');

        if (!webhookSecret) {
            this.logger.warn(
                'STRIPE_WEBHOOK_SECRET is not set — webhook signature verification will fail',
            );
        }

        this.webhookSecret = webhookSecret ?? '';

        this.stripe = new StripeClass(secretKey, {
            apiVersion: STRIPE_API_VERSION,
            typescript: true,
            maxNetworkRetries: 3,
            telemetry: false,
        });
    }

    onModuleInit() {
        this.logger.log('StripeService initialized');
    }

    // ─── Customer ──────────────────────────────────────────────────────────────

    /**
     * Creates a new Stripe customer.
     * Store the returned `id` in your DB as `user.stripeId`.
     */
    async createCustomer(userId: string, email: string, name?: string) {
        return this.stripe.customers.create(
            { email, name, metadata: { userId } },
            { idempotencyKey: `customer-create-${userId}` },
        );
    }

    /**
     * Fetches a Stripe customer by ID. Returns null if deleted.
     */
    async getCustomer(stripeCustomerId: string) {
        const customer = await this.stripe.customers.retrieve(stripeCustomerId);
        if (customer.deleted) return null;
        return customer;
    }

    /**
     * Idempotent: returns existing customer if ID is provided, otherwise creates one.
     */
    async getOrCreateCustomer(
        userId: string,
        email: string,
        name?: string,
        stripeCustomerId?: string,
    ) {
        if (stripeCustomerId) {
            const existing = await this.getCustomer(stripeCustomerId);
            if (existing) return existing;
        }
        return this.createCustomer(userId, email, name);
    }

    // ─── Checkout ──────────────────────────────────────────────────────────────

    /**
     * Creates a Stripe Checkout Session for a subscription.
     * Redirect the user to the returned `url`.
     */
    async createCheckoutSession(
        input: CreateCheckoutSessionInput,
    ): Promise<CreateCheckoutSessionResult> {
        const {
            userId,
            email,
            priceId,
            successUrl,
            cancelUrl,
            stripeCustomerId,
            trialPeriodDays,
            metadata = {},
        } = input;

        if (!priceId) {
            throw new BadRequestException('priceId is required to create a checkout session');
        }

        const customer = await this.getOrCreateCustomer(
            userId,
            email,
            undefined,
            stripeCustomerId,
        );

        const session = await this.stripe.checkout.sessions.create(
            {
                mode: 'subscription',
                customer: customer.id,
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: successUrl,
                cancel_url: cancelUrl,
                subscription_data: {
                    metadata: { userId, ...metadata },
                    ...(trialPeriodDays ? { trial_period_days: trialPeriodDays } : {}),
                },
                metadata: { userId, ...metadata },
                allow_promotion_codes: true,
                billing_address_collection: 'auto',
            },
            { idempotencyKey: `checkout-${userId}-${priceId}-${Date.now()}` },
        );

        if (!session.url) {
            throw new InternalServerErrorException('Stripe did not return a checkout URL');
        }

        return { sessionId: session.id, url: session.url };
    }

    // ─── Billing Portal ────────────────────────────────────────────────────────

    /**
     * Creates a Customer Portal session so users can manage billing themselves.
     * Returns the portal URL to redirect to.
     */
    async createBillingPortalSession(input: CreateBillingPortalSessionInput): Promise<string> {
        const { stripeCustomerId, returnUrl } = input;
        const session = await this.stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: returnUrl,
        });
        return session.url;
    }

    // ─── Subscription ──────────────────────────────────────────────────────────

    /**
     * Retrieves a subscription by ID with price product and latest invoice expanded.
     */
    async getSubscription(subscriptionId: string) {
        return this.stripe.subscriptions.retrieve(subscriptionId, {
            expand: ['items.data.price.product', 'latest_invoice'],
        });
    }

    /**
     * Upgrades or downgrades a subscription to a new price.
     * Defaults to prorating and charging immediately.
     */
    async updateSubscription(input: UpdateSubscriptionInput) {
        const {
            subscriptionId,
            newPriceId,
            prorationBehavior = 'create_prorations',
        } = input;

        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
        const currentItemId = subscription.items.data[0]?.id;

        if (!currentItemId) {
            throw new BadRequestException(
                `Subscription ${subscriptionId} has no items to update`,
            );
        }

        return this.stripe.subscriptions.update(
            subscriptionId,
            {
                items: [{ id: currentItemId, price: newPriceId }],
                proration_behavior: prorationBehavior,
            },
            { idempotencyKey: `sub-update-${subscriptionId}-${newPriceId}` },
        );
    }

    /**
     * Cancels a subscription. Defaults to cancel at period end (safe default).
     * Pass `atPeriodEnd: false` to cancel immediately.
     */
    async cancelSubscription(input: CancelSubscriptionInput) {
        const { subscriptionId, atPeriodEnd = true } = input;

        if (atPeriodEnd) {
            return this.stripe.subscriptions.update(subscriptionId, {
                cancel_at_period_end: true,
            });
        }

        return this.stripe.subscriptions.cancel(subscriptionId);
    }

    /**
     * Resumes a subscription that was set to cancel at period end.
     */
    async resumeSubscription(subscriptionId: string) {
        return this.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: false,
        });
    }

    // ─── Webhooks ──────────────────────────────────────────────────────────────

    /**
     * Verifies the Stripe webhook signature and returns the parsed event.
     * Call this in your webhook controller BEFORE processing any data.
     *
     * IMPORTANT: rawBody must be the raw Buffer — do NOT JSON.parse it first.
     * In NestJS, use @RawBody() or set `rawBody: true` in bootstrap.
     */
    constructWebhookEvent(rawBody: Buffer, signature: string) {
        if (!this.webhookSecret) {
            throw new InternalServerErrorException(
                'STRIPE_WEBHOOK_SECRET is not configured',
            );
        }

        try {
            return this.stripe.webhooks.constructEvent(
                rawBody,
                signature,
                this.webhookSecret,
            );
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Invalid signature';
            this.logger.warn(`Webhook signature verification failed: ${message}`);
            throw new BadRequestException(
                `Webhook signature verification failed: ${message}`,
            );
        }
    }

    // ─── Prices ────────────────────────────────────────────────────────────────

    /**
     * Retrieves a price with its product expanded (useful for displaying pricing info).
     */
    async getPrice(priceId: string) {
        return this.stripe.prices.retrieve(priceId, { expand: ['product'] });
    }

    // ─── Invoices ──────────────────────────────────────────────────────────────

    /**
     * Lists the last N invoices for a customer.
     */
    async listInvoices(stripeCustomerId: string, limit = 10) {
        const result = await this.stripe.invoices.list({
            customer: stripeCustomerId,
            limit,
            expand: ['data.subscription'],
        });
        return result.data;
    }

    // ─── Customer subscriptions ────────────────────────────────────────────────

    /**
     * Lists all active/trialing subscriptions for a Stripe customer.
     * Used by the admin sync endpoint to repair plan state without webhooks.
     */
    async listActiveSubscriptions(stripeCustomerId: string) {
        const result = await this.stripe.subscriptions.list({
            customer: stripeCustomerId,
            status: 'all',
            limit: 5,
            expand: ['data.items.data.price'],
        });
        return result.data;
    }

    /**
     * Lists paid invoices for a customer (used for billing history backfill).
     */
    async listPaidInvoices(stripeCustomerId: string, limit = 20) {
        const result = await this.stripe.invoices.list({
            customer: stripeCustomerId,
            status: 'paid',
            limit,
        });
        return result.data;
    }

    // ─── Publishable Key (safe for frontend) ───────────────────────────────────

    getPublishableKey(): string {
        return this.config.getOrThrow<string>('STRIPE_PUBLISHABLE_KEY');
    }
}
