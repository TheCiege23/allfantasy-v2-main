import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Swords,
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Clock,
  Users,
  List,
  Flag,
  Shield,
  CheckCircle2,
  Zap,
} from 'lucide-react'

export const metadata: Metadata = {
  title: 'AF Legacy | AI Fantasy Football Draft Tool | AllFantasy',
  description:
    'Use AF Legacy as your AI-powered fantasy football draft assistant with pick recommendations, tier alerts, roster strategy, and multi-sport draft previews.',
}

const SPORT_CARDS = [
  {
    sport: 'NFL',
    status: 'Active' as const,
    description:
      'Full AI draft intelligence — pick recommendations, tier cliffs, roster build strategy, and live board tracking.',
    href: '/mock-draft',
    ctaLabel: 'Open NFL AF Legacy',
  },
  {
    sport: 'NBA',
    status: 'Preview' as const,
    description: 'NBA fantasy draft support is in preview. Position scarcity and tier data coming soon.',
    href: null,
    ctaLabel: 'Coming Soon',
  },
  {
    sport: 'MLB',
    status: 'Preview' as const,
    description: 'Baseball draft intelligence including positional value and injury outlook is in development.',
    href: null,
    ctaLabel: 'Coming Soon',
  },
  {
    sport: 'NHL',
    status: 'Preview' as const,
    description: 'Hockey fantasy support with goalie streaming and line combination data is coming soon.',
    href: null,
    ctaLabel: 'Coming Soon',
  },
  {
    sport: 'Soccer',
    status: 'Preview' as const,
    description: 'World Cup pools and fantasy soccer support are actively expanding across AllFantasy.',
    href: '/brackets',
    ctaLabel: 'View Pools',
  },
] as const

const FEATURES = [
  {
    Icon: Zap,
    title: 'AI Pick Advisor',
    description:
      'Chimmy surfaces best-available recommendations at each pick based on your roster needs and tier position.',
    style: 'cyan',
  },
  {
    Icon: AlertTriangle,
    title: 'Tier Cliff Alerts',
    description:
      'Know exactly when the talent drop happens so you never miss the last safe pick at a premium tier.',
    style: 'amber',
  },
  {
    Icon: TrendingUp,
    title: 'Roster Build Meter',
    description:
      'See how balanced your roster is across positions and get real-time guidance on where to invest.',
    style: 'emerald',
  },
  {
    Icon: Clock,
    title: 'Value Windows',
    description:
      'Identify the optimal pick range for every player — know when to target, when to wait, and when to pivot.',
    style: 'violet',
  },
  {
    Icon: Users,
    title: 'Team Needs',
    description:
      'Track positional scarcity across the board and prioritize your biggest roster gaps with confidence.',
    style: 'cyan',
  },
  {
    Icon: List,
    title: 'Player Queue',
    description:
      'Build and manage your personal draft board with custom rankings and contingency fallbacks.',
    style: 'violet',
  },
  {
    Icon: Flag,
    title: 'Risk Flags',
    description:
      'Surface injury risk, age curve, handcuff value, and situation volatility before the clock runs out.',
    style: 'amber',
  },
  {
    Icon: Shield,
    title: 'Commissioner Settings',
    description:
      'Configure scoring, roster rules, and draft preferences so your AF Legacy is calibrated to your exact league.',
    style: 'emerald',
  },
] as const

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Choose your sport and draft format',
    description:
      'Select NFL, start a mock draft, or connect your Sleeper league for live draft companion mode.',
  },
  {
    step: '02',
    title: 'Let Chimmy monitor tiers, roster needs, and draft flow',
    description:
      'The AI engine tracks tier breaks, positional scarcity, and opponent tendencies in real time as your draft unfolds.',
  },
  {
    step: '03',
    title: 'Make smarter picks with explainable recommendations',
    description:
      'Every suggestion comes with a reason — Chimmy explains why, so you stay in control of your draft.',
  },
] as const

const FEATURE_STYLE: Record<string, { border: string; bg: string; label: string; icon: string }> = {
  cyan: {
    border: 'border-cyan-500/20',
    bg: 'bg-cyan-500/[0.05]',
    label: 'text-cyan-300',
    icon: 'text-cyan-400',
  },
  violet: {
    border: 'border-violet-500/20',
    bg: 'bg-violet-500/[0.05]',
    label: 'text-violet-300',
    icon: 'text-violet-400',
  },
  emerald: {
    border: 'border-emerald-500/20',
    bg: 'bg-emerald-500/[0.05]',
    label: 'text-emerald-300',
    icon: 'text-emerald-400',
  },
  amber: {
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/[0.05]',
    label: 'text-amber-300',
    icon: 'text-amber-400',
  },
}

export default function WarRoomPage() {
  return (
    <div className="min-h-screen bg-[#050814] text-white">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-4 pb-16 pt-14 sm:px-6 lg:px-8">
        {/* radial glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 opacity-60"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(34,211,238,0.18) 0%, transparent 70%)',
          }}
        />

        <div className="mx-auto max-w-4xl text-center">
          {/* status badges */}
          <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              NFL Active
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/35 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold text-violet-300">
              <Sparkles className="h-3 w-3" />
              Multi-Sport Preview
            </span>
          </div>

          {/* title */}
          <div className="mb-4 flex items-center justify-center gap-3">
            <Swords className="h-8 w-8 text-cyan-400 sm:h-9 sm:w-9" />
            <h1 className="text-[32px] font-black leading-tight tracking-tight text-white sm:text-[44px]">
              The AF Legacy
            </h1>
          </div>

          <p className="mx-auto mb-8 max-w-2xl text-[15px] leading-relaxed text-white/60 sm:text-[16px]">
            Your AI-powered draft command center for smarter picks, sharper roster builds, and better
            fantasy decisions.
          </p>

          {/* CTAs */}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/mock-draft"
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-7 py-3 text-[15px] font-bold text-black transition hover:bg-cyan-300 active:scale-[0.98] sm:w-auto"
            >
              <Swords className="h-4 w-4" />
              Open NFL AF Legacy
            </Link>
            <a
              href="#sport-modes"
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-violet-500/35 bg-violet-500/10 px-7 py-3 text-[15px] font-semibold text-violet-300 transition hover:bg-violet-500/20 active:scale-[0.98] sm:w-auto"
            >
              <Sparkles className="h-4 w-4" />
              Preview Other Sports
            </a>
          </div>

          <p className="mt-5 text-[11px] text-white/30">
            Chimmy gives recommendations, not guarantees — built to support smarter fantasy strategy
            without gambling.
          </p>
        </div>
      </section>

      {/* ── Hidden SEO headings ───────────────────────────────────────────── */}
      <div className="sr-only">
        <h2>Fantasy Football Draft Tool</h2>
        <h2>AI Draft Assistant</h2>
        <h2>Dynasty Draft AF Legacy</h2>
        <h2>Multi-Sport Fantasy Draft Preview</h2>
      </div>

      <div className="mx-auto max-w-5xl space-y-16 px-4 pb-24 sm:px-6 lg:px-8">

        {/* ── Sport Mode Cards ──────────────────────────────────────────────── */}
        <section id="sport-modes">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-white/30">
            Sport Modes
          </p>
          <h2 className="mb-6 text-[22px] font-black text-white">Multi-Sport Draft Intelligence</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SPORT_CARDS.map(({ sport, status, description, href, ctaLabel }) => {
              const isActive = status === 'Active'
              return (
                <div
                  key={sport}
                  className={`flex flex-col rounded-2xl border p-4 ${
                    isActive
                      ? 'border-cyan-500/25 bg-cyan-500/[0.05]'
                      : 'border-white/[0.07] bg-white/[0.02]'
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="text-[15px] font-black text-white">{sport}</span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                        isActive
                          ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                          : 'border-white/10 bg-white/[0.04] text-white/35'
                      }`}
                    >
                      {status}
                    </span>
                  </div>
                  <p className="mb-4 flex-1 text-[12px] leading-snug text-white/45">{description}</p>
                  {href ? (
                    <Link
                      href={href}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-4 py-2 text-[12px] font-semibold transition hover:opacity-90 ${
                        isActive
                          ? 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
                          : 'border-white/10 bg-white/[0.05] text-white/45 hover:bg-white/10'
                      }`}
                    >
                      {isActive && <Swords className="h-3.5 w-3.5" />}
                      {ctaLabel}
                    </Link>
                  ) : (
                    <span className="inline-flex cursor-default items-center justify-center rounded-xl border border-white/8 bg-white/[0.02] px-4 py-2 text-[12px] font-semibold text-white/25">
                      {ctaLabel}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── War Room Features ─────────────────────────────────────────────── */}
        <section>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-white/30">
            Intelligence Tools
          </p>
          <h2 className="mb-6 text-[22px] font-black text-white">AF Legacy Features</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ Icon, title, description, style }) => {
              const s = FEATURE_STYLE[style]
              return (
                <div key={title} className={`rounded-2xl border p-4 ${s.border} ${s.bg}`}>
                  <Icon className={`mb-2.5 h-5 w-5 ${s.icon}`} />
                  <p className={`mb-1.5 text-[13px] font-bold ${s.label}`}>{title}</p>
                  <p className="text-[11px] leading-snug text-white/40">{description}</p>
                </div>
              )
            })}
          </div>
        </section>

        {/* ── How It Works ──────────────────────────────────────────────────── */}
        <section>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-white/30">
            Getting Started
          </p>
          <h2 className="mb-6 text-[22px] font-black text-white">How It Works</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {HOW_IT_WORKS.map(({ step, title, description }) => (
              <div key={step} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
                <p className="mb-3 text-[30px] font-black leading-none text-cyan-500/30">{step}</p>
                <p className="mb-2 text-[14px] font-bold text-white">{title}</p>
                <p className="text-[12px] leading-snug text-white/45">{description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
        <section className="text-center">
          <h2 className="mb-3 text-[22px] font-black text-white">Ready to draft smarter?</h2>
          <p className="mx-auto mb-7 max-w-md text-[13px] leading-relaxed text-white/50">
            Start with a mock draft to experience AF Legacy, then connect your Sleeper leagues for
            live draft companion mode.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/mock-draft"
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-6 py-3 text-[14px] font-bold text-black transition hover:bg-cyan-300 sm:w-auto"
            >
              <Swords className="h-4 w-4" />
              Open NFL AF Legacy
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-white/15 px-6 py-3 text-[14px] font-semibold text-white/60 transition hover:text-white/80 sm:w-auto"
            >
              Go to Dashboard
            </Link>
          </div>
        </section>

        {/* ── AI Transparency / No-Gambling Trust Block ─────────────────────── */}
        <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
          <div className="mb-4 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-400/70">
              AI Transparency &amp; Trust
            </p>
          </div>
          <p className="mb-3 text-[13px] leading-relaxed text-white/45">
            AllFantasy is built for fantasy sports strategy, league management, AI analysis, and
            community. We do not offer sportsbook, casino, or gambling services.
          </p>
          <p className="text-[13px] leading-relaxed text-white/45">
            AI recommendations are designed to support your decisions, not guarantee outcomes. Every
            pick suggestion comes with an explanation so you stay in control.
          </p>
          <p className="mt-3 text-[11px] text-white/25">
            AllFantasy is not a sportsbook, casino, or gambling platform.
          </p>
        </section>

      </div>
    </div>
  )
}
