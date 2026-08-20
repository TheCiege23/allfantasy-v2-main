import Link from 'next/link'
import {
  getLandingCopy,
  DEFAULT_LANDING_LANG,
  LANDING_LANGS,
  type LandingLang,
} from '@/lib/i18n/landing-copy'
import { getPlanPresentations, getMonthlyPriceRange } from '@/lib/monetization/planPresentation'
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

// Platform names are brands, so they are not translated; only the "soon" chip is.
const PLATFORMS = [
  { name: 'Sleeper', state: 'live' as const },
  { name: 'ESPN', state: 'live' as const },
  { name: 'Yahoo', state: 'live' as const },
  { name: 'MFL · Fantrax', state: 'soon' as const },
]

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
}: { lang?: LandingLang; signedIn?: boolean } = {}) {
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
    ? { href: '/dashboard', label: c.nav.goToDashboard }
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
          <a href="#pricing">{c.nav.pricing}</a>
          <Link href="/pricing">{c.nav.forCommissioners}</Link>
        </div>

        <div className="af-lp-nav-right">
          <LangSwitch lang={lang} label={c.nav.langLabel} />
          {/* "Sign in" is noise to someone already signed in. */}
          {signedIn ? null : <Link href="/login">{c.nav.signIn}</Link>}
          {/* Partners points at the B2B screen, which is served by the
              /core catch-all as the `partners` segment — no extra route. It was
              previously an in-page #business anchor, which became a dead link
              when the band moved off this page. */}
          <span className="af-lp-nav-divider" aria-hidden />
          <Link href="/core/partners" className="af-lp-partners">
            {c.nav.partners}
            <span className="af-lp-api-chip af-num">API</span>
          </Link>
          <Link href={primaryCta.href} className="af-btn af-lp-cta">
            {primaryCta.label}
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <header className="af-lp-hero">
        <div className="af-lp-hero-text">
          <span className="af-lp-eyebrow af-num">{c.hero.eyebrow}</span>
          <h1 className="af-lp-h1">
            {c.hero.h1a}
            <br />
            <span className="af-lp-h1-accent">{c.hero.h1b}</span>
          </h1>
          <p className="af-lp-sub">{c.hero.sub}</p>
          <div className="af-lp-hero-ctas">
            <Link href={primaryCta.href} className="af-btn af-lp-cta-lg">
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
        <aside className="af-lp-hero-card" aria-label="Example of the leagues view">
          <div className="af-lp-card-head">
            <span className="af-lp-card-title">{c.hero.cardTitle}</span>
            <span className="af-lp-card-week af-num">{c.hero.cardWeek}</span>
          </div>
          {[
            { mark: 'S', platform: 'sleeper', name: 'Dynasty Dragons', meta: 'Sleeper · Dynasty PPR', score: '96.2', against: '–88.4', tag: 'Set flex', tone: 'bad' },
            { mark: 'E', platform: 'espn', name: 'Gridiron Gang', meta: 'ESPN · 0.5 PPR', score: '74.0', against: '–91.6', tag: 'Waivers', tone: 'warn' },
            { mark: 'Y', platform: 'yahoo', name: 'Waiver Warriors', meta: 'Yahoo · Standard', score: '110.8', against: '–102.1', tag: 'Trade', tone: 'warn' },
            { mark: 'E', platform: 'espn', name: 'End Zone Elites', meta: 'ESPN · Keeper', score: '88.4', against: '–71.9', tag: 'All set', tone: 'good' },
          ].map((row) => (
            <div key={row.name} className="af-lp-card-row">
              <span className="af-platform af-lp-card-mark" data-platform={row.platform}>
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

      {/* ── Connects to ─────────────────────────────────────────────── */}
      <section className="af-lp-connects">
        <span className="af-label">{c.connects.label}</span>
        <div className="af-lp-connect-row">
          {PLATFORMS.map((p) => (
            <span key={p.name} className="af-lp-connect" data-state={p.state}>
              {p.name}
              {p.state === 'soon' ? (
                <span className="af-lp-soon af-num">{c.connects.soon}</span>
              ) : null}
            </span>
          ))}
        </div>
        <span className="af-lp-sports af-num">{c.connects.sports}</span>
      </section>

      {/* ── Three reasons ───────────────────────────────────────────── */}
      <section className="af-lp-reasons" id="how">
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
      <section className="af-lp-pricing" id="pricing">
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
            <article key={f.q} className="af-lp-faq-item">
              <h3 className="af-lp-faq-q">{f.q}</h3>
              <p className="af-lp-faq-a">{f.a}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Brown Pig network ───────────────────────────────────────── */}
      <section className="af-lp-network">
        {/*
          The parent mark. public/brand/brown-pig-llc.png has been in the repo the
          whole time and nothing referenced it — the section rendered its heading
          and six cards with no logo at all, which is why the page had ZERO images
          on it. Plain <img>, not next/image: this is a static local asset in a
          server component and the optimiser buys nothing at this size.
        */}
        <div className="af-lp-network-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="af-lp-network-mark"
            src="/brand/brown-pig-llc.png"
            alt="Brown Pig LLC"
            width={72}
            height={72}
            loading="lazy"
          />
          <div>
            <span className="af-label">{c.network.label}</span>
            <h2 className="af-lp-h2">{c.network.h2}</h2>
            <p className="af-lp-network-body">{c.network.body}</p>
          </div>
        </div>
        <div className="af-lp-network-grid">
          {c.network.cards.map((n) => {
            const href = NETWORK_HREFS[n.name]
            if (!href) return null
            return (
              <a
                key={n.name}
                href={href}
                className="af-lp-network-card"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="af-lp-network-name">{n.name}</span>
                <span className="af-lp-network-desc">{n.body}</span>
                <span className="af-lp-network-link af-num">
                  {href.replace(/^https?:\/\//, '')} →
                </span>
              </a>
            )
          })}
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
            <Link href="/core/players">{c.footer.playerFinder}</Link>
            <Link href="/dashboard">{c.footer.dashboard}</Link>
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
        <p className="af-lp-footer-compliance">{c.footer.compliance}</p>
      </footer>
    </div>
  )
}

export default LandingV4
