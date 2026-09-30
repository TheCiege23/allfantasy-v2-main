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
import { LaunchBanner } from '@/components/launch/LaunchBanner'
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
 * and every acquisition link. (This note previously claimed the opposite; it
 * was left behind when the cut-over happened.)
 *
 * ⚠ THE B2B BAND SELLS "WE RUN DECISION OS AND CHIMMY OVER YOUR DATA" — a business
 * connects its own league data and we return decisions and signals, through their
 * surface or ours. It is NOT "send your users to our consumer app". Keep that
 * distinction when editing: the two readings are different products, and copy
 * neutral enough to mean either lets a reader book a call for the wrong one.
 *
 * It previously described
 * "the cross-platform layer, as an API" with a partner sign-in button and a
 * "sandbox keys same day" note — none of which exist: there is no partner surface
 * in this codebase and nothing issues a sandbox key. Every capability now listed is
 * something that ships and runs, and the single CTA is the one thing this page can
 * The B2B band and its demo form now live in Partners.tsx, served at
 * /core/partners. This page is B2C only.
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
 * `getLandingConnectPlatforms`. The hardcoded list that stood here said "MFL · Fantrax — soon" for
 * over two weeks after both went live (2026-08-27), and never listed Fleaflicker at all. Two lists
 * about one fact drift; one does not.
 *
 * The standard for flipping a provider lives beside its flag now, not here. Yahoo's entry records
 * why it is off (Yahoo has not approved AllFantasy's Fantasy Sports API access yet) and what has to be
 * true before it is switched back on.
 */
const PLATFORMS = getLandingConnectPlatforms()

/* Both read from the config that decides them — see landingConnectPlatforms.ts. */
const IMPORT_SPORTS = getLandingImportSports()
const CREATE_SPORTS = getLandingCreateSports()

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
 * sentence and again as the large figure beside it, and those are the two places
 * a later edit would change one and miss the other.
 */
const EXAMPLE_UPLIFT = '+13.0'

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
 */
function LangSwitch({ lang, label }: { lang: LandingLang; label: string }) {
  return (
    <div className="af-lp-lang" role="group" aria-label={label}>
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

function Shield() {
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
   * ⚠ THE PRICES ARE READ FROM THE CATALOG HERE, NOT TYPED INTO THE COPY.
   *
   * This page quoted "paid plans run $9.99–$29.99/mo" in both languages. $29.99
   * was AF Legacy's price before it dropped to $9.99, so the top of that range
   * had not been real for some time — on the page most new visitors see first.
   * getLandingCopy now REQUIRES the range, so the strings cannot be rendered
   * without the live catalog and the next price change reaches them for free.
   *
   * This is a plain synchronous read of a committed constant — no database, no
   * await — so it is free to do inside a server component.
   */
  const c = getLandingCopy(lang, getMonthlyPriceRange(getPlanPresentations()))

  /*
   * Every "sign up" affordance on this page has a second meaning once the reader
   * already has an account. `/` now serves this page to signed-in visitors too
   * (it used to redirect them to /dashboard, which is what made the domain land
   * people on /login — see app/page.tsx), so "Get started free" pointing at
   * /signup would be asking a customer to register twice.
   *
   * Defined once and used for all three CTAs — nav, hero and pricing band — so
   * they cannot drift into disagreeing about who the reader is.
   */
  const primaryCta = signedIn
    ? { href: '/core', label: c.nav.goToDashboard }
    : { href: '/signup', label: c.nav.getStarted }

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
          {/*
            ⚠ ALL THREE OF THESE WERE BROKEN AND TWO WERE SILENT ABOUT IT.
            `#how` pointed at the hero — measured, it scrolled to y=74, i.e. the
            top of the page you are already on — so "How it works" did nothing.
            The id now sits on the three-reasons section, which is the content
            that actually answers it. `#faq` was labelled "For commissioners"
            and landed on "Questions managers ask", which has no commissioner
            content; this page is player-only by handoff rule 1, so there is
            nothing here to link to and it now goes to /pricing, where AF
            Commissioner is a real tier with its own described feature list.
          */}
          <a href="#how">{c.nav.how}</a>
          {/* Out of the iOS app with the #pricing section it scrolls to. */}
          <a href="#pricing" data-hide-in-ios-app>
            {c.nav.pricing}
          </a>
          <Link href="/pricing">{c.nav.forCommissioners}</Link>
        </div>

        <div className="af-lp-nav-right">
          <LangSwitch lang={lang} label={c.nav.langLabel} />
          {/* "Sign in" is noise to someone already signed in. */}
          {signedIn ? null : (
            <Link href="/login" className="af-lp-signin" data-testid="landing-nav-sign-in">
              {c.nav.signIn}
            </Link>
          )}
          <Link href={primaryCta.href} className="af-btn af-lp-cta" data-testid="landing-nav-primary">
            {primaryCta.label}
          </Link>
        </div>

        {/*
          Phones get one compact header row instead of promoting every desktop
          control into three stacked rows. `details` keeps this usable in the
          server-rendered document and without JavaScript; the primary CTA stays
          outside the menu because it is the page's main conversion action.
        */}
        <div className="af-lp-mobile-actions">
          <Link
            href={primaryCta.href}
            className="af-btn af-lp-mobile-primary"
            data-testid="landing-mobile-primary"
          >
            {primaryCta.label}
          </Link>
          <details className="af-lp-mobile-menu">
            <summary aria-label="Open navigation menu">
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden focusable="false">
                <path d="M3 5h14M3 10h14M3 15h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </summary>
            <div className="af-lp-mobile-panel">
              <a href="#how">{c.nav.how}</a>
              <a href="#pricing" data-hide-in-ios-app>
                {c.nav.pricing}
              </a>
              <Link href="/pricing">{c.nav.forCommissioners}</Link>
              <Link href="/core/partners" className="af-lp-partners">
                {c.nav.partners}
                <span className="af-lp-api-chip af-num">API</span>
              </Link>
              {signedIn ? null : (
                <Link href="/login" data-testid="landing-mobile-sign-in">
                  {c.nav.signIn}
                </Link>
              )}
              <LangSwitch lang={lang} label={c.nav.langLabel} />
            </div>
          </details>
        </div>
      </nav>


      {/* ── Hero ────────────────────────────────────────────────────── */}
      <header className="af-lp-hero">
        <div className="af-lp-hero-text">
          <span className="af-lp-eyebrow af-num">{c.hero.eyebrow}</span>
          {/*
            THE PERFORMANCE GATE LOOKS FOR THIS, AND IT WAS NOT HERE.
            `landing-hero-headline` lives on LandingHero and ArrivalSection —
            both retired. `/` renders THIS component, so the gate waited 20
            seconds for a selector that is not on the page and failed every
            build. It reported as a budget failure for weeks and was a missing
            attribute.

            A test id rather than the class: `af-lp-h1` is a styling hook and
            renaming it during a redesign is legitimate, which is exactly how
            this broke the first time.
          */}
          <h1 className="af-lp-h1" data-testid="landing-hero-headline">
            {c.hero.h1a}
            <br />
            <span className="af-lp-h1-accent">{c.hero.h1b}</span>
          </h1>
          <p className="af-lp-sub">{c.hero.sub}</p>
          <div className="af-lp-hero-ctas">
            <Link href={primaryCta.href} className="af-btn af-lp-cta-lg" data-testid="landing-hero-primary">
              {signedIn ? primaryCta.label : c.hero.ctaPrimary}
            </Link>
            <a href="#how" className="af-btn af-btn--ghost af-lp-cta-lg">
              {c.hero.ctaSecondary}
            </a>
          </div>
          <p className="af-lp-reassure">{c.hero.reassure}</p>
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
            /* Was a Yahoo league. The card is labelled "example", but an example is still a
               claim about what you can connect — and Yahoo has never imported one. */
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
            {/* Same constant as the sentence above it, so the headline figure and
                the one written into the copy line cannot drift apart. */}
            <span className="af-lp-card-foot-value af-num">{EXAMPLE_UPLIFT}</span>
          </div>
        </aside>
      </header>

      {/*
        ── Launch banner ──────────────────────────────────────────────
        ⚠ BELOW THE HERO, NOT ABOVE IT — moved 2026-09-29. It sat above the hero "so nobody
        scrolls past it", and on a 390px phone that meant its ~400px filled the top half of the
        first screen: the first bold line a stranger read was "Pro analysis is free until Oct 15",
        a pricing note about a product nobody had described yet, and the headline began ~510px
        down. The hero now says what AllFantasy IS first; the countdown follows directly after the
        hero's CTA, which is still well inside the first scroll on every width.
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

      {/* ── How it works: what a new account actually does ─────────── */}
      {/*
        The nav's "How it works" used to land on the three-reasons section, which says why, not
        how. A stranger deciding whether to sign up wants to know what happens next and how much
        it asks of them — so the anchor now lands here.
      */}
      <section className="af-lp-reasons af-lp-steps" id="how">
        <h2 className="af-lp-h2">{c.steps.h2}</h2>
        <ol className="af-lp-reason-grid">
          {c.steps.items.map((s) => (
            <li key={s.n} className="af-lp-reason">
              <span className="af-lp-reason-n af-num">{s.n}</span>
              <h3 className="af-lp-reason-title">{s.title}</h3>
              <p className="af-lp-reason-body">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Chimmy ──────────────────────────────────────────────────── */}
      {/*
        The product's assistant was named on this page only in passing ("Paid plans add Chimmy"),
        so a stranger met the word before learning what it is. The exchange is an EXAMPLE and
        labelled as one, over the same four example leagues as the hero card — it must never read
        as somebody's real roster.
      */}
      <section className="af-lp-chimmy" aria-labelledby="af-lp-chimmy-h2">
        <div className="af-lp-chimmy-copy">
          <span className="af-label">{c.chimmy.label}</span>
          <h2 className="af-lp-h2" id="af-lp-chimmy-h2">
            {c.chimmy.h2}
          </h2>
          <p className="af-lp-chimmy-body">{c.chimmy.body}</p>
          <p className="af-lp-chimmy-free">{c.chimmy.free}</p>
        </div>
        <figure className="af-lp-chimmy-chat" aria-label={c.chimmy.exampleLabel}>
          <span className="af-lp-card-week af-num af-lp-chimmy-example">{c.chimmy.exampleLabel}</span>
          <p className="af-lp-chimmy-q">{c.chimmy.question}</p>
          <div className="af-lp-chimmy-a">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="af-lp-card-foot-avatar"
              src="/images/chimmy-avatar.png"
              alt=""
              width={30}
              height={30}
              loading="lazy"
            />
            <p>{c.chimmy.answer}</p>
          </div>
        </figure>
      </section>

      {/* ── Three reasons ───────────────────────────────────────────── */}
      <section className="af-lp-reasons">
        <h2 className="af-lp-h2">{c.reasons.h2}</h2>
        <div className="af-lp-reason-grid">
          {c.reasons.items.map((r) => (
            <article key={r.n} className="af-lp-reason">
              <span className="af-lp-reason-n af-num">{r.n}</span>
              <h3 className="af-lp-reason-title">
                {r.title[0]}
                <br />
                {r.title[1]}
              </h3>
              <p className="af-lp-reason-body">{r.body}</p>
            </article>
          ))}
        </div>
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
          ⚠ OPEN CARDS IN A 2×2 GRID, NOT <details> ACCORDIONS — this is what
          the handoff draws, and the reason is not only visual. Three of these
          four answers are the ones a hesitant visitor needs BEFORE deciding
          ("is this gambling?", "what does it cost?"), and an accordion hides
          every one of them behind a click. The same four Q&A pairs are also
          emitted as FAQPage structured data from app/page.tsx, off this exact
          array, so the copy and the schema cannot drift apart.
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
      {/*
        ⚠ THE BROWN PIG NETWORK IS A FOOTER LINE, NOT A SECTION — moved 2026-09-29. It was a full
        ~485px band of six cards linking out to other products, placed right before the footer: on
        desktop a fifth of the page, spent sending a visitor who has not signed up yet somewhere
        else. The links stay (below, with each product's one-liner as its tooltip); the band goes.
      */}
      <footer className="af-lp-footer">
        <div className="af-lp-footer-top">
          <span className="af-lp-brand">
            <Shield />
            <span className="af-lp-wordmark">AllFantasy</span>
          </span>
          <nav className="af-lp-footer-links" aria-label="Footer">
            <Link href="/core/players">{c.footer.playerFinder}</Link>
            <Link href="/core">{c.footer.dashboard}</Link>
            <Link href="/core/partners">{c.nav.partners}</Link>
            <Link href="/privacy">{c.footer.privacy}</Link>
            <Link href="/terms">{c.footer.terms}</Link>
            <Link href="/data-deletion">{c.footer.dataDeletion}</Link>
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
        {/*
          Jurisdiction copy is a compliance statement, not decoration — it stays
          in the footer verbatim.
        */}
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
        <p className="af-lp-footer-compliance">{c.footer.compliance}</p>
      </footer>
    </div>
  )
}

export default LandingV4
