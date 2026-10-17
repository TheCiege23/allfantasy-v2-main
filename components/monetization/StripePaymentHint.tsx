"use client";

/**
 * Visible Stripe branding + link so users know checkout is on Stripe’s hosted page.
 */
export function StripePaymentHint({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] leading-relaxed text-white/45 ${className}`}>
      <span className="font-semibold text-white/60">Secure checkout with Stripe.</span> You’ll finish payment on
      Stripe’s hosted page.{" "}
      <a
        href="https://stripe.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-cyan-300/90 underline-offset-2 hover:underline"
      >
        stripe.com
      </a>
    </p>
  );
}
