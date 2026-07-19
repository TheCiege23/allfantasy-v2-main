'use client'

/**
 * AllFantasy V3 landing page — the flagship marketing homepage at `/`.
 *
 * Replaces the Nocturne landing (`components/landing/nocturne/`), which stays on
 * disk for a one-line rollback in `app/page.tsx`.
 *
 * Copy lives in `./copy.ts` (prices sourced from the monetization catalog, never
 * hardcoded). Styles are scoped under `.afv3` in `./v3.css`. The import wizard
 * and the hero visual are separate modules.
 *
 * COPY RULE: the assistant is "Chimmy" and the systems are "intelligence" —
 * never bare "AI", and never the internal plan key "war_room" (it is "Legacy").
 */

import type { Session } from 'next-auth'
import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  X,
  Menu,
  ChevronDown,
  Link2,
  Brain,
  Lightbulb,
  Target,
  ShieldCheck,
  Users,
  ArrowLeftRight,
  TrendingUp,
  ClipboardList,
  Sparkles,
  ListOrdered,
  Trophy,
  Lock,
  Zap,
  PlayCircle,
  type LucideIcon,
} from 'lucide-react'
import { loginUrlWithIntent, signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { trackLandingCtaClick } from '@/lib/landing-analytics'
import { V3 } from './copy'
import { V3DashboardMock } from './V3DashboardMock'
import { V3ImportWizard } from './V3ImportWizard'
import './v3.css'

type LandingV3Props = {
  /** Accepted for interface parity with the previous landing; unused (page redirects authed users). */
  initialSession?: Session | null
}

const OS_ICONS: Record<string, LucideIcon> = {
  target: Target,
  shield: ShieldCheck,
  users: Users,
  swap: ArrowLeftRight,
  trending: TrendingUp,
  clipboard: ClipboardList,
  sparkles: Sparkles,
  list: ListOrdered,
  trophy: Trophy,
}
const TRUST_ICONS: Record<string, LucideIcon> = {
  link: Link2,
  brain: Brain,
  lightbulb: Lightbulb,
  arrow: ArrowUpRight,
}
const BADGE_ICONS: Record<string, LucideIcon> = {
  lock: Lock,
  shield: ShieldCheck,
  users: Users,
  zap: Zap,
}

export default function LandingV3(_props: LandingV3Props) {
  const signupHref = signupUrlWithIntent('/dashboard')
  const loginHref = loginUrlWithIntent('/dashboard')

  return (
    <main className="afv3" style={{ minHeight: '100vh', overflowX: 'clip' }}>
      <Nav signupHref={signupHref} loginHref={loginHref} />

      {/* ═══ HERO ═══ */}
      <div style={{ position: 'relative' }}>
        <div className="glow" />
        <div className="wrap hero-grid">
          <div>
            <span className="pill pill-purple" style={{ marginBottom: 20 }}>
              <Sparkles size={12} />
              {V3.hero.badge}
            </span>
            <h1 className="hero-title" data-testid="landing-hero-headline">
              {V3.hero.titleTop}
              <br />
              <span className="accent">{V3.hero.titleAccent}</span>
            </h1>
            <p className="hero-sub">{V3.hero.sub}</p>

            <div className="hero-badges">
              {V3.hero.badges.map((b) => (
                <span key={b} className="hero-badge">
                  <Check size={15} style={{ color: 'var(--good)', flex: 'none' }} />
                  {b}
                </span>
              ))}
            </div>

            <div className="hero-cta">
              <a
                href="#import"
                className="btn btn-primary"
                onClick={() => track(V3.hero.primary, '#import', 'primary', 'hero')}
              >
                {V3.hero.primary} <ArrowRight size={17} />
              </a>
              <Link
                href="/demo-dashboard"
                className="btn btn-secondary"
                onClick={() => track(V3.hero.secondary, '/demo-dashboard', 'secondary', 'hero')}
              >
                <PlayCircle size={17} /> {V3.hero.secondary}
              </Link>
              <a
                href="#import"
                className="btn btn-ghost"
                onClick={() => track(V3.hero.tertiary, '#import', 'secondary', 'hero')}
              >
                {V3.hero.tertiary}
              </a>
            </div>
            <p className="hero-fine">{V3.hero.fine}</p>
          </div>

          <div style={{ position: 'relative', minWidth: 0 }}>
            <V3DashboardMock />
            <p style={{ fontSize: 11.5, color: 'var(--text-4)', marginTop: 18, textAlign: 'center' }}>
              Sample data shown for illustration.
            </p>
          </div>
        </div>
      </div>

      {/* ═══ TRANSPARENCY ═══ */}
      <section
        className="section"
        style={{ borderTop: '1px solid var(--line)', background: 'linear-gradient(180deg,var(--bg-deep),var(--bg))' }}
      >
        <div className="wrap">
          <div className="trust-grid" style={{ marginBottom: 56 }}>
            <div>
              <span className="eyebrow">{V3.trust.eyebrow}</span>
              <h2 className="section-title" style={{ fontSize: 34 }}>{V3.trust.title}</h2>
              <p className="section-sub">{V3.trust.body}</p>
            </div>
            <div className="trust-flow">
              {V3.trust.flow.map((s) => {
                const Icon = TRUST_ICONS[s.icon] ?? Link2
                return (
                  <div key={s.title} className="trust-step">
                    <div className="trust-icon"><Icon size={22} /></div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{s.title}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>{s.body}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="card" style={{ padding: 32 }}>
            <div className="trust-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 40, alignItems: 'start' }}>
              <div>
                <h3 style={{ fontSize: 17, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 9 }}>
                  <X size={17} style={{ color: 'var(--bad)' }} />
                  {V3.trust.cannotTitle}
                </h3>
                <div className="cannot-grid" style={{ gridTemplateColumns: '1fr' }}>
                  {V3.trust.cannot.map((c) => (
                    <div key={c} className="cannot-item">
                      <X size={15} style={{ color: 'var(--bad)', flex: 'none' }} />
                      {c}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 style={{ fontSize: 17, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 9 }}>
                  <Check size={17} style={{ color: 'var(--good)' }} />
                  {V3.trust.canTitle}
                </h3>
                <div className="cannot-grid" style={{ gridTemplateColumns: '1fr' }}>
                  {V3.trust.can.map((c) => (
                    <div key={c} className="cannot-item">
                      <Check size={15} style={{ color: 'var(--good)', flex: 'none' }} />
                      {c}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ IMPORT ═══ */}
      <section id="import" className="section" style={{ scrollMarginTop: 80, position: 'relative' }}>
        <div className="glow" />
        <div className="wrap" style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ marginBottom: 36 }}>
            <span className="eyebrow">{V3.platforms.eyebrow}</span>
            <h2 className="section-title">{V3.platforms.title}</h2>
            <p className="section-sub">{V3.platforms.sub}</p>
          </div>
          <V3ImportWizard />
        </div>
      </section>

      {/* ═══ FANTASY OS ═══ */}
      <section className="section" style={{ borderTop: '1px solid var(--line)', background: 'var(--bg-deep)' }}>
        <div className="wrap">
          <div className="center" style={{ marginBottom: 40 }}>
            <span className="eyebrow">{V3.os.eyebrow}</span>
            <h2 className="section-title">{V3.os.title}</h2>
            <p className="section-sub">{V3.os.sub}</p>
          </div>
          <div className="os-grid">
            {V3.os.cards.map((c) => {
              const Icon = OS_ICONS[c.icon] ?? Sparkles
              return (
                <Link key={c.name} href={c.href} className="card card-hover os-card">
                  <div className="os-icon"><Icon size={20} /></div>
                  <div className="os-name">{c.name}</div>
                  <div className="os-desc">{c.desc}</div>
                  <div className="os-example">{c.example}</div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* ═══ CHIMMY ═══ */}
      <section className="section">
        <div className="wrap">
          <div className="trust-grid">
            <div>
              <span className="eyebrow">{V3.chimmy.eyebrow}</span>
              <h2 className="section-title" style={{ fontSize: 34 }}>{V3.chimmy.title}</h2>
              <p className="section-sub" style={{ marginBottom: 24 }}>{V3.chimmy.sub}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 26 }}>
                {V3.chimmy.knows.map((k) => (
                  <span key={k} className="pill" style={{ fontSize: 12 }}>{k}</span>
                ))}
              </div>
              <Link href="/chimmy" className="btn btn-primary">
                {V3.chimmy.cta} <ArrowRight size={16} />
              </Link>
            </div>
            <div className="card" style={{ padding: 26 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {V3.chimmy.examples.map((q, i) => (
                  <div
                    key={q}
                    style={{
                      padding: '13px 16px',
                      borderRadius: 'var(--r-md)',
                      border: '1px solid var(--line)',
                      background: i === 0 ? 'var(--purple-dim)' : 'rgba(255,255,255,.025)',
                      fontSize: 14.5,
                      color: i === 0 ? 'var(--purple-bright)' : 'var(--text-2)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <Sparkles size={15} style={{ flex: 'none', opacity: 0.7 }} />
                    {q}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ FREE / NO ACCOUNT ═══ */}
      <section className="section-sm" style={{ borderTop: '1px solid var(--line)', background: 'var(--bg-deep)' }}>
        <div className="wrap">
          <div className="trust-grid">
            <div>
              <span className="eyebrow">{V3.free.eyebrow}</span>
              <h2 className="section-title" style={{ fontSize: 32 }}>{V3.free.title}</h2>
              <p className="section-sub" style={{ marginBottom: 22 }}>{V3.free.sub}</p>
              <a href="#import" className="btn btn-primary">
                {V3.free.cta} <ArrowRight size={16} />
              </a>
            </div>
            <div>
              <div className="cannot-grid" style={{ marginBottom: 20 }}>
                {V3.free.open.map((f) => (
                  <div key={f} className="cannot-item">
                    <Check size={15} style={{ color: 'var(--good)', flex: 'none' }} />
                    {f}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 13.5, color: 'var(--text-4)', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                <Lock size={15} style={{ flex: 'none', marginTop: 2 }} />
                {V3.free.gated}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ INTEGRATIONS ═══ */}
      <section className="section">
        <div className="wrap">
          <div style={{ marginBottom: 32 }}>
            <span className="eyebrow">{V3.integrations.eyebrow}</span>
            <h2 className="section-title">{V3.integrations.title}</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16 }}>
            {[
              { data: V3.integrations.discord, mark: <DiscordMark />, tint: '#5865F2' },
              { data: V3.integrations.spotify, mark: <SpotifyMark />, tint: '#1DB954' },
            ].map(({ data, mark, tint }) => (
              <div key={data.name} className="card card-hover">
                <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 14 }}>
                  <span
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 'var(--r-md)',
                      display: 'grid',
                      placeItems: 'center',
                      background: `${tint}22`,
                      border: `1px solid ${tint}55`,
                      color: tint,
                      flex: 'none',
                    }}
                  >
                    {mark}
                  </span>
                  <h3 style={{ fontSize: 19 }}>{data.name}</h3>
                </div>
                <p style={{ fontSize: 14.5, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 16 }}>{data.body}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 20 }}>
                  {data.features.map((f) => (
                    <div key={f} style={{ display: 'flex', gap: 9, fontSize: 13.5, color: 'var(--text-2)' }}>
                      <Check size={15} style={{ color: tint, flex: 'none', marginTop: 2 }} />
                      {f}
                    </div>
                  ))}
                </div>
                <Link href={signupUrlWithIntent('/settings')} className="btn btn-secondary btn-sm">
                  {data.cta} <ArrowRight size={14} />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ PRICING ═══ */}
      <section className="section" style={{ borderTop: '1px solid var(--line)', background: 'var(--bg-deep)' }}>
        <div className="wrap">
          <div className="center" style={{ marginBottom: 40 }}>
            <span className="eyebrow">{V3.pricing.eyebrow}</span>
            <h2 className="section-title">{V3.pricing.title}</h2>
            <p className="section-sub">{V3.pricing.sub}</p>
          </div>
          <div className="price-grid">
            {V3.pricing.plans.map((plan) => {
              const href = plan.href ? signupUrlWithIntent(plan.href) : signupHref
              return (
                <div key={plan.name} className={`price-card${plan.featured ? ' is-featured' : ''}`}>
                  {plan.featured && (
                    <span className="pill pill-purple" style={{ alignSelf: 'flex-start', marginBottom: 10, fontSize: 10.5 }}>
                      <Sparkles size={11} />
                      Most popular
                    </span>
                  )}
                  <div className="price-name">{plan.name}</div>
                  <div className="price-amount num">{plan.price}</div>
                  <div className="price-period">{plan.period}</div>
                  <div className="price-features">
                    {plan.features.map((f) => (
                      <div key={f} className="price-feature">
                        <Check size={15} style={{ color: plan.featured ? 'var(--purple-bright)' : 'var(--good)', flex: 'none', marginTop: 1 }} />
                        {f}
                      </div>
                    ))}
                  </div>
                  <Link
                    href={href}
                    className={`btn btn-block ${plan.featured ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => track(plan.cta, href, plan.featured ? 'primary' : 'secondary', `pricing-${plan.name.toLowerCase()}`)}
                  >
                    {plan.cta}
                  </Link>
                </div>
              )
            })}
          </div>
          <div className="center" style={{ marginTop: 26 }}>
            <Link href="/pricing" className="btn btn-ghost">
              {V3.pricing.compareCta} <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ SPORTS ═══ */}
      <section className="section-sm">
        <div className="wrap">
          <div style={{ marginBottom: 28 }}>
            <span className="eyebrow">{V3.sports.eyebrow}</span>
            <h2 className="section-title" style={{ fontSize: 30 }}>{V3.sports.title}</h2>
          </div>
          <div className="sport-grid">
            {V3.sports.items.map((s) => (
              <div key={s.name} className="sport-card">
                <span className="sport-emoji" aria-hidden="true">{s.emoji}</span>
                <span className="sport-name">{s.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section style={{ position: 'relative', borderTop: '1px solid var(--line)' }}>
        <div className="glow" />
        <div className="wrap center" style={{ position: 'relative', zIndex: 2, padding: '76px 0 68px' }}>
          <Image
            src="/brand/af-shield-transparent.png"
            alt=""
            width={584}
            height={625}
            style={{ height: 62, width: 'auto', margin: '0 auto 24px' }}
          />
          <h2 className="section-title" style={{ fontSize: 40, maxWidth: '16ch', margin: '0 auto 14px' }}>
            {V3.finalCta.title}
          </h2>
          <p className="section-sub" style={{ marginBottom: 28 }}>{V3.finalCta.body}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#import" className="btn btn-primary">
              {V3.finalCta.primary} <ArrowRight size={17} />
            </a>
            <Link href="/create-league" className="btn btn-secondary">
              {V3.finalCta.secondary}
            </Link>
          </div>
        </div>
      </section>

      <Footer loginHref={loginHref} />
    </main>
  )
}

// ── Nav ──────────────────────────────────────────────────────────────────────

function Nav({ signupHref, loginHref }: { signupHref: string; loginHref: string }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const navRef = useRef<HTMLDivElement | null>(null)

  const close = useCallback(() => setOpenMenu(null), [])

  // Close the dropdown on outside click and on Escape.
  useEffect(() => {
    if (!openMenu) return
    function onPointer(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) close()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenu, close])

  return (
    <div className="nav" ref={navRef}>
      <div className="wrap">
        <div className="nav-inner">
          <Link
            href="/"
            aria-label={V3.nav.ariaHome}
            data-testid="landing-logo-link"
            style={{ display: 'flex', alignItems: 'center', flex: 'none' }}
          >
            <Image
              src="/brand/allfantasy-wordmark-transparent.png"
              alt="AllFantasy"
              width={1198}
              height={306}
              priority
              style={{ height: 30, width: 'auto' }}
            />
          </Link>

          <nav className="nav-links" aria-label={V3.nav.ariaPrimary}>
            {V3.nav.groups.map((g) => (
              <div key={g.label} className="nav-item">
                <button
                  type="button"
                  className="nav-link"
                  aria-expanded={openMenu === g.label}
                  aria-haspopup="true"
                  onClick={() => setOpenMenu(openMenu === g.label ? null : g.label)}
                >
                  {g.label}
                  <ChevronDown size={14} style={{ opacity: 0.6 }} />
                </button>
                {openMenu === g.label && (
                  <div className="nav-menu">
                    {g.items.map((it) => (
                      <Link key={it.href} href={it.href} onClick={close}>
                        {it.label}
                        <span className="nav-menu-desc">{it.desc}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <Link href={V3.nav.pricing.href} className="nav-link">{V3.nav.pricing.label}</Link>
          </nav>

          <button
            type="button"
            className="btn btn-ghost nav-burger"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? V3.nav.closeMenu : V3.nav.openMenu}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <div className="nav-cta">
            <Link
              href={loginHref}
              className="btn btn-ghost"
              data-testid="landing-open-app-button"
              onClick={() => track(V3.nav.signIn, loginHref, 'secondary', 'nav')}
            >
              {V3.nav.signIn}
            </Link>
            <Link
              href={signupHref}
              className="btn btn-primary btn-sm"
              data-testid="landing-sign-up-button"
              onClick={() => track(V3.nav.getStarted, signupHref, 'primary', 'nav')}
            >
              {V3.nav.getStarted}
            </Link>
          </div>
        </div>

        {mobileOpen && (
          <div className="nav-mobile">
            {V3.nav.groups.map((g) => (
              <div key={g.label}>
                <div className="nav-mobile-group">{g.label}</div>
                {g.items.map((it) => (
                  <Link key={it.href} href={it.href} onClick={() => setMobileOpen(false)}>
                    {it.label}
                  </Link>
                ))}
              </div>
            ))}
            <div className="nav-mobile-group">Pricing</div>
            <Link href={V3.nav.pricing.href} onClick={() => setMobileOpen(false)}>
              {V3.nav.pricing.label}
            </Link>

            {/* The nav bar's "Log In" is hidden under 620px, so it must live here. */}
            <div className="nav-mobile-group">Account</div>
            <Link href={loginHref} onClick={() => setMobileOpen(false)}>
              {V3.nav.signIn}
            </Link>
            <Link
              href={signupHref}
              className="btn btn-primary"
              style={{ marginTop: 10 }}
              onClick={() => setMobileOpen(false)}
            >
              {V3.nav.getStarted}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Footer ───────────────────────────────────────────────────────────────────

function Footer({ loginHref }: { loginHref: string }) {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <Image
              src="/brand/allfantasy-wordmark-transparent.png"
              alt="AllFantasy"
              width={1198}
              height={306}
              style={{ height: 26, width: 'auto', opacity: 0.9, marginBottom: 16 }}
            />
            <p style={{ fontSize: 13.5, color: 'var(--text-3)', lineHeight: 1.6, maxWidth: '38ch' }}>
              {V3.footer.tagline}
            </p>
            <div className="footer-social">
              <Link href="/contact" aria-label="Contact us"><ArrowUpRight size={16} /></Link>
              <Link href={loginHref} aria-label="Sign in"><Lock size={15} /></Link>
            </div>
          </div>

          {V3.footer.columns.map((col) => (
            <div key={col.title}>
              <div className="footer-col-title">{col.title}</div>
              <div className="footer-links">
                {col.links.map((l) => (
                  <Link key={l.href} href={l.href}>{l.label}</Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="trust-badges">
          {V3.footer.badges.map((b) => {
            const Icon = BADGE_ICONS[b.icon] ?? ShieldCheck
            return (
              <div key={b.title} className="trust-badge">
                <Icon size={17} style={{ color: 'var(--purple-bright)', flex: 'none' }} />
                {b.title}
              </div>
            )
          })}
        </div>

        <div className="footer-bottom">
          <span>{V3.footer.copyright}</span>
          <span style={{ maxWidth: '70ch', lineHeight: 1.5 }}>{V3.footer.geoNote}</span>
        </div>
      </div>
    </footer>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function track(label: string, destination: string, type: 'primary' | 'secondary', source: string) {
  trackLandingCtaClick({ cta_label: label, cta_destination: destination, cta_type: type, source })
}

/* Brand marks: lucide has no brand icons and no logo files exist in `public/`,
   so these two are inlined. */
function DiscordMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  )
}

function SpotifyMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0Zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02Zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2Zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.56.3Z" />
    </svg>
  )
}
