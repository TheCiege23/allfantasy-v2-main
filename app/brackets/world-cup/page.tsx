import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { getServerSession } from "next-auth"
import {
  ArrowRight,
  Bot,
  ChevronRight,
  Globe2,
  Layers,
  Lock,
  Plus,
  Radio,
  Settings,
  Share2,
  Shield,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react"
import { authOptions } from "@/lib/auth"
import { listUserWorldCupChallenges } from "@/lib/world-cup"
import { resolveServerRenderPreferences } from "@/lib/preferences/ServerRenderPreferenceResolver"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import LanguageToggle from "@/components/i18n/LanguageToggle"

const WC_LOGO_SRC = "/images/brackets/world-cup/af-world-cup-logo.png"
const WC_VIDEO_SRC = "/videos/brackets/world-cup/af-world-cup-hero.mp4"
const WC_POSTER_SRC = "/images/brackets/world-cup/af-world-cup-hero-poster.jpg"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "AF World Cup Bracket Challenge | AllFantasy.AI",
  description:
    "Predict every match of the FIFA World Cup 2026. Create or join a pool, build your bracket, and compete with friends using AI-powered analytics.",
  openGraph: {
    title: "AF World Cup Bracket Challenge",
    description:
      "Predict every match of the FIFA World Cup 2026. Create or join a bracket pool and compete with AI-powered analytics.",
    images: ["/images/brackets/world-cup/af-world-cup-hero-poster.jpg"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AF World Cup Bracket Challenge",
    description: "Predict every match of the FIFA World Cup 2026. Join a bracket pool on AllFantasy.AI.",
    images: ["/images/brackets/world-cup/af-world-cup-hero-poster.jpg"],
  },
}

/**
 * AF World Cup Pools Command Center — Phase 7 v3
 *
 * Visual upgrade: premium command-center hero (eyebrow badge, trophy glow,
 * cinematic title, stats strip, 4 CTAs), Action Cards (Create / Join / Discover),
 * 4-step How It Works, AI Advantage strip, Social/Invite teaser, and Trust Banner.
 *
 * All copy goes through makeWcT(language) — no hardcoded English. All new
 * keys added to worldCupI18n.ts across all 5 supported locales.
 *
 * Server component: no `"use client"`, no useState, no Prisma at render scope.
 * Same safety contract as /brackets hub (commit 53af1676c).
 */

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }
type WorldCupChallengeSummary = {
  id: string
  name: string
  seasonYear: number
  status: string
  participantCount: number
  totalScore: number
  rank: number | null
}

function PoolStatusBadge({
  status,
  t,
}: {
  status: string
  t: (key: string) => string
}) {
  if (status === "locked" || status === "final") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/40">
        <Lock className="h-2.5 w-2.5" />
        {status === "final"
          ? t("wc.publicHub.statusFinal")
          : t("wc.publicHub.statusLocked")}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
      <Radio className="h-2.5 w-2.5" />
      {t("wc.publicHub.statusOpen")}
    </span>
  )
}

type AiFeatureKey = "explain" | "danger" | "chat" | "commissioner"
type AiFeatureItem = { key: AiFeatureKey; Icon: typeof Sparkles }

const AI_FEATURE_ITEMS: AiFeatureItem[] = [
  { key: "explain", Icon: Sparkles },
  { key: "danger", Icon: Shield },
  { key: "chat", Icon: Bot },
  { key: "commissioner", Icon: Users },
]

type ActionKey = "create" | "join" | "discover"
type ActionItem = {
  key: ActionKey
  href: string
  Icon: typeof Plus
  accent: "cyan" | "violet" | "amber"
}

const ACTION_ITEMS: ActionItem[] = [
  { key: "create", href: "/brackets/world-cup/create", Icon: Plus, accent: "cyan" },
  { key: "join", href: "/brackets/world-cup/join", Icon: Users, accent: "violet" },
  { key: "discover", href: "/brackets/world-cup/discover", Icon: Globe2, accent: "amber" },
]

export default async function WorldCupBracketsPage() {
  const session = (await getServerSession(authOptions as any)) as { user?: SessionUser } | null
  const userId = session?.user?.id ?? null
  // Defensive: DB hiccups on cold-start should degrade gracefully (empty list),
  // not crash the server component and show a blank error page.
  const challenges: WorldCupChallengeSummary[] = userId
    ? await listUserWorldCupChallenges(userId).catch(() => [])
    : []
  const { language } = await resolveServerRenderPreferences()
  const t = makeWcT(language)

  // data-wc-dark: marks this element for the globals.css [data-wc-dark] rules that
  // prevent the DEFAULT_THEME="light" palette overrides from washing out the page.
  return (
    <main className="mode-readable relative min-h-screen overflow-hidden bg-[#05070b] text-white" data-wc-dark="">
      {/* ── Atmospheric background ──────────────────────────────────── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(20,184,166,0.16),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(67,56,202,0.12),transparent_60%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.045)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className="absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.04),transparent_70%)]" />
      </div>

      {/* ── Brand strip ─────────────────────────────────────────────── */}
      <div className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-4 pt-5 sm:px-6">
        <Link
          href="/brackets"
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/60 transition-colors hover:text-white"
        >
          {t("wc.publicHub.backToBrackets")}
        </Link>
        <div className="flex items-center gap-2">
          <LanguageToggle variant="compact" refreshOnChange />
          {userId && (
            <Link
              href="/settings"
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] p-2 text-white/60 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
              aria-label={t("wc.publicHub.accountSettings")}
              title={t("wc.publicHub.accountSettings")}
              data-testid="wc-public-settings-link"
            >
              <Settings className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>

      {/* ── Hero: Command Center ─────────────────────────────────────── */}
      <section
        data-testid="wc-command-hero"
        className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-4 pb-10 pt-8 text-center sm:px-6 sm:pt-14 sm:pb-16"
      >
        {/* Eyebrow badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/35 bg-emerald-500/[0.08] px-3.5 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300 sm:text-xs">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
          </span>
          {t("wc.publicHub.commandEyebrow")}
        </div>

        {/* Trophy glow card */}
        <div className="relative mt-7 flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/[0.08] p-2 backdrop-blur shadow-[0_0_50px_-10px_rgba(34,211,238,0.5)] sm:h-24 sm:w-24">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 rounded-2xl bg-[radial-gradient(circle,rgba(34,211,238,0.3),transparent_70%)] blur-xl"
          />
          <video
            src={WC_VIDEO_SRC}
            poster={WC_POSTER_SRC}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full rounded-2xl object-cover opacity-[0.10] mix-blend-luminosity"
          />
          <Image
            src={WC_LOGO_SRC}
            alt={t("wc.publicHub.commandEyebrow")}
            width={96}
            height={96}
            className="relative h-full w-full object-contain drop-shadow-[0_4px_16px_rgba(34,211,238,0.4)]"
            priority
          />
        </div>

        {/* Title */}
        <h1 className="mt-7 max-w-3xl text-3xl font-black leading-[1.07] tracking-tight sm:text-5xl lg:text-6xl">
          <span className="block text-white">{t("wc.publicHub.commandTitle")}</span>
        </h1>

        {/* Subtitle */}
        <p className="mt-5 max-w-xl text-sm leading-7 text-white/60 sm:text-base">
          {t("wc.publicHub.commandSubtitle")}
        </p>

        {/* Stats strip */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-white/70 sm:text-sm">
          {(
            [
              t("wc.publicHub.stat.teams"),
              t("wc.publicHub.stat.groups"),
              t("wc.publicHub.stat.matches"),
              t("wc.publicHub.stat.format"),
            ] as string[]
          ).map((stat) => (
            <span key={stat} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              {stat}
            </span>
          ))}
        </div>

        {/* Primary CTAs */}
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link
            href="/brackets/world-cup/create"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-400 px-6 py-3 text-sm font-black text-slate-950 shadow-[0_10px_40px_-10px_rgba(34,211,238,0.65)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
            data-testid="wc-cta-create"
          >
            <Plus className="h-4 w-4" />
            {t("wc.publicHub.createWorldCupPool")}
          </Link>
          <Link
            href="/brackets/world-cup/join"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-violet-400/35 bg-violet-500/[0.06] px-6 py-3 text-sm font-bold text-violet-200 transition-colors hover:border-violet-400/55 hover:bg-violet-500/[0.10] hover:text-violet-100"
            data-testid="wc-cta-join"
          >
            <Users className="h-4 w-4" />
            {t("wc.publicHub.joinWithCode")}
          </Link>
          <Link
            href="/brackets/world-cup/discover"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-amber-400/35 bg-amber-500/[0.06] px-6 py-3 text-sm font-bold text-amber-200 transition-colors hover:border-amber-400/55 hover:bg-amber-500/[0.10] hover:text-amber-100"
            data-testid="wc-cta-discover"
          >
            <Globe2 className="h-4 w-4" />
            {t("wc.publicHub.discover")}
          </Link>
        </div>

        {/* Trust note */}
        <p className="mt-5 text-[11px] text-white/35 sm:text-xs">
          {t("wc.publicHub.trustNote")}
        </p>
      </section>

      {/* ── Supporting sections ──────────────────────────────────────── */}
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-16 sm:gap-14 sm:px-6">

        {/* ── Your World Cup Pools ─────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-[0.16em] text-white/45">
              {t("wc.publicHub.yourPools")}
            </h2>
            {userId && challenges.length > 0 && (
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-xs font-bold text-white/35">
                {t(
                  challenges.length === 1
                    ? "wc.publicHub.poolsCountOne"
                    : "wc.publicHub.poolsCountOther"
                ).replace("{{count}}", String(challenges.length))}
              </span>
            )}
          </div>

          {userId ? (
            challenges.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {challenges.map((challenge) => (
                  <Link
                    key={challenge.id}
                    href={`/brackets/world-cup/${challenge.id}`}
                    className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:border-cyan-300/30 hover:bg-white/[0.07]"
                  >
                    {/* Pool name + status */}
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0 truncate font-black text-white group-hover:text-cyan-100">
                        {challenge.name}
                      </span>
                      <PoolStatusBadge status={challenge.status} t={t} />
                    </div>

                    {/* Meta row */}
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-white/40">
                      <span>{challenge.seasonYear}</span>
                      <span className="text-white/20">·</span>
                      <Users className="h-3 w-3" />
                      <span>
                        {t(
                          challenge.participantCount === 1
                            ? "wc.publicHub.participantsOne"
                            : "wc.publicHub.participantsOther"
                        ).replace("{{count}}", String(challenge.participantCount))}
                      </span>
                    </div>

                    {/* Score + rank row */}
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-white/30">
                            {t("wc.publicHub.scoreLabel")}
                          </div>
                          <div className="text-base font-black tabular-nums text-cyan-200">
                            {challenge.totalScore} pts
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-white/30">
                            {t("wc.publicHub.rankLabel")}
                          </div>
                          {challenge.rank != null ? (
                            <div className="text-base font-black tabular-nums text-white">
                              #{challenge.rank}
                            </div>
                          ) : (
                            <div className="text-sm font-black text-white/35">—</div>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-white/25 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-300/60" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              /* Signed in, no pools yet */
              <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-6 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-300/10">
                  <Globe2 className="h-6 w-6 text-cyan-200" />
                </div>
                <div>
                  <p className="font-black text-white">{t("wc.publicHub.emptyTitle")}</p>
                  <p className="mt-1 text-sm text-white/45">{t("wc.publicHub.emptyBody")}</p>
                  <p className="mt-1 text-xs text-white/30">{t("wc.publicHub.emptyHint")}</p>
                </div>
                <Link
                  href="/brackets/world-cup/create"
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-2.5 text-sm font-black text-black"
                >
                  <Plus className="h-4 w-4" />
                  {t("wc.publicHub.createWorldCupPool")}
                </Link>
              </div>
            )
          ) : (
            /* Signed out */
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-6 text-center sm:p-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-300/10">
                <Trophy className="h-6 w-6 text-cyan-200" />
              </div>
              <p className="font-black text-white">{t("wc.publicHub.signInTitle")}</p>
              <p className="mt-1 text-sm text-white/55">{t("wc.publicHub.signInBody")}</p>
              <Link
                href="/login?next=/brackets/world-cup"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-2.5 text-sm font-black text-black"
              >
                {t("wc.publicHub.signInCta")}
              </Link>
            </div>
          )}
        </section>

        {/* ── Action Cards ─────────────────────────────────────────── */}
        <section data-testid="wc-action-cards" className="space-y-4">
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            {t("wc.publicHub.actionsTitle")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {ACTION_ITEMS.map(({ key, href, Icon, accent }) => {
              const borderCls =
                accent === "cyan"
                  ? "border-cyan-300/25 hover:border-cyan-300/50 bg-gradient-to-br from-cyan-300/[0.08] to-white/[0.03]"
                  : accent === "violet"
                  ? "border-violet-400/20 hover:border-violet-400/40 bg-violet-500/[0.04]"
                  : "border-amber-400/20 hover:border-amber-400/40 bg-amber-500/[0.04]"
              const iconCls =
                accent === "cyan"
                  ? "border-cyan-300/35 bg-cyan-300/[0.12] text-cyan-200"
                  : accent === "violet"
                  ? "border-violet-400/30 bg-violet-500/[0.10] text-violet-200"
                  : "border-amber-400/30 bg-amber-500/[0.10] text-amber-200"
              const arrowHover =
                accent === "cyan"
                  ? "group-hover:text-cyan-200"
                  : accent === "violet"
                  ? "group-hover:text-violet-200"
                  : "group-hover:text-amber-200"
              return (
                <Link
                  key={key}
                  href={href}
                  className={`group flex flex-col gap-4 rounded-2xl border p-5 backdrop-blur transition-colors ${borderCls}`}
                  data-testid={`wc-action-card-${key}`}
                >
                  <span
                    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${iconCls}`}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-black text-white">
                      {t(`wc.publicHub.action.${key}.title`)}
                    </h3>
                    <p className="mt-1.5 text-sm leading-6 text-white/55">
                      {t(`wc.publicHub.action.${key}.desc`)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-white/30 transition-all group-hover:translate-x-0.5 ${arrowHover}`}
                  >
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </Link>
              )
            })}
          </div>
        </section>

        {/* ── How AF World Cup Pools Work (4-step) ─────────────────── */}
        <section data-testid="wc-how-it-works" className="space-y-4">
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            {t("wc.publicHub.how.title")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([1, 2, 3, 4] as const).map((step) => (
              <div
                key={step}
                className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur"
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-300/15 text-[11px] font-black text-cyan-100">
                  {step}
                </span>
                <h3 className="text-sm font-black text-white">
                  {t(`wc.publicHub.how.step${step}Title`)}
                </h3>
                <p className="text-xs leading-5 text-white/55">
                  {t(`wc.publicHub.how.step${step}Body`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── AI Advantage ─────────────────────────────────────────── */}
        <section data-testid="wc-ai-advantage" className="space-y-4">
          <div>
            <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
              {t("wc.publicHub.ai.title")}
            </h2>
            <p className="mt-1.5 text-sm text-white/55">
              {t("wc.publicHub.ai.subtitle")}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {AI_FEATURE_ITEMS.map(({ key, Icon }) => (
              <div
                key={key}
                className="flex items-start gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.04] p-4 backdrop-blur"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-300/[0.12] text-cyan-200">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-white">
                    {t(`wc.publicHub.ai.${key}.title`)}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-white/60">
                    {t(`wc.publicHub.ai.${key}.desc`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-white/35">{t("wc.publicHub.ai.gating")}</p>
        </section>

        {/* ── Social / Invite ──────────────────────────────────────── */}
        <section
          data-testid="wc-social-invite"
          className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/[0.06]">
            <Share2 className="h-5 w-5 text-white/55" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-black text-white">
              {t("wc.publicHub.social.title")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-white/55">
              {t("wc.publicHub.social.desc")}
            </p>
          </div>
          <Link
            href="/brackets/world-cup/create"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-5 py-2.5 text-sm font-bold text-white/80 transition-colors hover:border-white/25 hover:bg-white/[0.09]"
          >
            <Plus className="h-4 w-4" />
            {t("wc.publicHub.social.cta")}
          </Link>
        </section>

        {/* ── Trust Banner ─────────────────────────────────────────── */}
        <footer
          data-testid="wc-trust-banner"
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-[11px] text-white/50 sm:gap-4 sm:p-5"
        >
          <Layers className="h-4 w-4 shrink-0 text-white/35" aria-hidden />
          <p className="flex-1 leading-5">{t("wc.publicHub.trust.note")}</p>
        </footer>
      </div>
    </main>
  )
}
