"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HIGHLIGHT_TO_PLAN_FAMILY } from "@/lib/monetization/entitlements";
import { usePostPurchaseSync } from "@/hooks/usePostPurchaseSync";
import { TokenBalanceWidget } from "@/components/tokens/TokenBalanceWidget";
import { resolveCheckoutUrl } from "@/lib/monetization/checkout-client";
import { trackMetaBrowserEvent } from "@/lib/meta-client";
import { MonetizationComplianceNotice } from "@/components/monetization/MonetizationComplianceNotice";
import { LockedFeatureBanner } from "@/components/monetization/LockedFeatureBanner";
import { CheckoutOutcomePanel } from "@/components/monetization/CheckoutOutcomePanel";
import { AFProPlanSpotlight } from "@/components/monetization/AFProPlanSpotlight";
import { AFWarRoomPlanSpotlight } from "@/components/monetization/AFWarRoomPlanSpotlight";
import { AFSupremeBundleSpotlight } from "@/components/monetization/AFSupremeBundleSpotlight";
import {
  resolvePlanTierFromSku,
  trackMonetizationPageVisited,
  trackPlanCheckoutClicked,
  trackTokenPurchaseClicked,
  trackUpgradeEntryClicked,
} from "@/lib/monetization-analytics";
import { useGeoRestriction } from "@/lib/geo/useGeoRestriction";
import { Check } from "lucide-react";
import { PLAN_FAMILY_INCLUDES, PLAN_FAMILY_SHORT_TAGLINE } from "@/lib/monetization/planIncludes";
import { StripePaymentHint } from "@/components/monetization/StripePaymentHint";
import CouponInput from "@/components/promotions/CouponInput";
import { trackCouponApplied } from "@/lib/promotions/couponAnalytics";

export type PlanFamily =
  | "af_pro"
  | "af_commissioner"
  | "af_war_room"
  | "af_supreme";

type CatalogItem = {
  sku: string;
  type: "subscription" | "token_pack";
  title: string;
  description: string;
  amountUsd: number;
  currency: "usd";
  interval: "month" | "year" | null;
  tokenAmount: number | null;
  planFamily: PlanFamily | null;
  stripePriceConfigured: boolean;
  checkoutProvider: "stripe_checkout_link";
};

type CatalogPayload = {
  catalog: {
    subscriptions: CatalogItem[];
    tokenPacks: CatalogItem[];
    all: CatalogItem[];
  };
  fancredBoundary: {
    version: string;
    short: string;
    long: string;
    checklist: readonly string[];
  };
};

const CATALOG_CACHE_KEY = "af:monetization:catalog:v1";
const CATALOG_CACHE_TTL_MS = 5 * 60_000;

type CatalogCacheEnvelope = {
  cachedAt: number;
  payload: CatalogPayload;
};

function readCatalogCache(): CatalogPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CatalogPayload | CatalogCacheEnvelope;
    if (!parsed) return null;

    if ("payload" in parsed && "cachedAt" in parsed) {
      const ageMs = Date.now() - Number(parsed.cachedAt || 0);
      if (ageMs > CATALOG_CACHE_TTL_MS) {
        window.sessionStorage.removeItem(CATALOG_CACHE_KEY);
        return null;
      }
      return parsed.payload;
    }

    // Backward compatibility for older cache shape.
    return parsed as CatalogPayload;
  } catch {
    return null;
  }
}

function writeCatalogCache(payload: CatalogPayload): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: CatalogCacheEnvelope = {
      cachedAt: Date.now(),
      payload,
    };
    window.sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // best-effort client cache only
  }
}

const PLAN_FAMILY_ORDER: PlanFamily[] = [
  "af_pro",
  "af_commissioner",
  "af_war_room",
  "af_supreme",
];

const PLAN_FAMILY_LABELS: Record<PlanFamily, string> = {
  af_pro: "AF Pro",
  af_commissioner: "AF Commissioner",
  af_war_room: "AF Legacy",
  af_supreme: "AF Supreme",
};

const PRICING_CONVERSION_BULLETS: readonly string[] = [
  "Chimmy for waivers, trades, and matchup breakdowns",
  "Commissioner-grade controls and league automation",
  "Stripe checkout for subscriptions — league dues & payouts on FanCred",
];

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function normalizePlanFamilyInput(input: string | null | undefined): PlanFamily | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (value === "af_pro" || value === "pro") return "af_pro";
  if (value === "af_commissioner" || value === "commissioner") return "af_commissioner";
  // Legacy "all-access" deep links now resolve to the surviving AF Supreme bundle.
  if (value === "af_all_access" || value === "all_access") return "af_supreme";
  if (value === "af_war_room" || value === "war_room") return "af_war_room";
  if (value === "af_supreme" || value === "supreme") return "af_supreme";
  return null;
}

export default function MonetizationPurchaseSurface({
  pagePath,
  title,
  subtitle,
  focusPlanFamily = null,
  conversionHero = false,
}: {
  pagePath: string;
  title: string;
  subtitle: string;
  focusPlanFamily?: PlanFamily | null;
  /** Richer marketing header + value props (e.g. `/pricing`). */
  conversionHero?: boolean;
}) {
  const [payload, setPayload] = useState<CatalogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [pendingSku, setPendingSku] = useState<string | null>(null);
  const [appliedCouponCode, setAppliedCouponCode] = useState<string | null>(null);
  const [appliedCouponPct, setAppliedCouponPct] = useState<number>(0);
  const didTrackPageVisit = useRef(false);

  const postPurchaseSync = usePostPurchaseSync({
    successMessage: "Purchase complete. We refreshed your access and token balance.",
  });

  const geo = useGeoRestriction();
  const blockPaidCommerce = geo.isPaidBlocked && !geo.loading;

  const searchParams = useSearchParams();
  const highlightParam = searchParams?.get("highlight");

  useEffect(() => {
    if (!highlightParam) return;
    const family = HIGHLIGHT_TO_PLAN_FAMILY[highlightParam];
    if (!family) return;
    const id = `plan-card-${family}`;
    const t0 = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-cyan-400/70", "ring-offset-2", "ring-offset-[#05060a]");
      window.setTimeout(() => {
        el.classList.remove("ring-2", "ring-cyan-400/70", "ring-offset-2", "ring-offset-[#05060a]");
      }, 3000);
    }, 400);
    return () => window.clearTimeout(t0);
  }, [highlightParam]);

  useEffect(() => {
    let cancelled = false;
    const cached = readCatalogCache();
    if (cached) {
      setPayload(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    fetch("/api/monetization/catalog", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load catalog (${response.status})`);
        }
        return (await response.json()) as CatalogPayload;
      })
      .then((json) => {
        if (cancelled) return;
        setPayload(json);
        writeCatalogCache(json);
        setLoadError(null);
      })
      .catch(() => {
        if (cancelled) return;
        if (!cached) {
          setLoadError("Pricing is temporarily unavailable. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const plansByFamily = useMemo(() => {
    const map = new Map<PlanFamily, { monthly: CatalogItem | null; yearly: CatalogItem | null }>();
    for (const family of PLAN_FAMILY_ORDER) {
      map.set(family, { monthly: null, yearly: null });
    }
    for (const item of payload?.catalog.subscriptions ?? []) {
      if (!item.planFamily || !map.has(item.planFamily)) continue;
      const bucket = map.get(item.planFamily);
      if (!bucket) continue;
      if (item.interval === "month") bucket.monthly = item;
      if (item.interval === "year") bucket.yearly = item;
    }
    return map;
  }, [payload]);

  const orderedFamilies = useMemo(() => {
    if (!focusPlanFamily) return PLAN_FAMILY_ORDER;
    return [focusPlanFamily, ...PLAN_FAMILY_ORDER.filter((family) => family !== focusPlanFamily)];
  }, [focusPlanFamily]);

  const itemBySku = useMemo(() => {
    const map = new Map<string, CatalogItem>();
    for (const item of payload?.catalog.all ?? []) {
      map.set(item.sku, item);
    }
    return map;
  }, [payload?.catalog.all]);

  useEffect(() => {
    if (didTrackPageVisit.current) return;
    didTrackPageVisit.current = true;
    trackMonetizationPageVisited({
      pagePath,
      surface: "monetization_purchase_surface",
      focusPlanTier: focusPlanFamily ? resolvePlanTierFromSku(focusPlanFamily) : "unknown",
    });
  }, [focusPlanFamily, pagePath]);

  async function startCheckout(productType: "subscription" | "token_pack", sku: string) {
    if (blockPaidCommerce) {
      setCheckoutError("Paid purchases are not available in your state. You can still use free features.");
      return;
    }
    setCheckoutError(null);
    setPendingSku(sku);
    const item = itemBySku.get(sku);
    if (productType === "subscription" && item) {
      const interval = item.interval === "year" ? "year" : "month";
      trackPlanCheckoutClicked({
        sku,
        planTier: resolvePlanTierFromSku(item.planFamily ?? sku),
        interval,
        surface: "pricing_plan_card",
        pagePath,
      });
    } else if (productType === "token_pack") {
      trackTokenPurchaseClicked({
        sku,
        surface: "pricing_token_pack_card",
        pagePath,
      });
    }
    const result = await resolveCheckoutUrl({
      sku,
      productType,
      returnPath: pagePath,
      couponCode: appliedCouponCode,
    });
    if (!result.ok) {
      setCheckoutError(result.error);
      setPendingSku(null);
      return;
    }
    if (productType === "subscription") {
      trackMetaBrowserEvent(result.metaEvent);
    }
    window.location.assign(result.url);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05060a] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-48 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-[160px]" />
        <div className="absolute top-52 -left-56 h-[520px] w-[520px] rounded-full bg-fuchsia-500/7 blur-[180px]" />
        <div className="absolute -bottom-64 right-0 h-[560px] w-[560px] rounded-full bg-indigo-500/9 blur-[190px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {/*
          ⚠ BOTH OF THESE SIT ABOVE THE HERO BECAUSE THEY ARE ANSWERS TO QUESTIONS
          THE USER ARRIVED WITH. Someone returning from Stripe wants to know whether
          they were charged; someone bounced off a lock wants to know whether they
          lost their work. Neither should have to scroll past a marketing headline
          to find out, and both render nothing in the ordinary case.
        */}
        <div className="mb-6 flex flex-col gap-4 empty:mb-0">
          <CheckoutOutcomePanel
            phase={postPurchaseSync.state.phase}
            onRetry={postPurchaseSync.retrySync}
          />
          <LockedFeatureBanner />
        </div>

        {conversionHero ? (
          <>
            <header className="mb-8 flex flex-col gap-4 border-b border-white/[0.08] pb-8 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href="/"
                className="group flex min-h-[44px] max-w-fit items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 transition hover:border-cyan-400/25 hover:bg-white/[0.07]"
                data-testid="pricing-link-home"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/30 to-purple-600/25 text-lg text-white/95 ring-1 ring-white/10"
                  aria-hidden
                >
                  ✦
                </span>
                <span className="text-left">
                  <span className="block text-sm font-semibold text-white group-hover:text-cyan-200">AllFantasy.ai</span>
                  <span className="text-xs text-white/45">← Back to home</span>
                </span>
              </Link>
              <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href="/signup"
                    className="inline-flex min-h-[54px] items-center justify-center rounded-2xl bg-gradient-to-r from-emerald-400 via-cyan-400 to-fuchsia-400 px-8 text-lg font-extrabold text-[#041018] shadow-2xl shadow-cyan-500/30 ring-2 ring-cyan-300/40 transition hover:from-cyan-300 hover:to-fuchsia-300 hover:scale-[1.04] focus:outline-none focus:ring-4 focus:ring-emerald-300"
                    style={{ letterSpacing: '0.04em' }}
                    data-testid="pricing-cta-signup"
                  >
                    Unlock Full Access — Sign Up Free
                  </Link>
                <Link
                  href={`/login?next=${encodeURIComponent(pagePath)}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/20 bg-white/[0.06] px-4 text-sm font-semibold text-white/90 transition hover:bg-white/10"
                  data-testid="pricing-cta-signin"
                >
                  Sign in
                </Link>
              </div>
            </header>

              {/* Why Subscribe Section */}
              <section className="mb-10 mt-2 flex flex-col items-center justify-center gap-6 rounded-2xl border border-cyan-400/15 bg-cyan-400/5 px-6 py-7 shadow-cyan-400/10 shadow-lg">
                <h2 className="text-2xl font-bold text-cyan-200 mb-2 tracking-tight">Why Subscribe?</h2>
                <ul className="max-w-2xl space-y-4 text-base text-white/90">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/30 text-cyan-200"><Check className="h-4 w-4" /></span>
                    <span><span className="font-semibold text-cyan-100">Win More:</span> Get advanced trade, waiver, and draft insights tailored to your league.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/30 text-cyan-200"><Check className="h-4 w-4" /></span>
                    <span><span className="font-semibold text-cyan-100">Commissioner Tools:</span> Automate league management and unlock powerful controls.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/30 text-cyan-200"><Check className="h-4 w-4" /></span>
                    <span><span className="font-semibold text-cyan-100">AF Supreme:</span> One subscription for the full Pro + Commissioner + AF Legacy stack — best value for serious players.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/30 text-cyan-200"><Check className="h-4 w-4" /></span>
                    <span><span className="font-semibold text-cyan-100">Cancel Anytime:</span> No risk, no hassle. Try premium features and downgrade or cancel whenever you want.</span>
                  </li>
                </ul>
              </section>

            <div className="mb-10 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300/90">AllFantasy Premium</p>
              <h1 className="mt-3 bg-gradient-to-br from-white via-white to-white/75 bg-clip-text text-3xl font-bold leading-tight text-transparent sm:text-4xl md:text-5xl">
                {title}
              </h1>
              <p className="mx-auto mt-3 max-w-2xl text-base text-white/60 sm:text-lg">{subtitle}</p>
              <ul className="mx-auto mt-8 max-w-3xl space-y-3 text-left sm:mt-10">
                {PRICING_CONVERSION_BULLETS.map((line) => (
                  <li
                    key={line}
                    className="flex gap-3 rounded-xl border border-white/[0.07] bg-[#0a1220]/80 px-4 py-3 text-sm text-white/85"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-300">
                      <Check className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-8 text-xs text-white/40">
                Already exploring?{" "}
                <Link href="/" className="font-medium text-cyan-300/90 underline-offset-2 hover:underline">
                  Return to the main site
                </Link>
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-2 sm:mb-8">
              <Link
                href="/"
                className="inline-flex min-h-[44px] items-center gap-2 text-sm text-white/50 transition hover:text-white/80"
              >
                <span aria-hidden>&larr;</span> Back to Home
              </Link>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Link
                  href="/pricing"
                  className="rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-white/80 hover:bg-white/[0.08]"
                >
                  Pricing
                </Link>
                <Link
                  href="/tokens"
                  className="rounded-lg border border-white/15 bg-white/[0.03] px-3 py-1.5 text-white/80 hover:bg-white/[0.08]"
                >
                  Tokens
                </Link>
              </div>
            </div>

            <div className="mb-6 text-center sm:mb-8">
              <h1 className="bg-gradient-to-r from-white via-white/90 to-white/70 bg-clip-text text-2xl font-bold text-transparent sm:text-3xl md:text-4xl">
                {title}
              </h1>
              <p className="mt-2 text-sm text-white/55 sm:text-base">{subtitle}</p>
            </div>
          </>
        )}
        {blockPaidCommerce ? (
          <section
            className="mb-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-100"
            data-testid="geo-paid-restriction-banner"
          >
            <p className="font-semibold text-amber-50">
              Paid plans are not available{geo.stateName ? ` in ${geo.stateName}` : " in your state"}
            </p>
            <p className="mt-1 text-amber-100/90">
              State law restricts paid fantasy sports products from your location. You can still use AllFantasy for free — create
              an account, join free leagues, and use core tools.
            </p>
            <Link
              href={geo.stateCode ? `/paid-restricted?state=${encodeURIComponent(geo.stateCode)}` : "/paid-restricted"}
              className="mt-2 inline-block text-xs font-semibold text-cyan-300 hover:text-cyan-200"
            >
              Learn more
            </Link>
          </section>
        ) : null}
        {postPurchaseSync.state.phase !== "idle" ? (
          <section
            className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
              postPurchaseSync.state.phase === "success"
                ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100"
                : postPurchaseSync.state.phase === "cancelled"
                  ? "border-amber-300/35 bg-amber-500/10 text-amber-100"
                  : postPurchaseSync.state.phase === "failed"
                    ? "border-red-400/35 bg-red-500/10 text-red-100"
                    : "border-cyan-300/35 bg-cyan-500/10 text-cyan-100"
            }`}
            data-testid="post-purchase-sync-banner"
          >
            <p data-testid="post-purchase-sync-status">{postPurchaseSync.state.message}</p>
            {(postPurchaseSync.state.phase === "pending" ||
              postPurchaseSync.state.phase === "failed") ? (
              <button
                type="button"
                onClick={() => void postPurchaseSync.retrySync()}
                disabled={postPurchaseSync.isSyncing}
                className="mt-2 min-h-[40px] rounded-lg border border-white/25 bg-black/25 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-black/35 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="post-purchase-sync-retry"
              >
                {postPurchaseSync.isSyncing ? "Refreshing..." : "Refresh access now"}
              </button>
            ) : null}
          </section>
        ) : null}

        {focusPlanFamily === "af_pro" ? (
          <AFProPlanSpotlight className="mb-4" />
        ) : null}
        {focusPlanFamily === "af_war_room" ? (
          <AFWarRoomPlanSpotlight className="mb-4" />
        ) : null}
        {focusPlanFamily === "af_supreme" ? (
          <AFSupremeBundleSpotlight className="mb-4" />
        ) : null}

        <section className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" data-testid="monetization-plan-explanations">
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300/80">What each plan includes</h2>
          <p className="mt-1 text-[11px] text-white/50">
            Subscriptions unlock product areas; many actions still use tokens so usage stays fair at scale.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PLAN_FAMILY_ORDER.map((family) => (
              <article
                key={family}
                className="rounded-xl border border-white/10 bg-black/25 p-4"
                data-testid={`pricing-plan-summary-${family}`}
              >
                <p className="text-sm font-semibold text-white">{PLAN_FAMILY_LABELS[family]}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/65">{PLAN_FAMILY_SHORT_TAGLINE[family]}</p>
                <ul className="mt-3 list-none space-y-2 border-t border-white/[0.08] pt-3">
                  {PLAN_FAMILY_INCLUDES[family].map((line) => (
                    <li key={line} className="flex gap-2 text-[11px] leading-snug text-white/80">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/90" aria-hidden />
                      <span className="min-w-0 break-words">{line}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-white/55" data-testid="pricing-token-model-copy">
            <span className="font-medium text-white/70">Tokens:</span> pay-per-use credits for heavy-use features. Costs vary by
            action; subscribers may get discounts on eligible rules.
          </p>
        </section>

        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-cyan-300/80">AF Free</div>
          <div className="mt-2 text-2xl font-black">
            $0 <span className="text-sm font-medium text-white/60">/forever</span>
          </div>
          <p className="mt-2 text-sm text-white/65">League creation and league management are free.</p>
        </div>
        <div className="mb-4">
          <TokenBalanceWidget />
        </div>

        {/* Sponsor / promo coupon input */}
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
            Have a promo code?
          </p>
          <CouponInput
            productType="subscription"
            placeholder="WassupFred"
            onApplied={(code, pct) => {
              setAppliedCouponCode(code)
              setAppliedCouponPct(pct)
              trackCouponApplied({ couponCode: code, discountPercent: pct, surface: 'pricing_page', productType: 'subscription' })
            }}
            onRemoved={() => {
              setAppliedCouponCode(null)
              setAppliedCouponPct(0)
            }}
          />
          {!appliedCouponCode && (
            <p className="mt-2 text-[11px] text-white/35">
              Try <span className="font-black text-amber-300/60">WassupFred</span> for 20% off your first subscription or token pack
            </p>
          )}
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/60">
            Loading pricing catalog...
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
            {loadError}
          </div>
        ) : (
          <>
            {checkoutError ? (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {checkoutError}
              </div>
            ) : null}
            {appliedCouponCode && appliedCouponPct > 0 ? (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5 text-xs">
                <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="font-black text-emerald-300">{appliedCouponCode}</span>
                <span className="text-white/60">applied — {appliedCouponPct}% discount will be deducted at Stripe checkout</span>
              </div>
            ) : null}
            <div className="grid gap-5 md:grid-cols-2">
              {orderedFamilies.map((family) => {
                const plan = plansByFamily.get(family);
                if (!plan) return null;
                const monthly = plan.monthly;
                const yearly = plan.yearly;
                if (!monthly && !yearly) return null;
                const primary = monthly ?? yearly;
                if (!primary) return null;
                const focused = family === focusPlanFamily;
                const includes = PLAN_FAMILY_INCLUDES[family];
                return (
                  <article
                    key={family}
                    id={`plan-card-${family}`}
                    className={`flex min-h-[28rem] flex-col rounded-2xl border bg-gradient-to-br from-[#0a0f1d] via-[#0b1326] to-[#080d19] p-5 ${
                      focused ? "border-cyan-300/40 shadow-[0_0_0_1px_rgba(34,211,238,0.2)]" : "border-white/10"
                    }`}
                    data-testid={`pricing-plan-card-${family}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs uppercase tracking-[0.18em] text-cyan-300/80">
                        {PLAN_FAMILY_LABELS[family]}
                      </div>
                      {focused ? (
                        <span className="rounded-full border border-cyan-300/35 bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                          Recommended
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-2 text-lg font-semibold leading-snug text-white">
                      {primary.title.replace(" Monthly", "").replace(" Yearly", "")}
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-white/60 [overflow-wrap:anywhere]">
                      {primary.description}
                    </p>
                    <ul className="mt-3 flex-1 list-none space-y-2 border-t border-white/[0.08] pt-3">
                      {includes.map((line) => (
                        <li key={line} className="flex gap-2 text-[11px] leading-snug text-white/78">
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400/90" aria-hidden />
                          <span className="min-w-0 break-words">{line}</span>
                        </li>
                      ))}
                    </ul>
                    {focused && focusPlanFamily !== "af_supreme" ? (
                      <Link
                        href="/pricing?highlight=supreme"
                        onClick={() =>
                          trackUpgradeEntryClicked({
                            targetPlan: "supreme",
                            sourcePlan: resolvePlanTierFromSku(family),
                            surface: "pricing_cross_upgrade_link",
                            pagePath,
                          })
                        }
                        className="mt-3 inline-flex rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-emerald-100 hover:bg-emerald-500/20"
                        data-testid={`pricing-cross-upgrade-supreme-${family}`}
                      >
                        Want the full stack? Get AF Supreme
                      </Link>
                    ) : null}
                    <div className="mt-auto space-y-3 pt-4">
                      {monthly ? (
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                          <div className="flex flex-wrap items-end justify-between gap-2 text-white/85">
                            <span className="text-sm font-medium">Billed monthly</span>
                            <span className="text-lg font-bold tabular-nums text-cyan-200">{formatUsd(monthly.amountUsd)}</span>
                          </div>
                          {monthly.tokenAmount != null && monthly.tokenAmount > 0 ? (
                            <p className="mt-1 text-[11px] font-medium text-cyan-100/85">
                              Includes {monthly.tokenAmount.toLocaleString()} tokens each month
                            </p>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => startCheckout("subscription", monthly.sku)}
                            disabled={pendingSku != null || !monthly.stripePriceConfigured || blockPaidCommerce}
                            className="mt-3 min-h-[44px] w-full rounded-lg bg-cyan-500/90 px-3 py-2.5 text-xs font-semibold text-[#041018] shadow-md shadow-cyan-500/15 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                            data-testid={`pricing-subscription-cta-${monthly.sku}`}
                          >
                            {pendingSku === monthly.sku
                              ? "Opening Stripe…"
                              : appliedCouponCode
                                ? `Continue — ${appliedCouponPct}% off applied`
                                : "Continue with Stripe — Monthly"}
                          </button>
                          {!appliedCouponCode && (
                            <p className="mt-1.5 text-center text-[10px] text-white/30">
                              Use <span className="font-bold text-amber-300/60">WassupFred</span> for 20% off first purchase
                            </p>
                          )}
                          {monthly.stripePriceConfigured ? (
                            <StripePaymentHint className="mt-2" />
                          ) : (
                            <p className="mt-2 text-[10px] text-amber-200/90">
                              Checkout unavailable until this price is configured in Stripe.
                            </p>
                          )}
                        </div>
                      ) : null}
                      {yearly ? (
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                          <div className="flex flex-wrap items-end justify-between gap-2 text-white/85">
                            <span className="text-sm font-medium">Billed yearly</span>
                            <span className="text-lg font-bold tabular-nums text-cyan-200">{formatUsd(yearly.amountUsd)}</span>
                          </div>
                          {yearly.tokenAmount != null && yearly.tokenAmount > 0 ? (
                            <p className="mt-1 text-[11px] font-medium text-cyan-100/85">
                              Includes {yearly.tokenAmount.toLocaleString()} tokens each year
                            </p>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => startCheckout("subscription", yearly.sku)}
                            disabled={pendingSku != null || !yearly.stripePriceConfigured || blockPaidCommerce}
                            className="mt-3 min-h-[44px] w-full rounded-lg border border-cyan-400/35 bg-cyan-500/20 px-3 py-2.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                            data-testid={`pricing-subscription-cta-${yearly.sku}`}
                          >
                            {pendingSku === yearly.sku
                              ? "Opening Stripe…"
                              : "Continue with Stripe — Yearly"}
                          </button>
                          {yearly.stripePriceConfigured ? (
                            <StripePaymentHint className="mt-2" />
                          ) : (
                            <p className="mt-2 text-[10px] text-amber-200/90">
                              Checkout unavailable until this price is configured in Stripe.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            <section className="mt-8 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 sm:p-5">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-white/75">Token packs</h2>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/55">
                Top up whenever you need more tokens. Checkout is powered by{" "}
                <a
                  href="https://stripe.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-cyan-300/90 underline-offset-2 hover:underline"
                >
                  Stripe
                </a>{" "}
                — same secure flow as subscriptions.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(payload?.catalog.tokenPacks ?? []).map((pack) => (
                  <article
                    key={pack.sku}
                    className="flex min-h-[16rem] flex-col rounded-xl border border-white/10 bg-[#0a1220]/90 p-4"
                  >
                    <h3 className="text-sm font-semibold leading-snug text-white [overflow-wrap:anywhere]">{pack.title}</h3>
                    <p className="mt-2 flex-1 text-xs leading-relaxed text-white/58 [overflow-wrap:anywhere]">
                      {pack.description}
                    </p>
                    {pack.tokenAmount != null && pack.tokenAmount > 0 ? (
                      <p className="mt-2 text-[11px] font-medium text-cyan-200/90">
                        {pack.tokenAmount.toLocaleString()} tokens included
                      </p>
                    ) : null}
                    <div className="mt-3 text-xl font-bold tabular-nums text-cyan-300">{formatUsd(pack.amountUsd)}</div>
                    <button
                      type="button"
                      onClick={() => startCheckout("token_pack", pack.sku)}
                      disabled={pendingSku != null || !pack.stripePriceConfigured || blockPaidCommerce}
                      className="mt-3 min-h-[44px] w-full rounded-lg bg-cyan-500/90 px-3 py-2.5 text-xs font-semibold text-[#041018] transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid={`pricing-token-cta-${pack.sku}`}
                    >
                      {pendingSku === pack.sku ? "Opening Stripe…" : "Buy with Stripe"}
                    </button>
                    {pack.stripePriceConfigured ? <StripePaymentHint className="mt-2" /> : null}
                  </article>
                ))}
              </div>
            </section>

            <div className="mt-6">
              <MonetizationComplianceNotice fancredCopy={payload?.fancredBoundary} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
