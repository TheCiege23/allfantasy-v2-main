import type { Metadata } from "next"
import { buildSeoMeta } from "@/lib/seo"
import { BRACKETS_DESCRIPTION, BRACKETS_TITLE } from "./seo"
import Link from "next/link"
import Image from "next/image"
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Globe2,
  Layers,
  ListOrdered,
  Plus,
  Radio,
  Share2,
  Shield,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react"
import { resolveServerRenderPreferences } from "@/lib/preferences/ServerRenderPreferenceResolver"
import { makeBracketsT } from "@/lib/brackets/bracketsI18n"
import LanguageToggle from "@/components/i18n/LanguageToggle"

export const dynamic = "force-dynamic"

/**
 * Premium AllFantasy Bracket Pools hub — Phase 7 v2 (centered AF World
 * Cup Bracket Challenge hero).
 *
 * Hero matches the product reference: centered dark-teal stage with a
 * subtle grid overlay, top "Registration Open" badge, trophy lockup in
 * a glowing rounded square, two-line title (white + cyan→purple
 * gradient on line 2), tight subtitle, four feature dots, three CTAs
 * (cyan / dark / amber), and a country-codes + fan-line pill at the
 * bottom of the hero.
 *
 * Server component only (no `"use client"`, no useSession, no Prisma,
 * no useState). The original emergency hardening (commit `4bd1caf45`)
 * removed client islands because a BracketsAuthCTA `useSession`
 * hydration race produced React #418/#423 + a body wipe. This rebuild
 * stays on the safe side of that fence:
 *
 *   - Pure server component — only Next <Link> + <Image> client-bound
 *     primitives, both already battle-tested on the existing
 *     /brackets/world-cup routes.
 *   - Only static i18n preference read via the same
 *     `resolveServerRenderPreferences()` helper that ships on
 *     /brackets/world-cup/page.tsx today — wrapped in try/catch, never
 *     throws.
 *   - No DB writes, no API calls at render time.
 *   - Mode-aware: `mode-readable` wrapper lets the globals.css light-
 *     mode rescue remap hardcoded dark colors to the light theme
 *     under html[data-mode="light"]; dark + AF (legacy) modes keep
 *     the original premium dark styling.
 *   - Hydration-safe: locale comes from the server preference resolver,
 *     so SSR HTML matches first CSR. No locale-formatted dates render
 *     here.
 *
 * Below the dramatic hero the page keeps the existing How-it-works,
 * Sports grid (8 sport cards, World Cup live + 7 coming soon), AI
 * features strip (6 cards), and trust footer — they remain useful
 * supporting content but the hero is now the headline visual.
 */
type SportCard = {
  key:
    | "worldCup"
    | "nbaPlayoffs"
    | "nhlPlayoffs"
    | "nflPlayoffs"
    | "mlbPostseason"
    | "marchMadness"
    | "collegeFootball"
    | "soccer"
  /** Where to send the user; only "/brackets/world-cup" is wired. */
  href: string | null
  /** "live" → has a real bracket hub; "soon" → renders Coming Soon. */
  status: "live" | "soon"
  Icon: typeof Trophy
}

/*
 * THE CANONICAL LIVES HERE, NOT ON layout.tsx. Next merges metadata by
 * top-level field, so a canonical on the layout is inherited by all five routes
 * under /brackets — discover, join, world-cup, world-cup/create,
 * world-cup/discover — and each would declare itself a duplicate of this page.
 * Measured when it was briefly on the layout: all five emitted
 * `canonical .../brackets`, /brackets/world-cup included, which has its own
 * title. See ./seo.ts.
 */
export const metadata: Metadata = buildSeoMeta({
  title: BRACKETS_TITLE,
  description: BRACKETS_DESCRIPTION,
  canonicalPath: "/brackets",
})


const SPORT_CARDS: SportCard[] = [
  { key: "worldCup", href: "/brackets/world-cup", status: "live", Icon: Globe2 },
  { key: "nbaPlayoffs", href: null, status: "soon", Icon: Trophy },
  { key: "nhlPlayoffs", href: null, status: "soon", Icon: Trophy },
  { key: "nflPlayoffs", href: null, status: "soon", Icon: Trophy },
  { key: "mlbPostseason", href: null, status: "soon", Icon: Trophy },
  { key: "marchMadness", href: null, status: "soon", Icon: Trophy },
  { key: "collegeFootball", href: null, status: "soon", Icon: Trophy },
  { key: "soccer", href: null, status: "soon", Icon: Globe2 },
]

type AiFeature = {
  key:
    | "aiReport"
    | "rooting"
    | "danger"
    | "commissioner"
    | "share"
    | "leaderboards"
  Icon: typeof Sparkles
}

const AI_FEATURES: AiFeature[] = [
  { key: "aiReport", Icon: Sparkles },
  { key: "rooting", Icon: Trophy },
  { key: "danger", Icon: Shield },
  { key: "commissioner", Icon: ClipboardCheck },
  { key: "share", Icon: Share2 },
  { key: "leaderboards", Icon: ListOrdered },
]

/**
 * Feature keys used in the WC Spotlight card — static order, each maps
 * to `brk.hub.spotlight.feature.<key>` in all 5 language dictionaries.
 */
const SPOTLIGHT_FEATURE_KEYS = [
  "groupStage",
  "knockoutBracket",
  "aiReport",
  "dangerZones",
  "commissionerTools",
  "inviteShare",
  "fiveLanguages",
] as const

type QuickAction = {
  /** Must match a key in `brk.hub.quickActions.*` and `brk.hub.quickActions.*Desc` */
  key: "create" | "join" | "continue" | "browse"
  href: string
  Icon: typeof Plus
}

const QUICK_ACTIONS: QuickAction[] = [
  { key: "create",   href: "/brackets/world-cup/create",   Icon: Plus   },
  { key: "join",     href: "/brackets/join",                Icon: Users  },
  { key: "continue", href: "/brackets/world-cup",           Icon: Trophy },
  { key: "browse",   href: "/brackets/world-cup/discover",  Icon: Globe2 },
]

/**
 * Country codes shown in the bottom "join thousands of fans" pill.
 * These are static ISO codes — language-invariant by definition, so
 * no i18n key is needed. Four representative powerhouse nations from
 * different continents: Brazil, France, Germany, Argentina.
 */
const FAN_COUNTRY_CODES = ["BR", "FR", "DE", "AR"] as const

const WC_LOGO_SRC = "/images/brackets/world-cup/af-world-cup-logo.png"
const AF_WORDMARK_SRC = "/branding/allfantasy-wordmark-logo.png"

export default async function BracketsHomePage() {
  const { language } = await resolveServerRenderPreferences()
  const t = makeBracketsT(language)

  return (
    // Base canvas uses `bg-[#05070b]` (same as other brackets surfaces
    // and already covered by the globals.css mode-readable rescue layer)
    // — the teal atmosphere reads as deep-teal because the gradient
    // overlay below stacks a rgba(20,184,166,…) wash on top.
    <main className="mode-readable relative min-h-screen overflow-hidden bg-[#05070b] text-white">
      {/* Atmospheric stage background — dark teal radial wash + faint
          grid overlay + a soft particle dust effect via stacked radial
          gradients. All decorative, no client JS. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(20,184,166,0.16),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(67,56,202,0.12),transparent_60%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.045)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className="absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.05),transparent_70%)]" />
      </div>

      {/* Top brand strip — subtle wordmark + language toggle + Dashboard link */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 pt-6 sm:px-6">
        <Image
          src={AF_WORDMARK_SRC}
          alt={t("brk.hub.logoAlt")}
          width={120}
          height={24}
          className="h-6 w-auto object-contain opacity-80"
          priority
        />
        <div className="flex items-center gap-2">
          <LanguageToggle variant="compact" refreshOnChange />
          <Link
            href="/dashboard"
            className="hidden items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/65 transition-colors hover:border-white/30 hover:bg-white/[0.08] hover:text-white sm:inline-flex"
          >
            {t("brk.hub.heroDashboard")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          CENTERED HERO — AF World Cup Bracket Challenge
          ───────────────────────────────────────────────────────── */}
      <section
        data-testid="brackets-hub-hero"
        className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-4 pb-12 pt-10 text-center sm:px-6 sm:pt-16 sm:pb-20"
      >
        {/* Top registration badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/35 bg-emerald-500/[0.08] px-3.5 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300 sm:text-xs">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
          </span>
          {t("brk.hub.v2.regBadge")}
        </div>

        {/* Trophy glow card */}
        <div className="relative mt-8 flex h-24 w-24 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/[0.08] p-3 backdrop-blur shadow-[0_0_60px_-10px_rgba(34,211,238,0.55)] sm:h-28 sm:w-28">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 rounded-2xl bg-[radial-gradient(circle,rgba(34,211,238,0.35),transparent_70%)] blur-xl"
          />
          <Image
            src={WC_LOGO_SRC}
            alt={t("brk.hub.wcLogoAlt")}
            width={96}
            height={96}
            className="h-full w-full object-contain drop-shadow-[0_6px_20px_rgba(34,211,238,0.45)]"
            priority
          />
        </div>

        {/* Two-line title — white on top, cyan→purple gradient below */}
        <h1 className="mt-8 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          <span className="block text-white">{t("brk.hub.v2.titleLine1")}</span>
          <span className="mt-1 block bg-gradient-to-r from-cyan-300 via-cyan-200 to-purple-300 bg-clip-text text-transparent">
            {t("brk.hub.v2.titleLine2")}
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mt-6 max-w-xl text-sm leading-7 text-white/65 sm:text-base">
          {t("brk.hub.v2.subtitle")}
        </p>

        {/* Feature dots */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-white/70 sm:text-sm">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            {t("brk.hub.v2.feature.teams")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            {t("brk.hub.v2.feature.matches")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            {t("brk.hub.v2.feature.format")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            {t("brk.hub.v2.feature.free")}
          </span>
        </div>

        {/* Three CTAs — primary cyan / neutral dark / amber accent */}
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            href="/brackets/world-cup"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-400 px-6 py-3 text-sm font-black text-slate-950 shadow-[0_10px_40px_-10px_rgba(34,211,238,0.65)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <Globe2 className="h-4 w-4" />
            {t("brk.hub.v2.cta.openBracket")}
          </Link>
          <Link
            href="/brackets/world-cup/create"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-6 py-3 text-sm font-bold text-white transition-colors hover:border-white/30 hover:bg-white/[0.10]"
          >
            <Plus className="h-4 w-4" />
            {t("brk.hub.v2.cta.createPool")}
          </Link>
          <Link
            href="/brackets/world-cup/discover"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-amber-400/35 bg-amber-500/[0.06] px-6 py-3 text-sm font-bold text-amber-200 transition-colors hover:border-amber-400/55 hover:bg-amber-500/[0.10] hover:text-amber-100"
          >
            <Trophy className="h-4 w-4" />
            {t("brk.hub.v2.cta.discoverPools")}
          </Link>
          <Link
            href="/brackets/join"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-violet-400/35 bg-violet-500/[0.06] px-6 py-3 text-sm font-bold text-violet-200 transition-colors hover:border-violet-400/55 hover:bg-violet-500/[0.10] hover:text-violet-100"
          >
            <Users className="h-4 w-4" />
            {t("brk.hub.v2.cta.joinWithCode")}
          </Link>
        </div>

        {/* Country-code + fan-line pill */}
        <div
          data-testid="brackets-hub-fan-pill"
          className="mt-10 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/55 backdrop-blur sm:text-xs"
        >
          <div className="flex items-center gap-1">
            {FAN_COUNTRY_CODES.map((code) => (
              <span
                key={code}
                className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white/75 sm:text-[10px]"
              >
                {code}
              </span>
            ))}
          </div>
          <span className="text-white/60">{t("brk.hub.v2.fanLine")}</span>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          Supporting sections below the dramatic hero. Mobile-friendly,
          stack cleanly, kept from Phase 7 v1 so the hub still has the
          how-it-works / sports grid / AI features / footer that
          earlier validation covered.
          ───────────────────────────────────────────────────────── */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-12 sm:gap-14 sm:px-6 sm:pb-16">
        {/* ── WC Spotlight card ─────────────────────────────────── */}
        <section data-testid="brackets-hub-wc-spotlight">
          <div className="relative overflow-hidden rounded-2xl border border-cyan-300/25 bg-gradient-to-br from-cyan-300/[0.08] via-transparent to-purple-500/[0.06] p-5 backdrop-blur sm:p-7">
            {/* decorative ambient glow */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.18),transparent_70%)] blur-2xl"
            />

            {/* eyebrow badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/35 bg-emerald-500/[0.08] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
              </span>
              {t("brk.hub.spotlight.eyebrow")}
            </div>

            {/* title + subtitle */}
            <h2 className="mt-4 text-2xl font-black tracking-tight text-white sm:text-3xl">
              {t("brk.hub.spotlight.title")}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
              {t("brk.hub.spotlight.subtitle")}
            </p>

            {/* feature pills */}
            <ul className="mt-5 flex flex-wrap gap-2" aria-label="Included features">
              {SPOTLIGHT_FEATURE_KEYS.map((fk) => (
                <li
                  key={fk}
                  className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1 text-[11px] font-bold text-cyan-200"
                >
                  <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
                  {t(`brk.hub.spotlight.feature.${fk}`)}
                </li>
              ))}
            </ul>

            {/* CTA */}
            <div className="mt-6">
              <Link
                href="/brackets/world-cup"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-400 px-6 py-2.5 text-sm font-black text-slate-950 shadow-[0_6px_30px_-8px_rgba(34,211,238,0.55)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <Globe2 className="h-4 w-4" />
                {t("brk.hub.v2.cta.openBracket")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── Quick Actions row ─────────────────────────────────── */}
        <section data-testid="brackets-hub-quick-actions" className="space-y-4">
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            {t("brk.hub.quickActions.title")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACTIONS.map(({ key, href, Icon }) => (
              <Link
                key={key}
                href={href}
                className="group flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur transition-colors hover:border-white/20 hover:bg-white/[0.07]"
                data-testid={`brackets-hub-qa-${key}`}
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] text-white/70 transition-colors group-hover:border-cyan-300/35 group-hover:bg-cyan-300/[0.10] group-hover:text-cyan-200">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-white">{t(`brk.hub.quickActions.${key}`)}</h3>
                  <p className="mt-1 text-xs leading-5 text-white/50">
                    {t(`brk.hub.quickActions.${key}Desc`)}
                  </p>
                </div>
                <span className="mt-auto inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-white/40 transition-all group-hover:translate-x-0.5 group-hover:text-cyan-200">
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── How it works (4-step) ─────────────────────────────── */}
        <section data-testid="brackets-hub-how-it-works" className="space-y-4">
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            {t("brk.hub.howItWorks.title")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: "brk.hub.howItWorks.step1Title",
                body: "brk.hub.howItWorks.step1Body",
                step: 1,
              },
              {
                title: "brk.hub.howItWorks.step2Title",
                body: "brk.hub.howItWorks.step2Body",
                step: 2,
              },
              {
                title: "brk.hub.howItWorks.step3Title",
                body: "brk.hub.howItWorks.step3Body",
                step: 3,
              },
              {
                title: "brk.hub.howItWorks.step4Title",
                body: "brk.hub.howItWorks.step4Body",
                step: 4,
              },
            ].map(({ title, body, step }) => (
              <div
                key={title}
                className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur"
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-300/15 text-[11px] font-black text-cyan-100">
                  {step}
                </span>
                <h3 className="text-sm font-black text-white">{t(title)}</h3>
                <p className="text-xs leading-5 text-white/55">{t(body)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Sports grid */}
        <section data-testid="brackets-hub-sports-grid" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
                {t("brk.hub.sports.title")}
              </h2>
              <p className="mt-1 text-sm text-white/55">{t("brk.hub.sports.subtitle")}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SPORT_CARDS.map(({ key, href, status, Icon }) => {
              const isLive = status === "live"
              const titleKey = `brk.hub.sports.sport.${key}`
              const descKey = `brk.hub.sports.sport.${key}.desc`
              const cardClasses = [
                "group flex flex-col gap-3 rounded-2xl border p-4 backdrop-blur transition-colors",
                isLive
                  ? "border-cyan-300/25 bg-gradient-to-br from-cyan-300/[0.10] to-white/[0.04] hover:border-cyan-300/50"
                  : "border-white/10 bg-white/[0.03]",
              ].join(" ")
              const inner = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={
                          isLive
                            ? "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-300/[0.12] text-cyan-200"
                            : "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/45"
                        }
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <h3 className="text-sm font-black text-white">{t(titleKey)}</h3>
                    </div>
                    <span
                      className={
                        isLive
                          ? "inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/35 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-200"
                          : "inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white/55"
                      }
                    >
                      {isLive && <Radio className="h-2.5 w-2.5 animate-pulse" />}
                      {isLive ? t("brk.hub.sports.statusLive") : t("brk.hub.sports.statusComingSoon")}
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-white/55">{t(descKey)}</p>
                  {isLive && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-cyan-200 transition-transform group-hover:translate-x-0.5">
                      {t("brk.hub.sports.openCta")}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  )}
                </>
              )
              if (isLive && href) {
                return (
                  <Link key={key} href={href} className={cardClasses} data-testid={`brackets-hub-sport-${key}`}>
                    {inner}
                  </Link>
                )
              }
              return (
                <div key={key} className={`${cardClasses} cursor-default`} data-testid={`brackets-hub-sport-${key}`}>
                  {inner}
                </div>
              )
            })}
          </div>
        </section>

        {/* AI + Social features strip */}
        <section data-testid="brackets-hub-ai-features" className="space-y-4">
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            {t("brk.hub.features.title")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AI_FEATURES.map(({ key, Icon }) => (
              <div
                key={key}
                className="flex items-start gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4 backdrop-blur"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-300/[0.12] text-cyan-200">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-white">{t(`brk.hub.features.${key}`)}</h3>
                  <p className="mt-1 text-xs leading-5 text-white/60">{t(`brk.hub.features.${key}.desc`)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Footer / trust note */}
        <footer
          data-testid="brackets-hub-footer"
          className="mt-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center text-[11px] text-white/55 sm:gap-4 sm:p-5"
        >
          <Layers className="h-4 w-4 shrink-0 text-white/35" aria-hidden />
          <p className="flex-1 leading-5">{t("brk.hub.footer.note")}</p>
        </footer>
      </div>
    </main>
  )
}
