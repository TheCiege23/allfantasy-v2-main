import Link from "next/link"
import Image from "next/image"
import {
  ArrowRight,
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
 * Premium AllFantasy Bracket Pools hub — v3 (AF Playoff Bracket Challenge
 * hero, 2026-10-01).
 *
 * v2 led with the World Cup: a hard-coded "2026 FIFA World Cup ·
 * Registration Open" badge, "Pick every game before kickoff", and Create /
 * Join buttons — still live in October, three months after the final, when
 * picks had been locked since the first kickoff. v3, per the owner's call:
 * the World Cup is switched off as a destination, MLB and NHL lead (pools are
 * creatable now, and picks lock per series, so mid-postseason is fine), and
 * the College Football Playoff (December) and NFL playoffs (January) are
 * shown as up next, not as links — no playoff template exists for either.
 *
 * Same stage as v2 (dark-teal wash, grid overlay, trophy lockup, two-line
 * gradient title); the badge, CTAs and the up-next row are what changed.
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
 *     /brackets/world-cup/page.tsx today.
 *     ⚠ CORRECTED: this used to say "wrapped in try/catch, never throws",
 *     and the wrapping is NOT here — the call below is bare. The safety is
 *     real but it lives one level down, inside the resolver, which catches
 *     its own failures and returns defaults. Worth stating accurately
 *     because this is a public signed-out page: it stays up only while the
 *     resolver keeps swallowing. `__tests__/brackets-hub.test.tsx` pins that
 *     dependency so removing the resolver's catch fails loudly here.
 *   - No DB writes, no API calls at render time.
 *   - Mode-aware: `mode-readable` wrapper lets the globals.css light-
 *     mode rescue remap hardcoded dark colors to the light theme
 *     under html[data-mode="light"]; dark + AF (legacy) modes keep
 *     the original premium dark styling.
 *   - Hydration-safe: locale comes from the server preference resolver,
 *     so SSR HTML matches first CSR. No locale-formatted dates render
 *     here.
 *
 * Below the hero: Quick actions, How-it-works, the Sports grid (8 cards —
 * see SPORT_CARDS for which are open, up next, and ended), the AI features
 * strip, and the trust footer. The v2 World Cup spotlight card is removed.
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
  /** Where to send the user; null for anything not open. */
  href: string | null
  /**
   * "live" → creatable now (must be a link); "soon" → not yet, never a link;
   * "ended" → its event is over, never a link. `brackets-hub.test.tsx` checks
   * that only "live" cards carry an href.
   */
  status: "live" | "soon" | "ended"
  /** For "soon": a month label key ("December") instead of a vague "Coming soon". */
  soonLabelKey?: string
  Icon: typeof Trophy
}

/**
 * ⚠ THIS GRID WENT STALE IN THE DIRECTION THAT COSTS USERS. NBA and NHL were
 * marked "coming soon" with a dead link while the playoff engine had been
 * serving them for months — 26 pools exist in production. A card that says
 * "soon" about a shipped product is not a cautious default; it is the reason
 * nobody found the feature.
 *
 * The create form is the door for all three. There is no per-sport landing
 * page and inventing one would be another surface to keep true, so the sport
 * is preselected and the card lands where it promises.
 *
 * `status: "live"` here must mean the create API's `sport` enum accepts it —
 * see app/api/brackets/playoffs/route.ts. Anything else drops through to the
 * legacy stack, whose league page is a dead end.
 */
const playoffPoolHref = (sport: "NBA" | "NHL" | "MLB") =>
  `/brackets/leagues/new?sport=${sport}&challengeType=playoff_challenge`

/*
 * Order is the season, as of the 2026-10-01 owner call: MLB and NHL are open
 * now; the College Football Playoff is up next in December and the NFL
 * playoffs in January (no playoff template exists for either yet, so they are
 * not links); the World Cup ended in July and is switched off as a destination.
 * When the calendar moves, move these — a card's status is a claim about today.
 */
const SPORT_CARDS: SportCard[] = [
  { key: "mlbPostseason", href: playoffPoolHref("MLB"), status: "live", Icon: Trophy },
  { key: "nhlPlayoffs", href: playoffPoolHref("NHL"), status: "live", Icon: Trophy },
  { key: "collegeFootball", href: null, status: "soon", soonLabelKey: "brk.hub.sports.statusDecember", Icon: Trophy },
  { key: "nflPlayoffs", href: null, status: "soon", soonLabelKey: "brk.hub.sports.statusJanuary", Icon: Trophy },
  { key: "nbaPlayoffs", href: playoffPoolHref("NBA"), status: "live", Icon: Trophy },
  { key: "marchMadness", href: null, status: "soon", Icon: Trophy },
  { key: "soccer", href: null, status: "soon", Icon: Globe2 },
  { key: "worldCup", href: null, status: "ended", Icon: Globe2 },
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

type QuickAction = {
  /** Must match a key in `brk.hub.quickActions.*` and `brk.hub.quickActions.*Desc` */
  key: "create" | "join" | "browse"
  href: string
  Icon: typeof Plus
}

/*
 * None of these lead into the World Cup any more. "Create" preselects MLB
 * because /brackets/leagues/new with no sport defaults to NCAAB — March
 * Madness, months away. "Continue My Bracket" is dropped: it pointed at the
 * World Cup, and there is no cross-sport "my brackets" page to send it to.
 */
const QUICK_ACTIONS: QuickAction[] = [
  { key: "create", href: playoffPoolHref("MLB"), Icon: Plus },
  { key: "join", href: "/brackets/join", Icon: Users },
  { key: "browse", href: "/brackets/discover", Icon: Globe2 },
]

/*
 * ⚠ `/branding/allfantasy-wordmark-logo.png` HAS NO ALPHA CHANNEL — 1024x682,
 * three channels, fully opaque — so on this page's `bg-[#05070b]` canvas it
 * painted its own dark background as a ~36x24 black box rather than a wordmark.
 * Nothing failed: the image loads (`complete=true`, naturalWidth 128 at the
 * served size), it is simply opaque artwork on a dark surface, which is why it
 * survived here while every other dark surface in the app had already moved.
 *
 * `/brand/allfantasy-wordmark-transparent.png` is what the rest of the app
 * uses on dark — including this page's own sibling, BracketsPageHeader — so
 * this was the one straggler, not a new convention.
 *
 * Found in a PWA store screenshot of this page, where the black box is exactly
 * the sort of thing a store reviewer notices.
 */
const AF_WORDMARK_SRC = "/brand/allfantasy-wordmark-transparent.png"

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
          width={1198}
          height={306}
          className="h-6 w-auto object-contain opacity-80"
          priority
        />
        <div className="flex items-center gap-2">
          <LanguageToggle variant="compact" />
          <Link
            href="/core"
            className="hidden items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white/65 transition-colors hover:border-white/30 hover:bg-white/[0.08] hover:text-white sm:inline-flex"
          >
            {t("brk.hub.heroDashboard")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
      {/* ─────────────────────────────────────────────────────────────
          CENTERED HERO — AF Playoff Bracket Challenge
          Owner call 2026-10-01: the World Cup is over and switched off as
          a destination; MLB and NHL brackets are open now; the College
          Football Playoff (December) and NFL playoffs (January) are up
          next. Every claim here is about TODAY — when the season moves,
          move the copy with it, or it goes as stale as the World Cup
          "Registration Open" badge this replaced (still live in October,
          three months after the final).
          ───────────────────────────────────────────────────────── */}
      <section
        data-testid="brackets-hub-hero"
        className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-4 pb-12 pt-10 text-center sm:px-6 sm:pt-16 sm:pb-20"
      >
        {/* Open-now badge — only sports a pool can actually be created for. */}
        <div
          data-testid="brackets-hub-open-badge"
          className="inline-flex items-center gap-2 rounded-full border border-emerald-400/35 bg-emerald-500/[0.08] px-3.5 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-300 sm:text-xs"
        >
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
          </span>
          {t("brk.hub.v3.openBadge")}
        </div>

        {/* Trophy glow card — a sport-neutral mark, not the World Cup logo */}
        <div className="relative mt-8 flex h-24 w-24 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/[0.08] p-3 backdrop-blur shadow-[0_0_60px_-10px_rgba(34,211,238,0.55)] sm:h-28 sm:w-28">
          <div
            aria-hidden
            className="absolute inset-0 -z-10 rounded-2xl bg-[radial-gradient(circle,rgba(34,211,238,0.35),transparent_70%)] blur-xl"
          />
          <Trophy className="h-12 w-12 text-cyan-200 drop-shadow-[0_6px_20px_rgba(34,211,238,0.45)] sm:h-14 sm:w-14" aria-hidden />
        </div>

        {/* Two-line title — white on top, cyan→purple gradient below */}
        <h1 className="mt-8 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          <span className="block text-white">{t("brk.hub.v3.titleLine1")}</span>
          <span className="mt-1 block bg-gradient-to-r from-cyan-300 via-cyan-200 to-purple-300 bg-clip-text text-transparent">
            {t("brk.hub.v3.titleLine2")}
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mt-6 max-w-xl text-sm leading-7 text-white/65 sm:text-base">
          {t("brk.hub.v3.subtitle")}
        </p>

        {/* Open-now CTAs — one per creatable sport, plus the generic join */}
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link
            href={playoffPoolHref("MLB")}
            data-testid="brackets-hub-cta-mlb"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-400 px-6 py-3 text-sm font-black text-slate-950 shadow-[0_10px_40px_-10px_rgba(34,211,238,0.65)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <Trophy className="h-4 w-4" />
            {t("brk.hub.v3.cta.mlb")}
          </Link>
          <Link
            href={playoffPoolHref("NHL")}
            data-testid="brackets-hub-cta-nhl"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-400 px-6 py-3 text-sm font-black text-slate-950 shadow-[0_10px_40px_-10px_rgba(34,211,238,0.65)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <Trophy className="h-4 w-4" />
            {t("brk.hub.v3.cta.nhl")}
          </Link>
          <Link
            href="/brackets/join"
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-violet-400/35 bg-violet-500/[0.06] px-6 py-3 text-sm font-bold text-violet-200 transition-colors hover:border-violet-400/55 hover:bg-violet-500/[0.10] hover:text-violet-100"
          >
            <Users className="h-4 w-4" />
            {t("brk.hub.v2.cta.joinWithCode")}
          </Link>
        </div>

        {/* Up next — NOT links: neither sport has a playoff template yet. */}
        <div
          data-testid="brackets-hub-up-next"
          className="mt-10 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/60 backdrop-blur sm:text-xs"
        >
          <span className="font-black uppercase tracking-wider text-white/75">{t("brk.hub.v3.upNext.title")}</span>
          <span className="rounded bg-white/10 px-2 py-0.5 font-bold text-white/75">{t("brk.hub.v3.upNext.ncaaf")}</span>
          <span className="rounded bg-white/10 px-2 py-0.5 font-bold text-white/75">{t("brk.hub.v3.upNext.nfl")}</span>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────
          Supporting sections below the dramatic hero. Mobile-friendly,
          stack cleanly, kept from Phase 7 v1 so the hub still has the
          how-it-works / sports grid / AI features / footer that
          earlier validation covered.
          ───────────────────────────────────────────────────────── */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pb-12 sm:gap-14 sm:px-6 sm:pb-16">
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
            {SPORT_CARDS.map(({ key, href, status, soonLabelKey, Icon }) => {
              const isLive = status === "live"
              const statusLabel = isLive
                ? t("brk.hub.sports.statusLive")
                : status === "ended"
                  ? t("brk.hub.sports.statusEnded")
                  : t(soonLabelKey ?? "brk.hub.sports.statusComingSoon")
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
                          ? "inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-300/35 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-emerald-200"
                          : "inline-flex shrink-0 items-center gap-1 rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[11px] font-black uppercase tracking-wider text-white/55"
                      }
                    >
                      {isLive && <Radio className="h-2.5 w-2.5 animate-pulse" />}
                      {statusLabel}
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
