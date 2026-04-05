export const STRIPE_API_VERSION = '2025-04-30.basil' as const;

export const STRIPE_EVENTS = {
  CHECKOUT_COMPLETED: 'checkout.session.completed',
  SUBSCRIPTION_CREATED: 'customer.subscription.created',
  SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
  INVOICE_PAID: 'invoice.paid',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  CHARGE_REFUNDED: 'charge.refunded',
  TRIAL_WILL_END: 'customer.subscription.trial_will_end',
} as const;

export type StripeEventType = (typeof STRIPE_EVENTS)[keyof typeof STRIPE_EVENTS];
