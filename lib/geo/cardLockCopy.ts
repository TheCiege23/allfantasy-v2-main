/**
 * What a card-locked account is told (lib/geo/accountGeoLock → `card_paid_block`).
 * One definition, because the middleware, the checkout routes, the post-purchase
 * sync and /paid-restricted all say it, and a buyer who has just been refunded
 * should not read four different accounts of why.
 *
 * Kept free of imports so the edge middleware can use it.
 */
export const CARD_PAID_LOCK_MESSAGE =
  "Paid features aren't available on this account: a purchase on it used a billing address in a state where paid fantasy features aren't allowed, and that payment was refunded in full. Free features still work. If your billing address was wrong, email support@allfantasy.ai."

export const CARD_PAID_LOCK_REDIRECT = "/paid-restricted?reason=billing"
