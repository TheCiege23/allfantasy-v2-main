import Link from "next/link"
import BracketExperienceHub from "@/components/brackets/BracketExperienceHub"
import { bracketExperienceCopy } from "@/lib/brackets/bracketExperienceCopy"
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

/** Public server shell with a deterministic preview. The client workspace reads only
 * authenticated bracket APIs; no useSession participates in first-render hydration.
 * Its scoped dark palette matches the approved bracket-experience concept.
 */
type SportCard = {
  key:
    | "worldCup"
    | "nbaPlayoffs"
    | "nbaCup"
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
const playoffPoolHref = (sport: "NBA" | "NHL" | "MLB" | "NCAAF" | "NBA_CUP") =>
  `/brackets/leagues/new?sport=${sport}&challengeType=playoff_challenge`

/*
 * The grid lists creatable bracket leagues first. CFP and NBA Cup share the
 * playoff challenge service but keep separate tournament formats and seeds.
 * When the calendar moves, move these — a card's status is a claim about today.
 */
const SPORT_CARDS: SportCard[] = [
  { key: "mlbPostseason", href: playoffPoolHref("MLB"), status: "live", Icon: Trophy },
  { key: "nhlPlayoffs", href: playoffPoolHref("NHL"), status: "live", Icon: Trophy },
  { key: "collegeFootball", href: playoffPoolHref("NCAAF"), status: "live", Icon: Trophy },
  { key: "nbaCup", href: playoffPoolHref("NBA_CUP"), status: "live", Icon: Trophy },
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
  const copy = bracketExperienceCopy(language)

  return (
    // Scoped colors preserve the approved dark canvas in light, dark and AF modes.
    <main className="af-bracket-experience relative min-h-screen overflow-hidden">
      {/* Top brand strip — subtle wordmark + language toggle + Dashboard link */}
      <div className="af-bx-top relative z-10 mx-auto flex w-full items-center justify-between">
        <Image
          src={AF_WORDMARK_SRC}
          alt={t("brk.hub.logoAlt")}
          width={1198}
          height={306}
          className="h-8 w-auto object-contain"
          priority
        />
        <div className="flex items-center gap-2">
          <nav className="af-bx-navigation" aria-label={copy.bracket}>
            <Link href="/brackets/my">{copy.myBrackets}</Link>
            <Link href="#bracket-leagues">{copy.myLeagues}</Link>
            <Link href="/brackets/discover">{copy.discover}</Link>
          </nav>
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

      <BracketExperienceHub language={language} season={new Date().getUTCFullYear()} />

      {/* ─────────────────────────────────────────────────────────────
          Supporting sections below the dramatic hero. Mobile-friendly,
          stack cleanly, kept from Phase 7 v1 so the hub still has the
          how-it-works / sports grid / AI features / footer that
          earlier validation covered.
          ───────────────────────────────────────────────────────── */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-col gap-10 px-4 pb-12 sm:gap-14 sm:px-6 sm:pb-16">
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
