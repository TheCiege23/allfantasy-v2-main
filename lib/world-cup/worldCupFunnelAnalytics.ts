"use client"

import { gtagEvent } from "@/lib/gtag"
import { trackMetaEventAndMirror } from "@/lib/meta-client"

// ── Funnel event names ────────────────────────────────────────────────────────

type WcFunnelEvent =
  | "WorldCupLandingViewed"
  | "WorldCupCreatePoolClicked"
  | "WorldCupGuestPoolStarted"
  | "WorldCupPoolDraftCompleted"
  | "WorldCupSignupPromptShown"
  | "WorldCupSignupStarted"
  | "WorldCupPoolCreated"
  | "WorldCupInviteCopied"
  | "WorldCupShareClicked"
  | "WorldCupBracketStarted"
  | "WorldCupBracketCompleted"
  | "WorldCupUpgradeClicked"
  | "AFProUpsellViewed"
  | "AFCommissionerUpsellViewed"
  | "AFSupremeUpsellViewed"
  | "TokenUpsellViewed"
  | "WcSponsorCouponViewed"
  | "WcSponsorCouponCopyClicked"
  | "WcSponsorCouponClaimClicked"
  // ── Media events ─────────────────────────────────────────────────────────
  | "WorldCupHeroVideoViewed"
  | "WorldCupHeroVideoPlayed"
  | "WorldCupHeroVideoFallbackShown"
  | "WorldCupMediaCtaClicked"
  // ── Mobile funnel events ─────────────────────────────────────────────────
  | "WorldCupInviteOverlayViewed"
  | "WorldCupNativeShareClicked"

// ── Helpers ───────────────────────────────────────────────────────────────────

export function trackWcFunnelEvent(
  event: WcFunnelEvent,
  params: Record<string, unknown> = {}
): void {
  gtagEvent(event, params)
}

/** Fire Meta ViewContent for the /world-cup landing page. */
export function trackWcLandingViewContent(): void {
  trackMetaEventAndMirror(
    "ViewContent",
    {
      content_name: "World Cup 2026 Pool Landing",
      content_category: "World Cup",
      value: 0,
      currency: "USD",
    },
    {
      sourceId: "wc_landing_page",
      contentName: "World Cup 2026 Pool Landing",
      contentCategory: "World Cup",
    }
  )
}

/** Track that a guest started filling out the pool draft form. */
export function trackWcGuestPoolStarted(step: number): void {
  gtagEvent("WorldCupGuestPoolStarted", { step })
}

/** Track that a guest completed the pool draft (before signup). */
export function trackWcPoolDraftCompleted(poolName: string): void {
  gtagEvent("WorldCupPoolDraftCompleted", { pool_name: poolName })
}

/** Track that the signup prompt was shown to a guest. */
export function trackWcSignupPromptShown(source: string): void {
  gtagEvent("WorldCupSignupPromptShown", { source })
}

/** Track that a guest clicked the signup CTA from the funnel. */
export function trackWcSignupStarted(source: string): void {
  gtagEvent("WorldCupSignupStarted", { source })
}

/** Track a real pool was created from a guest draft (post-auth). */
export function trackWcPoolCreated(challengeId: string, poolName: string): void {
  gtagEvent("WorldCupPoolCreated", { challenge_id: challengeId, pool_name: poolName })
}

/** Track share button/link clicked. */
export function trackWcShareClicked(source: string, challengeId?: string): void {
  gtagEvent("WorldCupShareClicked", { source, challenge_id: challengeId ?? null })
}

/** Track upgrade CTA clicked from any WC context. */
export function trackWcUpgradeClicked(plan: string, source: string): void {
  gtagEvent("WorldCupUpgradeClicked", { plan, source })
}

/** Track sponsor coupon card viewed on WC landing. */
export function trackWcSponsorCouponViewed(surface: string): void {
  gtagEvent("WcSponsorCouponViewed", { surface, coupon_code: "WASSUPFRED" })
}

/** Track copy-code button on sponsor coupon card. */
export function trackWcSponsorCouponCopyClicked(surface: string): void {
  gtagEvent("WcSponsorCouponCopyClicked", { surface, coupon_code: "WASSUPFRED" })
}

/** Track "Claim Discount" CTA on sponsor coupon card. */
export function trackWcSponsorCouponClaimClicked(surface: string): void {
  gtagEvent("WcSponsorCouponClaimClicked", { surface, coupon_code: "WASSUPFRED" })
}

// ── Media analytics ────────────────────────────────────────────────────────────

/** Track when the WC hero video element is visible (impression). */
export function trackWcHeroVideoViewed(): void {
  gtagEvent("WorldCupHeroVideoViewed", {})
}

/** Track first play event on the hero video. */
export function trackWcHeroVideoPlayed(): void {
  gtagEvent("WorldCupHeroVideoPlayed", {})
}

/** Track when the poster fallback is displayed instead of the video. */
export function trackWcHeroVideoFallbackShown(): void {
  gtagEvent("WorldCupHeroVideoFallbackShown", {})
}

/** Track CTA clicks inside/below the hero media card. */
export function trackWcMediaCtaClicked(source: string): void {
  gtagEvent("WorldCupMediaCtaClicked", { source })
}

// ── Mobile invite overlay ─────────────────────────────────────────────────────

