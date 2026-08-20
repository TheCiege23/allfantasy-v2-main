'use client'

/**
 * Nocturne landing page (direction "1a") — the marketing single-scroll page for
 * logged-out visitors at `/`. Faithful port of the design handoff `reference.html`
 * into the app stack (Next.js / React / lucide-react), styled via the scoped
 * `./nocturne.css` token system. Copy lives in `./copy.ts`.
 *
 * Rollout: this replaces the legacy scrollytelling `LandingPageClient` at `/`.
 * That component + its `journey/` sections stay on disk as a one-line rollback.
 */

import type { Session } from 'next-auth'
import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  PlayCircle,
  LayoutGrid,
  AlertCircle,
  Bell,
  ArrowLeftRight,
  Check,
  Sparkles,
  Lock,
  Link2,
  Eye,
  MousePointerClick,
  Shuffle,
  ShieldCheck,
  Dices,
  RadioTower,
  type LucideIcon,
} from 'lucide-react'
import { loginUrlWithIntent, signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { trackLandingCtaClick } from '@/lib/landing-analytics'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { getNocturneCopy } from './copy.i18n'
import { NocturneImport } from './NocturneImport'
import './nocturne.css'

type LandingNocturneProps = {
  /** Accepted for interface parity with the old landing; unused (page redirects authed users). */
  initialSession?: Session | null
}

const ROW_TAG_ICONS: Record<string, LucideIcon> = {
  alert: AlertCircle,
  bell: Bell,
  trade: ArrowLeftRight,
  check: Check,
}
const HOW_ICONS: Record<string, LucideIcon> = {
  link: Link2,
  eye: Eye,
  cursor: MousePointerClick,
}
const COMM_ICONS: Record<string, LucideIcon> = {
  shuffle: Shuffle,
  shield: ShieldCheck,
  dice: Dices,
  broadcast: RadioTower,
}

export default function LandingNocturne(_props: LandingNocturneProps) {
  // Copy follows the app-wide language selector (falls back to English).
  const { language } = useOptionalLanguage()
  const C = getNocturneCopy(language)

  // ── Destinations ──────────────────────────────────────────────────────────
  const signupHref = signupUrlWithIntent('/dashboard')
  const loginHref = loginUrlWithIntent('/dashboard')
  // Paid CTAs route through signup → the matching MonetizationPurchaseSurface,
  // since Stripe checkout requires an authenticated session. Each pricing tier's
  // destination is derived from its `plan` key below (see the pricing grid).
  // "Bring your league" / "Start a league" → create/import-league flow.
  const createLeagueHref = signupUrlWithIntent('/create-league')

  return (
    // overflow-x: clip (not hidden) prevents horizontal overflow WITHOUT making
    // <main> a scroll container — which would break the sticky nav's pinning.
    <main className="nocturne" style={{ minHeight: '100vh', overflowX: 'clip' }}>
      {/* ═══ NAV ═══ */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          borderBottom: '1px solid color-mix(in srgb, var(--color-text) 7%, transparent)',
          background: 'var(--color-nav-bg)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
        }}
      >
        <div
          className="afwrap"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 66,
            gap: 20,
          }}
        >
          <Link href="/" aria-label={C.nav.ariaHome} style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {/* Plain <img> (not next/image) so this module SSRs cleanly — see the
                header note in app/page.tsx on the Next 14.2 next/image SSR bug. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/allfantasy-wordmark-transparent.png"
              alt="AllFantasy"
              width={1198}
              height={306}
              className="n-nav-logo"
              style={{ width: 'auto' }}
            />
          </Link>

          <nav className="nnav-links" aria-label={C.nav.ariaPrimaryNav}>
            <a href="#features">{C.nav.features}</a>
            <a href="#how-it-works">{C.nav.howItWorks}</a>
            <a href="#for-commissioners" style={{ color: 'var(--color-accent-400)' }}>
              {C.nav.forCommissioners}
            </a>
          </nav>

          <div className="nnav-actions" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Link
              href={loginHref}
              className="nnav-signin"
              data-testid="nocturne-nav-sign-in"
              onClick={() => track(C.nav.signIn, loginHref, 'secondary', 'nav')}
            >
              {C.nav.signIn}
            </Link>
            <Link
              href={signupHref}
              className="btn btn-primary nnav-cta"
              data-testid="nocturne-nav-sign-up"
              onClick={() => track(C.nav.getStarted, signupHref, 'primary', 'nav')}
            >
              <span className="n-cta-full">{C.nav.getStarted}</span>
              <span className="n-cta-short">{C.nav.getStartedShort}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* ═══ HERO ═══ */}
      <div style={{ position: 'relative' }}>
        <div className="afglow" />
        <div className="afgrid-bg" />
        <div
          className="afwrap nocturne-hero-grid"
          style={{ position: 'relative', zIndex: 2, paddingTop: 76, paddingBottom: 80 }}
        >
          <div>
            <span className="afchip" style={{ marginBottom: 24, fontSize: 12, letterSpacing: '.02em' }}>
              <span className="dot" />
              {C.hero.badge}
            </span>
            <h1
              className="n-hero-title"
              style={{ fontSize: 64, lineHeight: 1.03, letterSpacing: '-0.03em', margin: '0 0 24px' }}
            >
              {C.hero.titleTop}
              <br />
              <span style={{ color: 'var(--color-accent-400)' }}>{C.hero.titleAccent}</span>
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--color-neutral-400)', maxWidth: '34em', margin: '0 0 32px' }}>
              {C.hero.body}
            </p>
            <div className="n-hero-cta" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
              <Link
                href={signupHref}
                className="btn btn-primary"
                style={{ padding: '13px 26px', fontSize: 16 }}
                data-testid="nocturne-hero-primary"
                onClick={() => track(C.hero.primary, signupHref, 'primary', 'hero')}
              >
                {C.hero.primary} <ArrowRight size={17} style={{ marginLeft: 2 }} />
              </Link>
              <a href="#how-it-works" className="btn btn-secondary" style={{ padding: '13px 26px', fontSize: 16 }}>
                <PlayCircle size={18} /> {C.hero.secondary}
              </a>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--color-neutral-600)', margin: 0 }}>{C.hero.finePrint}</p>
            {/* No-signup preview mini-bar (real Sleeper import; others → signup) */}
            <NocturneImport variant="mini" />
          </div>

          {/* Dashboard mockup */}
          <div
            style={{
              borderRadius: 'var(--radius-lg)',
              background: 'linear-gradient(180deg,var(--color-surface),var(--color-bg))',
              border: '1px solid var(--color-neutral-800)',
              boxShadow: '0 30px 70px rgba(0,0,0,.55)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 18px',
                borderBottom: '1px solid color-mix(in srgb, var(--color-text) 6%, transparent)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <LayoutGrid size={18} style={{ color: 'var(--color-accent-400)' }} />
                <span style={{ fontWeight: 600, fontSize: 14.5 }}>{C.hero.mockup.title}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-neutral-600)' }}>
                <span className="aflive" />
                {C.hero.mockup.clock}
              </div>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
              {C.hero.mockup.rows.map((row) => {
                const TagIcon = ROW_TAG_ICONS[row.tagIcon] ?? Check
                return (
                  <div className="afrow" key={row.name}>
                    <span className="afsrc" style={{ background: row.color }}>
                      {row.initial}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{row.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>{row.sub}</div>
                    </div>
                    <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, color: 'var(--color-neutral-300)', textAlign: 'right' }}>
                      {row.score} <span style={{ color: 'var(--color-neutral-700)' }}>{row.opp}</span>
                    </div>
                    <span className={`tag ${row.tagKind === 'accent' ? 'tag-accent' : 'tag-neutral'}`}>
                      <TagIcon size={13} />
                      {row.tag}
                    </span>
                  </div>
                )
              })}
              {/* Locked / entitlement-gated row */}
              <div
                className="afrow"
                style={{
                  background: 'color-mix(in srgb, var(--color-accent-800) 28%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent) 28%, transparent)',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="afsrc" style={{ background: 'linear-gradient(180deg,var(--color-accent-700),var(--color-accent-800))' }}>
                    <Sparkles size={14} />
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{C.hero.mockup.lockedTitle}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-accent-2-500)' }}>{C.hero.mockup.lockedSub}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="afblur" style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-accent-300)' }}>
                    {C.hero.mockup.lockedValue}
                  </span>
                  <span className="tag" style={{ background: 'var(--color-accent)', color: 'var(--color-neutral-100)' }}>
                    <Lock size={12} />
                    {C.hero.mockup.lockedTag}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ IMPORT / PREVIEW ═══ */}
      <div className="afwrap" style={{ paddingTop: 8, paddingBottom: 72 }}>
        <div className="n-import-grid">
          <div>
            <span className="kick">{C.importFlow.kicker}</span>
            <h2 style={{ fontSize: 34, lineHeight: 1.15, margin: '0 0 14px', maxWidth: '18ch' }}>{C.importFlow.title}</h2>
            <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--color-neutral-400)', maxWidth: '48ch', margin: '0 0 26px' }}>
              {C.importFlow.body}
            </p>
            <NocturneImport variant="full" />
          </div>
          {/* Decorative teaser — blurred sample rows behind an eye icon (not real data) */}
          <div className="n-import-teaser" aria-hidden="true">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, filter: 'blur(3px)', opacity: 0.6, pointerEvents: 'none' }}>
              {[['Your Team', '92.4'], ['Their Team', '81.0'], ['Your Team', '75.6']].map(([name, score], i) => (
                <div className="afrow" key={i}>
                  <span className="afsrc" style={{ background: 'var(--color-neutral-800)' }}>?</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--color-neutral-600)' }}>League · Format</div>
                  </div>
                  <span style={{ fontSize: 13 }}>{score}</span>
                </div>
              ))}
            </div>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--color-surface) 40%, transparent)' }}>
              <div style={{ textAlign: 'center', padding: '0 20px' }}>
                <Eye size={26} style={{ color: 'var(--color-accent-400)', margin: '0 auto' }} />
                <div style={{ fontSize: 13, color: 'var(--color-neutral-300)', marginTop: 8, fontWeight: 600 }}>{C.importFlow.teaserCaption}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ STAT BAND ═══ */}
      <div
        style={{
          position: 'relative',
          background:
            'radial-gradient(900px 420px at 85% -30%,color-mix(in srgb, var(--color-section-glow) 70%, transparent),transparent 64%),var(--color-section)',
          borderTop: '1px solid color-mix(in srgb, var(--color-text) 6%, transparent)',
          borderBottom: '1px solid color-mix(in srgb, var(--color-text) 6%, transparent)',
        }}
      >
        <div className="afwrap" style={{ paddingTop: 44, paddingBottom: 40 }}>
          <div className="nocturne-stat-grid">
            {C.stats.items.map((stat) => (
              <div key={stat.label}>
                <div style={{ fontSize: 44, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 12.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'color-mix(in srgb, var(--color-text) 66%, transparent)', marginTop: 12 }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 34 }}>
            {C.stats.sports.map((sport, i) => (
              <span
                key={sport}
                className="afchip"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-text) 16%, transparent)',
                  background: 'color-mix(in srgb, var(--color-text) 6%, transparent)',
                  color: 'var(--color-neutral-200)',
                }}
              >
                {i === 0 && <span className="dot" style={{ background: 'var(--color-accent-400)' }} />}
                {sport}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ FEATURES ═══ */}
      <div id="features" className="afwrap" style={{ paddingTop: 72, paddingBottom: 20, scrollMarginTop: 80 }}>
        <span className="kick">{C.features.kicker}</span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {C.features.rows.map((row, i) => (
            <div key={row.index}>
              {i > 0 && <hr className="hr" />}
              <div className="nocturne-feature-row">
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-accent)', fontVariantNumeric: 'tabular-nums' }}>
                  {row.index}
                </div>
                {/* h2 (not h3) keeps the document outline monotonic after the hero h1;
                    size is set inline so the visual is unchanged. */}
                <h2 style={{ fontSize: 25, lineHeight: 1.15 }}>
                  {row.title[0]}
                  <br />
                  {row.title[1]}
                </h2>
                <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--color-neutral-400)', maxWidth: '52ch', margin: 0 }}>
                  {row.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ HOW IT WORKS ═══ */}
      <div id="how-it-works" className="afwrap" style={{ paddingTop: 56, paddingBottom: 72, scrollMarginTop: 80 }}>
        <span className="kick">{C.howItWorks.kicker}</span>
        <div className="nocturne-how-grid" style={{ marginTop: 6 }}>
          {C.howItWorks.cards.map((card) => {
            const Icon = HOW_ICONS[card.icon] ?? Link2
            return (
              <div
                key={card.title}
                style={{
                  padding: '26px 24px',
                  border: '1px solid var(--color-neutral-800)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--color-surface)',
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', display: 'grid', placeItems: 'center', background: 'var(--color-accent-900)', color: 'var(--color-accent-400)', marginBottom: 20 }}>
                  <Icon size={22} />
                </div>
                <h3 style={{ fontSize: 19, margin: '0 0 9px' }}>{card.title}</h3>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--color-neutral-500)', margin: 0 }}>{card.body}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══ COMMISSIONER BAND ═══ */}
      <div
        id="for-commissioners"
        style={{
          position: 'relative',
          background:
            'radial-gradient(760px 380px at 15% -20%,color-mix(in srgb, var(--color-section-glow) 55%, transparent),transparent 62%),var(--color-bg)',
          borderTop: '1px solid color-mix(in srgb, var(--color-text) 6%, transparent)',
          scrollMarginTop: 80,
        }}
      >
        <div className="afwrap nocturne-comm-grid" style={{ paddingTop: 66, paddingBottom: 66 }}>
          <div>
            <span className="kick">{C.commissioner.kicker}</span>
            <h2 style={{ fontSize: 38, lineHeight: 1.08, margin: '0 0 18px' }}>
              {C.commissioner.titleTop}
              <br />
              {C.commissioner.titleBottom}
            </h2>
            <p style={{ fontSize: 16.5, lineHeight: 1.6, color: 'var(--color-neutral-400)', maxWidth: '44ch', margin: '0 0 26px' }}>
              {C.commissioner.bodyLead}
              <em style={{ fontStyle: 'italic', color: 'var(--color-accent-300)' }}>{C.commissioner.bodyEm}</em>
              {C.commissioner.bodyTail}
            </p>
            <Link
              href={createLeagueHref}
              className="btn btn-primary"
              style={{ padding: '13px 26px', fontSize: 16 }}
              data-testid="nocturne-commissioner-cta"
              onClick={() => track(C.commissioner.cta, createLeagueHref, 'primary', 'commissioner')}
            >
              {C.commissioner.cta} <ArrowRight size={17} style={{ marginLeft: 2 }} />
            </Link>
          </div>
          <div className="nocturne-comm-cards">
            {C.commissioner.cards.map((card) => {
              const Icon = COMM_ICONS[card.icon] ?? Shuffle
              return (
                <div
                  key={card.title}
                  style={{ padding: 18, border: '1px solid var(--color-neutral-800)', borderRadius: 'var(--radius-lg)', background: 'var(--color-surface)' }}
                >
                  <Icon size={20} style={{ color: 'var(--color-accent-400)' }} />
                  <div style={{ fontWeight: 600, fontSize: 14.5, margin: '11px 0 5px' }}>{card.title}</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-neutral-600)' }}>{card.body}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ═══ PRICING ═══ */}
      <div className="afwrap" style={{ paddingTop: 72, paddingBottom: 24 }}>
        <span className="kick">{C.pricing.kicker}</span>
        <h2 style={{ fontSize: 32, lineHeight: 1.1, margin: '0 0 8px' }}>{C.pricing.title}</h2>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: 'var(--color-neutral-500)', maxWidth: '62ch', margin: '0 0 34px' }}>
          {C.pricing.body}
        </p>
        <div className="nocturne-price-grid">
          {C.pricing.tiers.map((tier) => {
            const href = tier.plan ? signupUrlWithIntent(`/upgrade?plan=${tier.plan}`) : signupHref
            const dimColor = tier.featured ? 'var(--color-accent-2-500)' : 'var(--color-neutral-600)'
            return (
              <div key={tier.key} className={`n-price-card${tier.featured ? ' is-featured' : ''}`}>
                {tier.badge ? (
                  <span
                    className="tag"
                    style={{ position: 'absolute', top: 16, right: 16, background: 'var(--color-accent)', color: 'var(--color-neutral-100)' }}
                  >
                    <Sparkles size={12} />
                    {tier.badge}
                  </span>
                ) : null}
                <div className="n-price-name">{tier.name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap', marginBottom: tier.priceYear ? 4 : 20 }}>
                  <span className="n-price-amt">{tier.price}</span>
                  <span style={{ fontSize: 13.5, color: dimColor }}>{tier.priceSuffix}</span>
                </div>
                {tier.priceYear ? (
                  <div style={{ fontSize: 12.5, color: dimColor, marginBottom: 16 }}>{tier.priceYear}</div>
                ) : null}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11, flex: 1, marginBottom: 8 }}>
                  {tier.features.map((f) => (
                    <PlanLine key={f.text} locked={f.locked ?? false} accent={tier.featured}>
                      {f.text}
                    </PlanLine>
                  ))}
                </div>
                <Link
                  href={href}
                  className={`btn ${tier.featured ? 'btn-primary' : 'btn-secondary'} btn-block`}
                  data-testid={`nocturne-plan-${tier.key}`}
                  onClick={() => track(tier.cta, href, tier.featured ? 'primary' : 'secondary', `pricing-${tier.key}`)}
                >
                  {tier.cta}
                </Link>
              </div>
            )
          })}
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-neutral-600)', margin: '22px 0 0', textAlign: 'center' }}>
          {C.pricing.footnote}
        </p>
      </div>

      {/* ═══ FINAL CTA ═══ */}
      <div style={{ position: 'relative', marginTop: 56 }}>
        <div className="afglow" />
        <div className="afwrap" style={{ position: 'relative', zIndex: 2, paddingTop: 64, paddingBottom: 40, textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/af-shield-transparent.png"
            alt=""
            width={584}
            height={625}
            style={{ height: 64, width: 'auto', margin: '0 auto 26px', opacity: 0.95 }}
          />
          <h2 style={{ fontSize: 42, lineHeight: 1.06, margin: '0 auto 16px', maxWidth: '16ch' }}>{C.finalCta.title}</h2>
          <p style={{ fontSize: 16.5, lineHeight: 1.6, color: 'var(--color-neutral-400)', maxWidth: '48ch', margin: '0 auto 30px' }}>
            {C.finalCta.body}
          </p>
          <div style={{ display: 'flex', gap: 13, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              href={signupHref}
              className="btn btn-primary"
              style={{ padding: '13px 26px', fontSize: 16 }}
              data-testid="nocturne-final-primary"
              onClick={() => track(C.finalCta.primary, signupHref, 'primary', 'final-cta')}
            >
              {C.finalCta.primary} <ArrowRight size={17} style={{ marginLeft: 2 }} />
            </Link>
            <Link
              href={createLeagueHref}
              className="btn btn-secondary"
              style={{ padding: '13px 26px', fontSize: 16 }}
              data-testid="nocturne-final-secondary"
              onClick={() => track(C.finalCta.secondary, createLeagueHref, 'secondary', 'final-cta')}
            >
              {C.finalCta.secondary}
            </Link>
          </div>
        </div>
      </div>

      {/* ═══ FOOTER ═══ */}
      <div style={{ borderTop: '1px solid color-mix(in srgb, var(--color-text) 7%, transparent)', marginTop: 40 }}>
        <div
          className="afwrap"
          style={{ paddingTop: 30, paddingBottom: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/allfantasy-wordmark-transparent.png"
              alt="AllFantasy"
              width={1198}
              height={306}
              style={{ height: 24, width: 'auto', opacity: 0.8 }}
            />
            <span style={{ fontSize: 13, color: 'var(--color-neutral-700)' }}>{C.footer.copyright}</span>
          </div>
          <nav aria-label={C.nav.ariaFooterNav} style={{ display: 'flex', gap: 22 }}>
            <Link href="/privacy" className="n-link" style={{ fontSize: 13 }}>{C.footer.privacy}</Link>
            <Link href="/terms" className="n-link" style={{ fontSize: 13 }}>{C.footer.terms}</Link>
            <Link href="/data-deletion" className="n-link" style={{ fontSize: 13 }}>{C.footer.dataDeletion}</Link>
            <Link href={loginHref} className="n-link" style={{ fontSize: 13 }}>{C.footer.signIn}</Link>
          </nav>
        </div>
        <div className="afwrap" style={{ paddingBottom: 34 }}>
          <p style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--color-neutral-700)', margin: 0, maxWidth: '80ch' }}>
            {C.footer.geoNote}
          </p>
        </div>
      </div>
    </main>
  )
}

// ── Local helpers ────────────────────────────────────────────────────────────

function track(
  label: string,
  destination: string,
  type: 'primary' | 'secondary',
  source: string,
) {
  trackLandingCtaClick({ cta_label: label, cta_destination: destination, cta_type: type, source })
}

function PlanLine({ children, locked = false, accent = false }: { children: ReactNode; locked?: boolean; accent?: boolean }) {
  const color = locked ? 'var(--color-neutral-600)' : accent ? 'var(--color-neutral-200)' : 'var(--color-neutral-300)'
  return (
    <div style={{ display: 'flex', gap: 11, fontSize: 14.5, color }}>
      {locked ? (
        <Lock size={17} style={{ color: 'var(--color-neutral-700)', flex: 'none', marginTop: 1 }} />
      ) : (
        <Check size={17} style={{ color: accent ? 'var(--color-accent-400)' : 'var(--color-check)', flex: 'none', marginTop: 1 }} />
      )}
      {children}
    </div>
  )
}
