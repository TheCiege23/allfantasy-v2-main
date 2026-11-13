import Link from 'next/link'
// Token layer first, then the landing page's own nav/hero/footer rules (reused verbatim so this page
// and `/` cannot drift apart), then the few rules only this page needs. See LandingV4 for why each
// stylesheet has to be imported by the screen rather than relied on from a shell.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-landing.css'
import '@/components/core-app/af-commissioners.css'
import { Shield } from '@/components/core-app/screens/LandingV4'
import { CommissionersCtaLink } from '@/components/core-app/screens/CommissionersCtaLink'
import { CommissionerScreenshot } from '@/components/core-app/screens/CommissionerScreenshot'
import { AllLeaguesChimmy } from '@/components/core-app/screens/AllLeaguesChimmy'
import {
  COMMISSIONERS_ALL_LEAGUES,
  COMMISSIONER_FEATURES,
  COMMISSIONERS_BOTTOM,
  COMMISSIONERS_HEALTH_EXAMPLE,
  COMMISSIONERS_HERO,
  COMMISSIONERS_HOW,
  COMMISSIONERS_PLATFORMS,
  COMMISSIONERS_ROADMAP,
} from '@/components/core-app/screens/commissionersCopy'
import {
  availableImportPlatformsPhrase,
  getImportPlatforms,
  importComingSoonMessage,
} from '@/lib/league-import/provider-ui-config'
import { signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { getLandingCopy, DEFAULT_LANDING_LANG } from '@/lib/i18n/landing-copy'
import { getPlanPresentations, getMonthlyPriceRange } from '@/lib/monetization/planPresentation'

/**
 * /commissioners — what Commissioner OS does, BEFORE anyone is shown a price.
 *
 * Every "For commissioners" link used to go straight to /pricing, so a commissioner was asked to
 * pick a plan before seeing a single feature. This page is where those links land now; pricing is
 * the secondary CTA, not the first thing on screen.
 *
 * ⚠ PLATFORM NAMES ARE READ FROM `provider-ui-config.ts`, NEVER TYPED. The chips, the League Hub
 * sentence and the "How it works" step all derive from `getImportPlatforms()`, so a coming-soon
 * platform (Yahoo, today) is badged as such here for exactly as long as the import API refuses it.
 *
 * Server component. The only client code is `CommissionersCtaLink`, which adds click analytics.
 */
export function CommissionersV4({ signedIn = false }: { signedIn?: boolean }) {
  const platforms = getImportPlatforms()
  const livePhrase = availableImportPlatformsPhrase()
  const fill = (s: string) => s.replace('{platforms}', livePhrase)

  // Signed in: straight to the importer. Signed out: sign up, then land on the importer.
  const importHref = signedIn ? '/import' : signupUrlWithIntent('/import')
  const footerCopy = getLandingCopy(DEFAULT_LANDING_LANG, getMonthlyPriceRange(getPlanPresentations()))
  const h = COMMISSIONERS_HERO
  const ex = COMMISSIONERS_HEALTH_EXAMPLE

  return (
    <div className="af-core af-lp af-cx" lang="en">
      {/* ── Nav — the landing page's markup and classes, with this page marked current ── */}
      <nav className="af-lp-nav" aria-label="Main">
        <Link href="/" className="af-lp-brand">
          <Shield />
          <span className="af-lp-wordmark">AllFantasy</span>
        </Link>

        <div className="af-lp-nav-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <Link href="/pricing" data-hide-in-ios-app>
            Pricing
          </Link>
          <Link href="/commissioners" aria-current="page" className="af-cx-nav-current">
            For commissioners
          </Link>
        </div>

        <div className="af-lp-nav-right">
          {signedIn ? null : (
            <Link href="/login" className="af-lp-signin">
              Sign in
            </Link>
          )}
          <CommissionersCtaLink href={importHref} cta="import" placement="nav" className="af-btn af-lp-cta">
            {h.ctaPrimary}
          </CommissionersCtaLink>
        </div>

        <div className="af-lp-mobile-actions">
          <CommissionersCtaLink
            href={importHref}
            cta="import"
            placement="mobile_nav"
            className="af-btn af-lp-mobile-primary"
          >
            Import free
          </CommissionersCtaLink>
          <details className="af-lp-mobile-menu">
            <summary aria-label="Open navigation menu">
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden focusable="false">
                <path d="M3 5h14M3 10h14M3 15h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </summary>
            <div className="af-lp-mobile-panel">
              <a href="#features">Features</a>
              <a href="#how">How it works</a>
              <Link href="/pricing" data-hide-in-ios-app>
                Pricing
              </Link>
              <Link href="/commissioners" aria-current="page">
                For commissioners
              </Link>
              {signedIn ? null : <Link href="/login">Sign in</Link>}
            </div>
          </details>
        </div>
      </nav>

      <main id="main">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <header className="af-lp-hero af-cx-hero">
          <div className="af-lp-hero-text">
            <span className="af-lp-eyebrow af-lp-eyebrow--accent af-num">{h.eyebrow}</span>
            <h1 className="af-lp-h1" data-testid="commissioners-hero-headline">
              {h.h1a}
              <br />
              <span className="af-lp-h1-accent">{h.h1b}</span>
            </h1>
            <p className="af-lp-sub">{h.sub}</p>
            <p className="af-cx-founder">{h.founder}</p>
            <div className="af-lp-hero-ctas">
              <CommissionersCtaLink
                href={importHref}
                cta="import"
                placement="hero"
                className="af-btn af-lp-cta-lg"
                testId="commissioners-hero-primary"
              >
                {h.ctaPrimary}
              </CommissionersCtaLink>
              <CommissionersCtaLink
                href="/pricing"
                cta="pricing"
                placement="hero"
                className="af-btn af-btn--ghost af-lp-cta-lg"
                testId="commissioners-hero-pricing"
              >
                {h.ctaSecondary}
              </CommissionersCtaLink>
            </div>
            <p className="af-lp-reassure">{h.reassure}</p>
          </div>

          {/* Illustrative, and labelled as such in its own header — not anyone's real league. */}
          <aside className="af-cx-health" aria-label={`${ex.title}, ${ex.week}`}>
            <div className="af-cx-health-head">
              <span className="af-cx-health-title">{ex.title}</span>
              <span className="af-cx-health-week af-num">{ex.week}</span>
            </div>
            <div className="af-cx-health-score">
              <span className="af-cx-health-num af-num">{ex.score}</span>
              <span className="af-cx-health-verdict">{ex.verdict}</span>
            </div>
            <div
              className="af-cx-meter"
              role="meter"
              aria-label="League health"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={ex.score}
            >
              <span className="af-cx-meter-fill" style={{ width: `${ex.score}%` }} />
            </div>
            <ul className="af-cx-health-list">
              {ex.alerts.map((a) => (
                <li key={a.tag} className="af-cx-health-row">
                  <span className="af-cx-tag af-num" data-tone={a.tone}>
                    {a.tag}
                  </span>
                  <span className="af-cx-health-text">{a.text}</span>
                </li>
              ))}
            </ul>
          </aside>
        </header>

        {/* ── Platforms — read from the import config ─────────────────── */}
        <section className="af-lp-connects af-cx-connects" aria-label={COMMISSIONERS_PLATFORMS.label}>
          <span className="af-label">{COMMISSIONERS_PLATFORMS.label}</span>
          <ul className="af-lp-connect-row af-cx-connect-row">
            {platforms.map((p) => (
              <li
                key={p.provider}
                className="af-lp-connect"
                data-state={p.status === 'live' ? 'live' : 'soon'}
                data-provider={p.provider}
              >
                {p.name}
                {p.status === 'coming_soon' ? (
                  <span className="af-lp-soon af-num">{COMMISSIONERS_PLATFORMS.soon}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {platforms
            .filter((p) => p.status === 'coming_soon')
            .map((p) => (
              <p key={p.provider} className="af-lp-soon-note" data-provider={p.provider}>
                {importComingSoonMessage(p.provider)}
              </p>
            ))}
        </section>

        {/* ── Every league + Chimmy — the reviewers' favourite, before the feature list ── */}
        <AllLeaguesChimmy
          id="all-leagues"
          // "and", not the import sentences' "or": this headline lists everything that comes together.
          copy={{ ...COMMISSIONERS_ALL_LEAGUES, h2: COMMISSIONERS_ALL_LEAGUES.h2.replace('{platforms}', availableImportPlatformsPhrase('and')), soon: COMMISSIONERS_PLATFORMS.soon }}
          cta={{ href: importHref, label: h.ctaPrimary }}
        />

        {/* ── Features ─────────────────────────────────────────────────── */}
        <div id="features" className="af-cx-features">
          {COMMISSIONER_FEATURES.map((f, i) => (
            <section
              key={f.id}
              id={f.id}
              className="af-cx-feature"
              data-flip={i % 2 === 1 ? 'true' : undefined}
              aria-labelledby={`${f.id}-h`}
            >
              <div className="af-cx-feature-copy">
                <span className="af-cx-feature-eyebrow af-num">{f.eyebrow}</span>
                <h2 id={`${f.id}-h`} className="af-lp-h2 af-cx-feature-h2">
                  {f.title}
                </h2>
                <p className="af-cx-feature-body">{fill(f.body)}</p>
                <ul className="af-cx-points">
                  {f.points.map((pt) => (
                    <li key={pt}>
                      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
                        <path d="M4 9.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <CommissionerScreenshot src={f.image} alt={f.imageAlt} />
            </section>
          ))}
        </div>

        {/* ── Roadmap — badged, never presented as live ────────────────── */}
        <section className="af-cx-roadmap" aria-labelledby="roadmap-h">
          <div className="af-cx-roadmap-head">
            <h2 id="roadmap-h" className="af-lp-h2">
              {COMMISSIONERS_ROADMAP.h2}
            </h2>
            <span className="af-cx-soon-badge af-num">{COMMISSIONERS_ROADMAP.badge}</span>
          </div>
          <p className="af-cx-roadmap-note">{COMMISSIONERS_ROADMAP.note}</p>
          <ul className="af-cx-roadmap-grid">
            {COMMISSIONERS_ROADMAP.items.map((r) => (
              <li key={r.title} className="af-cx-roadmap-card">
                <span className="af-cx-soon-badge af-num">{COMMISSIONERS_ROADMAP.badge}</span>
                <h3 className="af-cx-roadmap-title">{r.title}</h3>
                <p className="af-cx-roadmap-body">{r.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section id="how" className="af-cx-how" aria-labelledby="how-h">
          <h2 id="how-h" className="af-lp-h2">
            {COMMISSIONERS_HOW.h2}
          </h2>
          <ol className="af-cx-steps">
            {COMMISSIONERS_HOW.steps.map((s) => (
              <li key={s.n} className="af-cx-step">
                <span className="af-cx-step-n af-num" aria-hidden="true">
                  {s.n}
                </span>
                <h3 className="af-cx-step-title">{s.title}</h3>
                <p className="af-cx-step-body">{fill(s.body)}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Bottom CTA ───────────────────────────────────────────────── */}
        <section className="af-cx-bottom" aria-labelledby="bottom-h">
          <h2 id="bottom-h" className="af-lp-h2 af-cx-bottom-h2">
            {COMMISSIONERS_BOTTOM.h2}
          </h2>
          <p className="af-cx-bottom-body">{COMMISSIONERS_BOTTOM.body}</p>
          <div className="af-lp-hero-ctas af-cx-bottom-ctas">
            <CommissionersCtaLink
              href={importHref}
              cta="import"
              placement="bottom"
              className="af-btn af-lp-cta-lg"
              testId="commissioners-bottom-primary"
            >
              {h.ctaPrimary}
            </CommissionersCtaLink>
            <CommissionersCtaLink
              href="/pricing"
              cta="pricing"
              placement="bottom"
              className="af-btn af-btn--ghost af-lp-cta-lg"
            >
              {h.ctaSecondary}
            </CommissionersCtaLink>
          </div>
        </section>
      </main>

      {/* ── Footer — the landing page's ─────────────────────────────────── */}
      <footer className="af-lp-footer">
        <div className="af-lp-footer-top">
          <Link href="/" className="af-lp-brand">
            <Shield />
            <span className="af-lp-wordmark">AllFantasy</span>
          </Link>
          <nav className="af-lp-footer-links" aria-label="Footer">
            <Link href="/">Home</Link>
            <Link href="/commissioners" aria-current="page">
              For commissioners
            </Link>
            <Link href="/pricing" data-hide-in-ios-app>
              Pricing
            </Link>
            <Link href="/no-gambling-policy">No gambling policy</Link>
            <Link href="/privacy">{footerCopy.footer.privacy}</Link>
            <Link href="/terms">{footerCopy.footer.terms}</Link>
          </nav>
        </div>
        <div className="af-lp-footer-legal">
          <span>© 2026 AllFantasy.ai</span>
        </div>
        <p className="af-lp-footer-compliance">{footerCopy.footer.compliance}</p>
      </footer>
    </div>
  )
}

export default CommissionersV4
