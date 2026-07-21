'use client'

/**
 * Interactive 5-step league import wizard — the primary conversion surface.
 *
 * ── HONESTY MODEL (do not "improve" this into a lie) ────────────────────────
 * The platform statuses below mirror `lib/league-import/provider-ui-config.ts`,
 * which is the source of truth for what a real user can actually complete today
 * and is guarded by `__tests__/league-import/provider-availability-reconciliation.test.ts`.
 *
 *   sleeper  → available + public username discovery  → REAL no-account import
 *   espn     → available, but needs auth/cookies      → honest signup handoff
 *   yahoo    → available, but needs OAuth             → honest signup handoff
 *   native   → create a league on AllFantasy itself
 *   fantrax  → available:false (upload rejected by its own ownership gate)
 *   mfl      → available:false (no API-key entry UI exists)
 *   flea     → available:false (no reachable path in the import flow)
 *
 * The last three render as non-selectable "Coming soon" cards. Never label them
 * "Fully Supported" and never give them a live Import button — that would put a
 * false claim and a dead end on the homepage. If one of them genuinely starts
 * working, flip it in `provider-ui-config.ts` first, then here.
 *
 * Only Sleeper runs a real anonymous import (public username → leagues, no
 * password), reusing the existing `/api/legacy/guest-import` pipeline via
 * `useLegacySleeperImport`, and lands the visitor on the real guest dashboard
 * at `/dashboard/universal`.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Lock,
  Loader2,
  ShieldCheck,
  Sparkles,
  Clock,
  ExternalLink,
} from 'lucide-react'
import { useLegacySleeperImport } from '@/hooks/useLegacySleeperImport'
import { signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { trackLandingCtaClick } from '@/lib/landing-analytics'
import { V3 } from './copy'

const W = V3.wizard

/** Where a completed real (Sleeper) guest import lands. Reads `af_guest_session`. */
const GUEST_DASHBOARD = '/dashboard/universal'

type PlatformId = 'sleeper' | 'espn' | 'yahoo' | 'native' | 'fantrax' | 'mfl' | 'fleaflicker'

type Platform = {
  id: PlatformId
  name: string
  initial: string
  color: string
  /** 'guest' = real no-account import · 'account' = works, needs signup · 'soon' = not usable yet */
  mode: 'guest' | 'account' | 'create' | 'soon'
  method: string
  statusLabel: string
  /** Plain-language steps shown in wizard step 2. */
  steps: readonly string[]
  inputLabel?: string
  placeholder?: string
  /** Honest caveat rendered under the steps, when there is one. */
  caveat?: string
  helpHref?: string
}

const PLATFORMS: readonly Platform[] = [
  {
    id: 'sleeper',
    name: 'Sleeper',
    initial: 'S',
    color: 'linear-gradient(160deg,#3b4ba8,#1f2a4d)',
    mode: 'guest',
    method: 'Public username',
    statusLabel: 'No account needed',
    steps: [
      'Open the Sleeper app, or go to sleeper.com and sign in.',
      'Tap your avatar in the top corner — your username is shown on your profile page.',
      'Type that username below. That is all we need.',
    ],
    inputLabel: 'Sleeper username',
    placeholder: 'e.g. gridiron_gary',
    caveat: 'We only read your public Sleeper profile. We never ask for your password and we never change anything in your league.',
  },
  {
    id: 'espn',
    name: 'ESPN Fantasy',
    initial: 'E',
    color: 'linear-gradient(160deg,#c8102e,#4a1414)',
    mode: 'account',
    method: 'League ID + cookies',
    statusLabel: 'Free account required',
    steps: [
      'Sign in at fantasy.espn.com and open the league you want to import.',
      'Look at the address bar — your League ID is the number right after "leagueId=".',
      'Create a free AllFantasy account so we can securely store your ESPN connection, then paste the League ID.',
    ],
    caveat:
      'ESPN has no anonymous lookup, and private leagues additionally need your ESPN session cookies (SWID and espn_s2). We store those encrypted against your account, which is why this step needs a free signup first.',
    helpHref: '/import-guides',
  },
  {
    id: 'yahoo',
    name: 'Yahoo Fantasy',
    initial: 'Y',
    color: 'linear-gradient(160deg,#6001d2,#3a1d55)',
    mode: 'account',
    method: 'Secure OAuth',
    statusLabel: 'Free account required',
    steps: [
      'Create a free AllFantasy account — Yahoo ties the connection to your account.',
      'Click "Connect Yahoo". You sign in on Yahoo\'s own site, never here.',
      'Approve read access and pick which leagues to bring over.',
    ],
    caveat: 'Yahoo requires OAuth, so there is nowhere to put the connection until you have an account. We never see your Yahoo password.',
    helpHref: '/import-guides',
  },
  {
    id: 'native',
    name: 'AllFantasy',
    initial: 'AF',
    color: 'linear-gradient(160deg,#8b5cf6,#5b21b6)',
    mode: 'create',
    method: 'Native league',
    statusLabel: 'Full access',
    steps: [
      'Start a league directly on AllFantasy — nothing to import.',
      'Pick your sport, format, and scoring settings.',
      'Invite your managers and draft when you are ready.',
    ],
  },
  {
    id: 'fantrax',
    name: 'Fantrax',
    initial: 'F',
    color: 'linear-gradient(160deg,#8a5a1f,#5a3a14)',
    mode: 'soon',
    method: 'CSV snapshot',
    statusLabel: 'Coming soon',
    steps: [],
  },
  {
    id: 'mfl',
    name: 'MyFantasyLeague',
    initial: 'M',
    color: 'linear-gradient(160deg,#1f6b52,#143a2e)',
    mode: 'soon',
    method: 'API key',
    statusLabel: 'Coming soon',
    steps: [],
  },
  {
    id: 'fleaflicker',
    name: 'Fleaflicker',
    initial: 'FF',
    color: 'linear-gradient(160deg,#2b6ca8,#16354d)',
    mode: 'soon',
    method: 'League ID',
    statusLabel: 'Coming soon',
    steps: [],
  },
]

export function V3ImportWizard() {
  const router = useRouter()
  const renderedAtRef = useRef<number>(Date.now())
  const [selected, setSelected] = useState<PlatformId | null>(null)
  const [step, setStep] = useState(0)
  const [value, setValue] = useState('')
  const [honeypot, setHoneypot] = useState('')

  const platform = useMemo(() => PLATFORMS.find((p) => p.id === selected) ?? null, [selected])

  const { phase, error, bootLoading, statusMessage, startImport, reset } = useLegacySleeperImport({
    importEndpoint: '/api/legacy/guest-import',
    extraBody: { website: honeypot, form_rendered_at: renderedAtRef.current },
  })

  const busy = phase === 'importing' || bootLoading
  const complete = phase === 'complete'

  // Real Sleeper import finished → advance to the done step, then hand off.
  useEffect(() => {
    if (phase !== 'complete') return
    setStep(4)
    const t = setTimeout(() => router.push(GUEST_DASHBOARD), 1400)
    return () => clearTimeout(t)
  }, [phase, router])

  // A failed import should drop the visitor back to the input, not strand them
  // on the progress step with nothing to do.
  useEffect(() => {
    if (phase === 'failed') setStep(2)
  }, [phase])

  function choose(p: Platform) {
    if (p.mode === 'soon') return
    setSelected(p.id)
    setStep(1)
    setValue('')
    if (phase !== 'idle') reset()
  }

  function restart() {
    setSelected(null)
    setStep(0)
    setValue('')
    if (phase !== 'idle') reset()
  }

  function submitGuestImport(e: React.FormEvent) {
    e.preventDefault()
    const clean = value.trim()
    if (!clean || busy || complete) return
    trackLandingCtaClick({
      cta_label: 'Guest import',
      cta_destination: GUEST_DASHBOARD,
      cta_type: 'primary',
      source: 'v3-wizard-sleeper',
    })
    setStep(3)
    void startImport(clean)
  }

  function goSignup(dest: string, label: string) {
    const url = signupUrlWithIntent(dest)
    trackLandingCtaClick({ cta_label: label, cta_destination: url, cta_type: 'primary', source: `v3-wizard-${selected ?? 'none'}` })
    router.push(url)
  }

  return (
    <div>
      {/* ── Platform cards ─────────────────────────────────────────────── */}
      <div className="plat-grid" style={{ marginBottom: 28 }}>
        {PLATFORMS.map((p) => {
          const soon = p.mode === 'soon'
          return (
            <button
              key={p.id}
              type="button"
              className={`plat-card${selected === p.id ? ' is-selected' : ''}${soon ? ' is-soon' : ''}`}
              onClick={() => choose(p)}
              disabled={soon}
              aria-pressed={selected === p.id}
              aria-label={soon ? `${p.name} — coming soon` : `Import from ${p.name}`}
              data-testid="v3-platform-card"
              data-platform={p.id}
              data-mode={p.mode}
            >
              <span className="plat-logo" style={{ background: p.color }}>{p.initial}</span>
              <span className="plat-name">{p.name}</span>
              <span
                className="plat-status"
                style={{ color: soon ? 'var(--text-4)' : p.mode === 'guest' ? 'var(--good)' : 'var(--purple-bright)' }}
              >
                {p.statusLabel}
              </span>
              <span className="plat-meta">{p.method}</span>
              {soon && (
                <span className="pill pill-muted" style={{ padding: '3px 9px', fontSize: 10 }}>
                  <Clock size={10} />
                  In progress
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-4)', marginBottom: 28 }}>
        Fantrax, MyFantasyLeague and Fleaflicker are not connectable yet — we show them here so you know they are on the
        way rather than pretending they work.{' '}
        <Link href="/contact" style={{ color: 'var(--purple-bright)' }}>
          Tell us which one you need most
        </Link>
        .
      </p>

      {/* ── Wizard ─────────────────────────────────────────────────────── */}
      <div className="wiz" data-testid="v3-import-wizard" data-step={step}>
        <div className="wiz-steps" role="list" aria-label="Import progress">
          {W.steps.map((label, i) => (
            <div
              key={label}
              role="listitem"
              className={`wiz-step${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}
              aria-current={i === step ? 'step' : undefined}
              data-testid="v3-wizard-step"
            >
              <span className="wiz-num">{i < step ? <Check size={13} /> : i + 1}</span>
              <span className="wiz-label">{label}</span>
            </div>
          ))}
        </div>

        <div className="wiz-body">
          {/* Step 1 — choose */}
          {step === 0 && (
            <div>
              <h3 style={{ fontSize: 21, marginBottom: 8 }}>{W.chooseTitle}</h3>
              <p style={{ fontSize: 15, color: 'var(--text-3)' }}>{W.chooseSub}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 20, fontSize: 13.5, color: 'var(--text-3)' }}>
                <ShieldCheck size={16} style={{ color: 'var(--good)', flex: 'none' }} />
                Read-only. We never change anything in your league.
              </div>
            </div>
          )}

          {/* Step 2 — how to connect */}
          {step === 1 && platform && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <span className="plat-logo" style={{ background: platform.color, width: 38, height: 38, fontSize: 14 }}>
                  {platform.initial}
                </span>
                <div>
                  <h3 style={{ fontSize: 20 }}>{W.connectTitle} — {platform.name}</h3>
                  <span
                    className={`pill ${platform.mode === 'guest' ? 'pill-good' : 'pill-purple'}`}
                    style={{ marginTop: 6, padding: '3px 10px', fontSize: 11 }}
                  >
                    {platform.mode === 'guest' ? W.noAccountBadge : W.accountBadge}
                  </span>
                </div>
              </div>

              <div className="wiz-instructions">
                {platform.steps.map((s, i) => (
                  <div key={s} className="wiz-instruction">
                    <span className="wiz-instruction-num">{i + 1}</span>
                    <span style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-2)' }}>{s}</span>
                  </div>
                ))}
              </div>

              {platform.caveat && (
                <div
                  style={{
                    display: 'flex',
                    gap: 11,
                    padding: '14px 16px',
                    borderRadius: 'var(--r-md)',
                    border: '1px solid var(--line-purple)',
                    background: 'var(--purple-dim)',
                    marginBottom: 22,
                  }}
                >
                  <Lock size={16} style={{ color: 'var(--purple-bright)', flex: 'none', marginTop: 2 }} />
                  <span style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text-2)' }}>{platform.caveat}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" data-testid="v3-wizard-back" onClick={restart}>
                  <ArrowLeft size={16} /> {W.back}
                </button>

                {platform.mode === 'guest' && (
                  <button type="button" className="btn btn-primary" data-testid="v3-wizard-next" onClick={() => setStep(2)}>
                    {W.next} <ArrowRight size={16} />
                  </button>
                )}
                {platform.mode === 'account' && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="v3-wizard-signup-cta"
                    onClick={() => goSignup('/dashboard', `Connect ${platform.name}`)}
                  >
                    Create a free account to connect {platform.name} <ArrowRight size={16} />
                  </button>
                )}
                {platform.mode === 'create' && (
                  <Link href="/create-league" className="btn btn-primary" data-testid="v3-wizard-create-league">
                    Create a league <ArrowRight size={16} />
                  </Link>
                )}
                {platform.helpHref && (
                  <Link href={platform.helpHref} className="btn btn-ghost" data-testid="v3-wizard-help-link">
                    Full guide <ExternalLink size={14} />
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Step 3 — find leagues (Sleeper only) */}
          {step === 2 && platform?.mode === 'guest' && (
            <form onSubmit={submitGuestImport}>
              <h3 style={{ fontSize: 20, marginBottom: 8 }}>{W.findTitle}</h3>
              <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginBottom: 20 }}>
                Enter your {platform.name} username and we will pull in every league on that profile.
              </p>

              <label className="sr-only" htmlFor="v3-import-input">{platform.inputLabel}</label>
              <div className="field-row">
                <input
                  id="v3-import-input"
                  className="field"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={platform.placeholder}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={busy || complete}
                  data-testid="v3-import-input"
                />
                <Honeypot value={honeypot} onChange={setHoneypot} />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy || complete || !value.trim()}
                  data-testid="v3-import-submit"
                >
                  {busy ? <Loader2 size={16} className="spin" /> : null}
                  {busy ? 'Importing…' : 'Import my leagues'}
                  {!busy && <ArrowRight size={16} />}
                </button>
              </div>

              {phase === 'failed' && error && (
                <p role="alert" data-testid="v3-import-error" style={{ fontSize: 13.5, color: '#fca5a5', marginTop: 12 }}>
                  {error}
                </p>
              )}

              <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-4)', marginTop: 14 }}>
                <Lock size={13} style={{ flex: 'none' }} />
                Public {platform.name} username only — we never ask for a password.
              </p>

              <button type="button" className="btn btn-ghost" style={{ marginTop: 16, paddingLeft: 0 }} onClick={() => setStep(1)}>
                <ArrowLeft size={15} /> {W.back}
              </button>
            </form>
          )}

          {/* Step 4 — importing */}
          {step === 3 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0' }}>
              <Loader2 size={26} className="spin" style={{ color: 'var(--purple-bright)', flex: 'none' }} />
              <div>
                <h3 style={{ fontSize: 19, marginBottom: 5 }}>{W.importingTitle}</h3>
                <p style={{ fontSize: 14, color: 'var(--text-3)' }}>
                  {statusMessage || 'Reading your public profile and pulling in your leagues…'}
                </p>
              </div>
            </div>
          )}

          {/* Step 5 — done */}
          {step === 4 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0' }}>
              <span
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--good-dim)',
                  border: '1px solid rgba(34,197,94,.4)',
                  flex: 'none',
                }}
              >
                <Check size={22} style={{ color: 'var(--good)' }} />
              </span>
              <div style={{ flex: 1 }} data-testid="v3-wizard-done">
                <h3 style={{ fontSize: 19, marginBottom: 5 }}>{W.doneTitle}</h3>
                <p style={{ fontSize: 14, color: 'var(--text-3)' }}>{W.doneSub}</p>
              </div>
              <Link href={GUEST_DASHBOARD} className="btn btn-primary" data-testid="v3-wizard-dashboard-link">
                {W.goToDashboard} <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Bot trap — real users never see or fill this (mirrors GuestLegacyImportForm).
  return (
    <input
      type="text"
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="sr-only"
      style={{ position: 'absolute', height: 0, width: 0, opacity: 0, pointerEvents: 'none' }}
    />
  )
}
