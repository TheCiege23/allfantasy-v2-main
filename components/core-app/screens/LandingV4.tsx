import Link from 'next/link'
import {
  getLandingCopy,
  DEFAULT_LANDING_LANG,
  LANDING_LANGS,
  type LandingLang,
} from '@/lib/i18n/landing-copy'
import { getPlanPresentations, getMonthlyPriceRange } from '@/lib/monetization/planPresentation'
import {
  getLandingConnectPlatforms,
  getLandingCreateSports,
  getLandingImportSports,
} from '@/components/core-app/screens/landingConnectPlatforms'
import { LandingDemoTabs } from '@/components/core-app/screens/LandingDemoTabs'
import { TradeMarketMovers } from '@/components/trade-market/TradeMarketMovers'
import { LaunchBanner } from '@/components/launch/LaunchBanner'
import { FORMAT_DEMO_META } from '@/lib/demo-league/formats/registry'
import type { FoundingOfferView } from '@/lib/monetization/foundingMember'
// af-core.css carries the .af-core token layer (--surface, --line, --accent …).
// AfCoreShell imports it for every screen inside the shell — but this one renders
// standalone at `/`, so without this line every `var(--surface)` and `var(--line)`
// below resolves to nothing: cards paint transparent with a 0px border, and
// --accent falls through to the unrelated #2563eb in app/globals.css. Verified on
// the live page before this fix: --surface, --surface2 and --line all computed to
// the empty string. Must precede af-landing.css so tokens exist before use.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-landing.css'

/**
 * Landing page — the "landing, auth & import" handoff.
 *
 * Token values in that handoff are byte-identical to the core-app one, so this
 * reuses the `.af-core` scope rather than duplicating a second copy that would
 * drift. See af-core.css for why the scope exists at all.
 *
 * MOUNTED AT `/` — app/page.tsx renders this component, so it carries the SEO
 * and every acquisition link.
 *
 * 2026-11-13 SIMPLIFICATION — the order is now: hero → connects → the commissioner band →
 * what you get (#how) → game day (#game-day) → demo (#demo) → pricing → FAQ. Four sections that
 * each said "every league in one place" (the Chimmy band, the three steps, the three reasons and
 * the standalone trade board) became "What you get"; the live trade board moved into the demo's
 * "Trade grade" tab, and the hero's two extra text links moved into the demo with it.
 *
 * The B2B band and its demo form live in Partners.tsx, served at /core/partners. This page is
 * B2C only.
 */

/*
 * Platform names are brands, so they are not translated; only the "soon" chip is.
 *
 * ⚠ `state` IS A CLAIM ABOUT PRODUCTION, NOT A ROADMAP. Anything marked `live` here is being
 * promised to a stranger who has not signed up yet, so it has to be true of what a real user can
 * import today, not of the code that exists.
 *
 * 🛑 SO THIS NO LONGER KEEPS ITS OWN LIST. It reads `lib/league-import/provider-ui-config.ts`, the
 * same flag that decides whether the import screen lets someone in, through
 * `getLandingConnectPlatforms`. Two lists about one fact drift; one does not.
 */
const PLATFORMS = getLandingConnectPlatforms()

/* Both read from the config that decides them — see landingConnectPlatforms.ts. */
const IMPORT_SPORTS = getLandingImportSports()
const CREATE_SPORTS = getLandingCreateSports()

/** The league types in the "League types" demo tab: the same registry /demo/formats renders. */
const LEAGUE_TYPES = FORMAT_DEMO_META.map((f) => f.title)

/** League codes stay as codes (the strip is mono caps); only soccer has a word to translate. */
function sportLabel(code: string, c: { connects: { soccer: string } }): string {
  return code === 'SOCCER' ? c.connects.soccer : code
}

/*
 * The uplift figure in the hero card's summary strip.
 *
 * Illustrative, like the four example leagues above it — the card is labelled
 * "example" in its own header for exactly this reason. It is a constant rather
 * than two typed-out strings because the handoff shows the number twice, in the
 * sentence and again as the large figure beside it.
 */
const EXAMPLE_UPLIFT = '+13.0'

/*
 * The game-day example's countdown ring: 41 of the last 120 minutes left before lock. A constant
 * beside the "41m" copy rather than computed from it, so a translator cannot break the drawing.
 */
const GAME_DAY_RING_PCT = Math.round((41 / 120) * 100)

// Hrefs are language-independent; the descriptions come from the copy module.
const NETWORK_HREFS: Record<string, string> = {
  Gooby: 'https://gogooby.com',
  'Cafe Con Chimmy': 'https://cafeconchimmy.com',
  'Parent Playbook': 'https://playbook.chimaura.com',
  PetPass: 'https://petpass.chimaura.com',
  SideQuest: 'https://sidequest.chimaura.com',
  StoryVault: 'https://storyvault.chimaura.com',
}

/**
 * Language switch — two plain links, not a client toggle.
 *
 * ⚠ IT HAS TO BE A REAL HREF. A button flipping React state would leave the URL
 * (and therefore the shareable address, the crawlable document and the metadata)
 * on English no matter what the reader picked. These render as `<a>` in the
 * server response, so both languages are reachable and indexable without
 * JavaScript, and `hreflang` on each one tells a crawler what it will get.
 *
 * Styled as a segmented control the same height and radius as the Sign in / Sign up buttons
 * beside it (2026-11-13: it was 11px mono text in a pill half their height, and read as a stray
 * label rather than a control).
 */
function LangSwitch({ lang, label, className }: { lang: LandingLang; label: string; className?: string }) {
  return (
    <div className={className ? `af-lp-lang ${className}` : 'af-lp-lang'} role="group" aria-label={label}>
      {LANDING_LANGS.map((code) => {
        const active = code === lang
        return (
          <Link
            key={code}
            // English is the canonical URL, so it drops the param rather than
            // creating a second address for the same document.
            href={code === DEFAULT_LANDING_LANG ? '/' : `/?lang=${code}`}
            hrefLang={code}
            className="af-lp-lang-opt af-num"
            data-active={active ? 'true' : undefined}
            aria-current={active ? 'true' : undefined}
          >
            {code === 'en' ? 'EN' : 'ES'}
          </Link>
        )
      })}
    </div>
  )
}

export function Shield() {
  return (
    <svg width="28" height="30" viewBox="0 0 28 30" aria-hidden focusable="false">
      <path
        d="M14 1.5 26 6v10.5c0 6.4-5 10.6-12 12.5-7-1.9-12-6.1-12-12.5V6l12-4.5Z"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <text
        x="14"
        y="19"
        textAnchor="middle"
        fill="var(--accent)"
        style={{ font: '900 10px Archivo, sans-serif', letterSpacing: '0.02em' }}
      >
        AF
      </text>
    </svg>
  )
}

/**
 * Renders text with every hyphenated word kept on one line. "long-time" in a 34–68px headline
 * broke as "long-" / "time" on a 390px phone (measured on /commissioners, 2026-11-13). The text
 * itself is unchanged — only the wrap — so textContent, tests and crawlers see the same string.
 */
export function NoBreakHyphens({ text }: { text: string }) {
  const parts = text.split(/(\S+-\S+)/)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="af-lp-nowrap">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  )
}

/* Stroke icons for the commissioner band — decorative, the card title carries the meaning. */
const COMMISH_ICONS = [
  <svg key="dues" width="26" height="26" viewBox="0 0 26 26" aria-hidden focusable="false">
    <rect x="3" y="6" width="20" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M3 11h20M8 16h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>,
  <svg key="trade" width="26" height="26" viewBox="0 0 26 26" aria-hidden focusable="false">
    <path d="M5 9h15l-4-4M21 17H6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>,
  <svg key="lineup" width="26" height="26" viewBox="0 0 26 26" aria-hidden focusable="false">
    <circle cx="13" cy="13" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M13 8v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>,
]

export function LandingV4({
  lang = DEFAULT_LANDING_LANG,
  signedIn = false,
  launch = null,
}: {
  lang?: LandingLang
  signedIn?: boolean
  /**
   * The pre-launch banner's data — app/page.tsx passes it only while the paywall has not started.
   * Null (the default) renders no banner, so this component carries no clock of its own.
   */
  launch?: { startsAt: string; founding: FoundingOfferView | null } | null
} = {}) {
  /*
   * ⚠ THE PRICES ARE READ FROM THE CATALOG HERE, NOT TYPED INTO THE COPY. getLandingCopy
   * REQUIRES the range, so the strings cannot be rendered without the live catalog and the
   * next price change reaches them for free. A plain synchronous read of a committed constant.
   */
  const c = getLandingCopy(lang, getMonthlyPriceRange(getPlanPresentations()))

  /*
   * Every "sign up" affordance on this page has a second meaning once the reader
   * already has an account. `/` serves this page to signed-in visitors too, so
   * "Sign up free" pointing at /signup would be asking a customer to register twice.
   *
   * Defined once and used for every primary CTA — nav, hero and pricing band — so
   * they cannot drift into disagreeing about who the reader is.
   */
  const primaryCta = signedIn
    ? { href: '/core', label: c.nav.goToDashboard }
    : { href: '/signup', label: c.nav.getStarted }

  /* The player finder needs an account; a stranger signs up and lands on it. */
  const gameDayHref = signedIn ? '/core/players' : '/signup?next=%2Fcore%2Fplayers'

  return (
    /*
     * `lang` on the wrapper, not just on <html>: the root layout is shared with
     * every other route and cannot see this page's searchParams, so without this
     * a screen reader would announce the Spanish page in an English voice.
     */
    <div className="af-core af-lp" lang={c.htmlLang}>
      {/* ── Nav ─────────────────────────────────────────────────────── */}
      <nav className="af-lp-nav" aria-label="Main">
        <Link href="/" className="af-lp-brand">
          <Shield />
          <span className="af-lp-wordmark">AllFantasy</span>
        </Link>

        <div className="af-lp-nav-links">
          <a href="#how">{c.nav.how}</a>
          <a href="#game-day">{c.nav.gameDay}</a>
          <a href="#demo">{c.nav.demo}</a>
          {/* Out of the iOS app with the #pricing section it scrolls to. */}
          <a href="#pricing" data-hide-in-ios-app>
            {c.nav.pricing}
          </a>
          <Link href="/commissioners">{c.nav.forCommissioners}</Link>
        </div>

        {/*
          ⚠ SIGN IN AND SIGN UP ARE A PAIR, AND BOTH ARE BUTTONS. Before 2026-11-13 the bar said
          only "Create free account": on desktop "Sign in" was a plain grey text link, and below
          1100px it was folded into the menu, so a returning user on a phone saw no way in.
        */}
        <div className="af-lp-nav-right">
          <LangSwitch lang={lang} label={c.nav.langLabel} />
          {signedIn ? null : (
            <Link href="/login" className="af-btn af-btn--ghost af-lp-signin" data-testid="landing-nav-sign-in">
              {c.nav.signIn}
            </Link>
          )}
          <Link href={primaryCta.href} className="af-btn af-lp-cta" data-testid="landing-nav-primary">
            {primaryCta.label}
          </Link>
        </div>

        {/*
          Below 1100px: language, Sign in, Sign up and the menu in one row. `details` keeps the
          menu usable in the server-rendered document and without JavaScript.
        */}
        <div className="af-lp-mobile-actions">
          <LangSwitch lang={lang} label={c.nav.langLabel} className="af-lp-lang--bar" />
          {signedIn ? null : (
            <Link
              href="/login"
              className="af-btn af-btn--ghost af-lp-mobile-signin"
              data-testid="landing-mobile-sign-in"
            >
              {c.nav.signInShort}
            </Link>
          )}
          <Link
            href={primaryCta.href}
            className="af-btn af-lp-mobile-primary"
            data-testid="landing-mobile-primary"
          >
            {signedIn ? primaryCta.label : c.nav.getStartedShort}
          </Link>
          <details className="af-lp-mobile-menu">
            <summary aria-label={c.nav.menuLabel}>
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden focusable="false">
                <path d="M3 5h14M3 10h14M3 15h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </summary>
            <div className="af-lp-mobile-panel">
              <a href="#how">{c.nav.how}</a>
              <a href="#game-day">{c.nav.gameDay}</a>
              <a href="#demo">{c.nav.demo}</a>
              <a href="#pricing" data-hide-in-ios-app>
                {c.nav.pricing}
              </a>
              <Link href="/commissioners">{c.nav.forCommissioners}</Link>
              <Link href="/core/partners" className="af-lp-partners">
                {c.nav.partners}
                <span className="af-lp-api-chip af-num">API</span>
              </Link>
              {/* Only shown on the narrowest phones, where the bar drops its own switch. */}
              <LangSwitch lang={lang} label={c.nav.langLabel} className="af-lp-lang--menu" />
            </div>
          </details>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <header className="af-lp-hero">
        <div className="af-lp-hero-text">
          <span className="af-lp-eyebrow af-num">{c.hero.eyebrow}</span>
          {/*
            THE PERFORMANCE GATE LOOKS FOR THIS TEST ID. A test id rather than the class:
            `af-lp-h1` is a styling hook and renaming it during a redesign is legitimate.
          */}
          <h1 className="af-lp-h1" data-testid="landing-hero-headline">
            {c.hero.h1a}
            <br />
            <span className="af-lp-h1-accent">{c.hero.h1b}</span>
          </h1>
          <p className="af-lp-sub">{c.hero.sub}</p>
          {/* Two buttons, not three: "See how it works" was a scroll the nav already offers. */}
          <div className="af-lp-hero-ctas">
            <Link href={primaryCta.href} className="af-btn af-lp-cta-lg" data-testid="landing-hero-primary">
              {signedIn ? primaryCta.label : c.hero.ctaPrimary}
            </Link>
            <Link href="/demo" className="af-btn af-btn--ghost af-lp-cta-lg" data-testid="landing-try-demo">
              {c.hero.ctaDemo}
            </Link>
          </div>
          {signedIn ? null : (
            <p className="af-lp-have-account">
              {c.hero.haveAccount}{' '}
              <Link href="/login" data-testid="landing-hero-sign-in">
                {c.nav.signIn}
              </Link>
            </p>
          )}
        </div>

        {/*
          The hero card is illustrative, and labelled as such. It shows the shape
          of the product with example leagues — not a live reading — so it must
          not be mistaken for someone's actual data.
        */}
        <aside className="af-lp-hero-card" aria-label={`${c.hero.cardTitle} · ${c.hero.cardWeek}`}>
          <div className="af-lp-card-head">
            <span className="af-lp-card-title">{c.hero.cardTitle}</span>
            <span className="af-lp-card-week af-num">{c.hero.cardWeek}</span>
          </div>
          {[
            { mark: 'S', platform: 'sleeper', name: 'Dynasty Dragons', meta: 'Sleeper · Dynasty PPR', score: '96.2', against: '–88.4', tag: 'Set flex', tone: 'bad' },
            { mark: 'E', platform: 'espn', name: 'Gridiron Gang', meta: 'ESPN · 0.5 PPR', score: '74.0', against: '–91.6', tag: 'Waivers', tone: 'warn' },
            { mark: 'S', platform: 'sleeper', name: 'Waiver Warriors', meta: 'Sleeper · Standard', score: '110.8', against: '–102.1', tag: 'Trade', tone: 'warn' },
            { mark: 'E', platform: 'espn', name: 'End Zone Elites', meta: 'ESPN · Keeper', score: '88.4', against: '–71.9', tag: 'All set', tone: 'good' },
          ].map((row) => (
            <div key={row.name} className="af-lp-card-row">
              <span className="af-platform af-platform-mark af-lp-card-mark" data-platform={row.platform}>
                {row.mark}
              </span>
              <span className="af-lp-card-text">
                <span className="af-lp-card-name">{row.name}</span>
                <span className="af-lp-card-meta">{row.meta}</span>
              </span>
              <span className="af-lp-card-score af-num">
                {row.score}
                <span className="af-lp-card-against">{row.against}</span>
              </span>
              <span className="af-lp-card-tag af-num" data-tone={row.tone}>
                {row.tag}
              </span>
            </div>
          ))}
          <div className="af-lp-card-foot">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="af-lp-card-foot-avatar"
              src="/images/chimmy-avatar.png"
              alt=""
              width={30}
              height={30}
              loading="lazy"
            />
            <span className="af-lp-card-foot-text">
              <strong className="af-lp-card-foot-title">
                {c.hero.cardFootBefore}
                {EXAMPLE_UPLIFT}
              </strong>
              <span className="af-lp-card-foot-meta">{c.hero.cardFootMeta}</span>
            </span>
            <span className="af-lp-card-foot-value af-num">{EXAMPLE_UPLIFT}</span>
          </div>
        </aside>
      </header>

      {/*
        ── Launch banner ──────────────────────────────────────────────
        ⚠ BELOW THE HERO, NOT ABOVE IT — moved 2026-09-29. On a 390px phone it filled the top half
        of the first screen with a pricing note about a product nobody had described yet.
      */}
      {launch ? (
        <LaunchBanner startsAt={launch.startsAt} lang={lang} signedIn={signedIn} founding={launch.founding} />
      ) : null}

      {/* ── Connects to ─────────────────────────────────────────────── */}
      <section className="af-lp-connects">
        <span className="af-label">{c.connects.label}</span>
        <div className="af-lp-connect-row">
          {PLATFORMS.map((p) => (
            <span
              key={p.name}
              className="af-lp-connect"
              data-state={p.state}
              /* A "soon" platform is a placeholder — not shown in the iOS app (App Store 2.1). */
              data-hide-in-ios-app={p.state === 'soon' ? '' : undefined}
            >
              {p.name}
              {p.state === 'soon' ? (
                <span className="af-lp-soon af-num">{c.connects.soon}</span>
              ) : null}
            </span>
          ))}
        </div>
        {/* Two labelled lists: imports are football today; a league created here runs every sport. */}
        <span className="af-lp-sports af-num">
          <span>
            <span className="af-lp-sports-label">{c.connects.importLabel}</span> {IMPORT_SPORTS.map((s) => sportLabel(s, c)).join(' · ')}
          </span>
          <span>
            <span className="af-lp-sports-label">{c.connects.createLabel}</span> {CREATE_SPORTS.map((s) => sportLabel(s, c)).join(' · ')}
          </span>
        </span>
        {/* Why a "soon" chip is soon — only while the config still has that platform off. */}
        {PLATFORMS.filter((p) => p.state === 'soon' && c.connects.soonNotes[p.provider]).map((p) => (
          <span key={`${p.provider}-note`} className="af-lp-soon-note" data-provider={p.provider} data-hide-in-ios-app="">
            {c.connects.soonNotes[p.provider]}
          </span>
        ))}
      </section>

      {/* ── For commissioners — the bold band ──────────────────────── */}
      {/*
        Was one quiet line under the hero ("Built by a commissioner, for commissioners. See
        Commissioner OS →"). The owner asked for it bold: a full-width accent band. Every tool it
        names is live on /commissioners; nothing from that page's roadmap is named here.
      */}
      <section className="af-lp-commish" id="commissioners" data-testid="landing-commish-line" aria-labelledby="af-lp-commish-h2">
        <span className="af-lp-commish-label af-num">{c.commish.label}</span>
        <h2 className="af-lp-commish-h2" id="af-lp-commish-h2">
          <NoBreakHyphens text={c.commish.h2} />
        </h2>
        <p className="af-lp-commish-body">{c.commish.body}</p>
        <ul className="af-lp-commish-grid">
          {c.commish.items.map((item, i) => (
            <li key={item.title} className="af-lp-commish-card">
              <span className="af-lp-commish-icon">{COMMISH_ICONS[i]}</span>
              <h3 className="af-lp-commish-card-title">{item.title}</h3>
              <p className="af-lp-commish-card-body">{item.body}</p>
            </li>
          ))}
        </ul>
        <div className="af-lp-commish-ctas">
          <Link href="/commissioners" className="af-lp-commish-btn" data-testid="landing-commish-primary">
            {c.commish.ctaPrimary}
          </Link>
          {signedIn ? null : (
            <Link href="/signup" className="af-lp-commish-btn af-lp-commish-btn--ghost">
              {c.commish.ctaSecondary}
            </Link>
          )}
        </div>
      </section>

      {/* ── What you get — the #how anchor ──────────────────────────── */}
      <section className="af-lp-get" id="how">
        <h2 className="af-lp-h2">{c.get.h2}</h2>
        <p className="af-lp-get-body">{c.get.body}</p>
        <ol className="af-lp-get-grid">
          {c.get.items.map((item, i) => (
            <li key={item.title} className="af-lp-get-card">
              <span className="af-lp-reason-n af-num">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="af-lp-get-title">{item.title}</h3>
              <p className="af-lp-get-card-body">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Game day: player search before kickoff ──────────────────── */}
      {/*
        The player finder's game-day mode (PlayerFinder.tsx): injury status with its report time,
        "Inactive" inside the last two hours (pregameInactive.ts), the lock clock per league
        (LockClock) and the swap (SwapCandidates). The card is an EXAMPLE and labelled as one.
      */}
      <section className="af-lp-gameday" id="game-day">
        <div className="af-lp-gameday-copy">
          <span className="af-lp-gameday-badge af-num">
            <span className="af-lp-gameday-dot" aria-hidden />
            {c.gameDay.badge}
          </span>
          <h2 className="af-lp-h2">{c.gameDay.h2}</h2>
          <p className="af-lp-get-body">{c.gameDay.body}</p>
          <ol className="af-lp-gameday-steps">
            {c.gameDay.steps.map((s, i) => (
              <li key={s}>
                <span className="af-lp-gameday-step-n af-num" aria-hidden>
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          <Link href={gameDayHref} className="af-btn af-lp-cta-lg" data-testid="landing-game-day-cta">
            {c.gameDay.cta}
          </Link>
        </div>

        <figure className="af-lp-gd-card" aria-label={`${c.gameDay.exampleLabel}: ${c.gameDay.playerName}, ${c.gameDay.status}`}>
          <div className="af-lp-gd-search">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
              <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12.5 12.5 16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span className="af-lp-gd-search-label">{c.gameDay.searchLabel}</span>
            <span className="af-lp-gd-search-value">{c.gameDay.playerName}</span>
            <span className="af-lp-gd-example af-num">{c.gameDay.exampleLabel}</span>
          </div>

          <div className="af-lp-gd-main">
            <div className="af-lp-gd-player">
              <div className="af-lp-gd-player-head">
                <span className="af-lp-gd-avatar af-num" aria-hidden>
                  TB
                </span>
                <span className="af-lp-gd-player-text">
                  <strong>{c.gameDay.playerName}</strong>
                  <span>{c.gameDay.playerMeta}</span>
                </span>
                <span className="af-lp-card-tag af-num" data-tone="bad">
                  {c.gameDay.status}
                </span>
              </div>
              <p className="af-lp-gd-note">{c.gameDay.statusNote}</p>

              <div className="af-lp-gd-lock">
                <span
                  className="af-lp-gd-ring"
                  style={{ ['--pct' as string]: `${GAME_DAY_RING_PCT}%` }}
                  aria-hidden
                >
                  <span className="af-lp-gd-ring-value af-num">{c.gameDay.lockValue}</span>
                </span>
                <span className="af-lp-gd-lock-text">
                  <strong>
                    {c.gameDay.lockValue} {c.gameDay.lockLabel}
                  </strong>
                  <span>{c.gameDay.lockMeta}</span>
                </span>
              </div>

              <ol className="af-lp-gd-track" aria-hidden>
                <li data-tone="bad">{c.gameDay.trackReport}</li>
                <li data-tone="now">{c.gameDay.trackNow}</li>
                <li data-tone="lock">{c.gameDay.trackLock}</li>
              </ol>
            </div>

            <div className="af-lp-gd-leagues">
              <span className="af-label">{c.gameDay.leaguesLabel}</span>
              <ul>
                {c.gameDay.leagues.map((l) => (
                  <li key={l.name} className="af-lp-gd-league" data-tone={l.tone}>
                    <span className="af-lp-gd-league-text">
                      <strong>{l.name}</strong>
                      <span>
                        {l.meta} · {l.state}
                      </span>
                    </span>
                    {l.action ? <span className="af-lp-gd-swap">{l.action}</span> : null}
                  </li>
                ))}
              </ul>
              <p className="af-lp-gd-chimmy">
                <span className="af-label">{c.gameDay.chimmyLabel}</span>
                {c.gameDay.chimmy}
              </p>
            </div>
          </div>
        </figure>
      </section>

      {/* ── Demo: try before you sign up ────────────────────────────── */}
      <section className="af-lp-demo" id="demo">
        <div className="af-lp-demo-head">
          <h2 className="af-lp-h2">{c.demo.h2}</h2>
          <p className="af-lp-get-body">{c.demo.body}</p>
        </div>
        <LandingDemoTabs
          label={c.demo.tabsLabel}
          tabs={[
            {
              id: 'leagues',
              label: c.demo.tabLeagues,
              panel: (
                <div className="af-lp-demo-pane">
                  <p className="af-lp-demo-pane-body">{c.demo.leaguesBody}</p>
                  <ul className="af-lp-demo-rows">
                    {c.demo.leaguesRows.map((r) => (
                      <li key={r.name} className="af-lp-demo-row">
                        <span>{r.name}</span>
                        <span className="af-lp-card-tag af-num" data-tone={r.tone}>
                          {r.tag}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/demo" className="af-btn af-lp-cta-lg" data-testid="landing-demo-league-link">
                    {c.demo.leaguesCta}
                  </Link>
                </div>
              ),
            },
            {
              id: 'trade',
              label: c.demo.tabTrade,
              /*
                The generic trade demo: live values from completed trades, and the free, no-import
                trade grader behind its button. Live data, not an example.
              */
              panel: (
                <div className="af-lp-trade-market" id="trade-values" data-testid="landing-trade-market">
                  <TradeMarketMovers
                    limit={4}
                    lang={lang}
                    heading={c.tradeMarket.heading}
                    ctaHref="/trade-evaluator"
                    ctaLabel={c.tradeMarket.cta}
                    testId="landing-trade-market-movers"
                  />
                </div>
              ),
            },
            {
              id: 'types',
              label: c.demo.tabTypes,
              panel: (
                <div className="af-lp-demo-pane">
                  <p className="af-lp-demo-pane-body">{c.demo.typesBody}</p>
                  <ul className="af-lp-demo-types">
                    {LEAGUE_TYPES.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                  <p data-testid="landing-league-types-link">
                    <Link href="/demo/formats" className="af-btn af-lp-cta-lg">
                      {c.demo.typesCta}
                    </Link>
                  </p>
                </div>
              ),
            },
          ]}
        />
      </section>

      {/* ── Pricing line ────────────────────────────────────────────── */}
      {/* Not in the iOS app: it quotes prices for a purchase the app does not sell (3.1.1). */}
      <section className="af-lp-pricing" id="pricing" data-hide-in-ios-app>
        <div className="af-lp-pricing-inner">
          <div className="af-lp-pricing-copy">
            <h2 className="af-lp-h2">{c.pricing.h2}</h2>
            <p className="af-lp-pricing-body">{c.pricing.body}</p>
          </div>
          <div className="af-lp-pricing-ctas">
            <Link href={primaryCta.href} className="af-btn">
              {signedIn ? primaryCta.label : c.pricing.ctaPrimary}
            </Link>
            <Link href="/pricing" className="af-btn af-btn--ghost">
              {c.pricing.ctaSecondary}
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <section className="af-lp-faq" id="faq">
        <h2 className="af-lp-h2">{c.faq.h2}</h2>
        {/*
          ⚠ OPEN CARDS, NOT <details> ACCORDIONS: three of these four answers are the ones a
          hesitant visitor needs BEFORE deciding. The same pairs are emitted as FAQPage structured
          data from app/page.tsx, off this exact array, so the copy and the schema cannot drift.
        */}
        <div className="af-lp-faq-grid">
          {c.faq.items.map((f) => (
            <article key={f.q} className="af-lp-faq-item" data-hide-in-ios-app={f.aboutPrice ? '' : undefined}>
              <h3 className="af-lp-faq-q">{f.q}</h3>
              <p className="af-lp-faq-a">{f.a}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="af-lp-footer">
        <div className="af-lp-footer-top">
          <span className="af-lp-brand">
            <Shield />
            <span className="af-lp-wordmark">AllFantasy</span>
          </span>
          <nav className="af-lp-footer-links" aria-label="Footer">
            <Link href="/commissioners">{c.nav.forCommissioners}</Link>
            <Link href="/core/players">{c.footer.playerFinder}</Link>
            <Link href="/core">{c.footer.dashboard}</Link>
            <Link href="/core/partners">{c.nav.partners}</Link>
            <Link href="/privacy">{c.footer.privacy}</Link>
            <Link href="/terms">{c.footer.terms}</Link>
            <Link href="/data-deletion">{c.footer.dataDeletion}</Link>
            <Link href="/privacy/choices">{c.footer.privacyChoices}</Link>
          </nav>
        </div>
        <div className="af-lp-footer-legal">
          <span>© 2026 AllFantasy.ai</span>
          <span className="af-lp-footer-builtby">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="af-lp-footer-mark"
              src="/brand/brown-pig-llc.png"
              alt=""
              width={34}
              height={34}
              loading="lazy"
            />
            <span className="af-lp-footer-builtby-text">
              <span className="af-label">{c.footer.builtByLabel}</span>
              <strong className="af-lp-footer-builtby-name">Brown Pig LLC</strong>
            </span>
          </span>
        </div>
        <p className="af-lp-footer-network">
          <span className="af-label">{c.network.label}</span>
          {c.network.cards.map((n) => {
            const href = NETWORK_HREFS[n.name]
            if (!href) return null
            return (
              <a key={n.name} href={href} title={n.body} target="_blank" rel="noopener noreferrer">
                {n.name}
              </a>
            )
          })}
        </p>
        {/* Jurisdiction copy is a compliance statement, not decoration — it stays verbatim. */}
        <p className="af-lp-footer-compliance">{c.footer.compliance}</p>
      </footer>
    </div>
  )
}

export default LandingV4
