'use client'
/**
 * Fantasy OS Suite — Phase V7.3: the Fantasy OS gateway (client).
 *
 * A GATEWAY, not a dashboard: it orients the user and routes them into the seven Operating Systems —
 * it never renders the workspaces themselves. Brand/theme come from the active white-label tenant; no
 * provider name appears anywhere on this executive surface. Freshness is stated only where honest
 * metadata exists (season/context) — no fabricated "last synced" timestamps.
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { LayoutGrid, Shield, ArrowRight, Compass, Eye, Radio, BarChart3 } from 'lucide-react'
import { resolveTenantBrand, tenantThemeStyle } from '@/lib/white-label'
import DemoStateBadge from '@/components/fantasy-os/DemoStateBadge'

const BRAND = resolveTenantBrand()

type GatewayLeague = { id: string; name: string; isCommissioner: boolean; role: string }

/** The seven Operating Systems, in guided order: one question + where it lives. Provider-neutral. */
const GUIDED_SEQUENCE: { key: string; os: string; question: string; href: string }[] = [
  { key: 'platform', os: 'Platform OS', question: 'Where should I focus first?', href: '/manager-hub' },
  { key: 'manager', os: 'Manager OS', question: 'What should I do for my team?', href: '/manager-hub' },
  { key: 'commissioner', os: 'Commissioner OS', question: 'Is the league operating well?', href: '/commissioner-hub' },
  { key: 'league', os: 'League OS', question: 'What is happening across the ecosystem?', href: '/commissioner-hub' },
  { key: 'trade', os: 'Trade OS', question: 'Where are the trade opportunities?', href: '/commissioner-hub' },
  { key: 'waiver', os: 'Waiver OS', question: 'Which acquisition decision matters?', href: '/manager-hub' },
  { key: 'draft', os: 'Draft OS', question: 'What preparation is required?', href: '/manager-hub' },
]

export default function FantasyOsGateway({
  leagues,
  isAuthenticated,
}: {
  leagues: GatewayLeague[]
  isAuthenticated: boolean
}) {
  const [contextId, setContextId] = useState<string>('all') // 'all' → Platform OS
  const commissionerLeagues = useMemo(() => leagues.filter((l) => l.isCommissioner), [leagues])
  const hasLeagues = leagues.length > 0
  const hasCommissioner = commissionerLeagues.length > 0
  const selected = contextId === 'all' ? null : leagues.find((l) => l.id === contextId) ?? null

  const portfolioSummary = hasLeagues
    ? `${leagues.length} ${leagues.length === 1 ? 'league' : 'leagues'} connected · ${commissionerLeagues.length} you commission`
    : 'No leagues connected yet'

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-10" style={tenantThemeStyle(BRAND)}>
      {/* ── Brand header ── */}
      <div className="card-premium overflow-hidden p-5 sm:p-6">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-primary/25 bg-brand-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-primary">
          <LayoutGrid className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{BRAND.copy.productName} · Fantasy OS</span>
        </div>
        <h1 className="mt-3 text-[26px] font-black leading-tight tracking-tight text-primary sm:text-[32px]">
          Your executive Operating Systems, in one place.
        </h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-secondary">
          See what needs attention, which Operating System owns it, why it matters, and what to do —
          {' '}{BRAND.copy.platformScopeLabel}.
        </p>
        <p className="mt-3 text-[12px] font-semibold text-muted">{portfolioSummary}</p>

        {!isAuthenticated ? (
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              href="/login?callbackUrl=/fantasy-os"
              prefetch={false}
              className="focus-ring inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 px-5 py-2.5 text-[14px] font-bold text-content-inverse shadow-[0_0_20px_rgba(245,158,11,0.25)] transition hover:from-amber-300 hover:to-amber-400"
            >
              Sign in to enter Fantasy OS
            </Link>
          </div>
        ) : null}
      </div>

      {/* ── Primary entry + context selection ── */}
      <section aria-label="Enter Fantasy OS" className="mt-5 card-premium p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-brand-primary" aria-hidden />
          <h2 className="text-[13px] font-bold uppercase tracking-widest text-secondary">Enter a workspace</h2>
        </div>

        {hasLeagues ? (
          <div className="mt-4">
            <label htmlFor="fos-context" className="text-[12px] font-semibold text-muted">
              Portfolio context
            </label>
            <select
              id="fos-context"
              value={contextId}
              onChange={(e) => setContextId(e.target.value)}
              className="focus-ring mt-1 block w-full rounded-xl border border-subtle bg-surface-muted px-3 py-2.5 text-[14px] font-semibold text-primary"
            >
              <option value="all">All leagues — Platform OS overview</option>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} · {l.role}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2.5">
          <Link
            href={selected ? `/league/${selected.id}` : '/manager-hub'}
            className="focus-ring inline-flex items-center gap-2 rounded-xl bg-brand-primary/10 px-5 py-2.5 text-[14px] font-bold text-brand-primary transition hover:bg-brand-primary/15"
          >
            {selected ? `Open ${selected.name}` : 'Enter Platform OS'}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          {hasCommissioner ? (
            <Link
              href="/commissioner-hub"
              className="focus-ring inline-flex items-center gap-2 rounded-xl border border-subtle bg-surface-muted px-5 py-2.5 text-[14px] font-semibold text-primary transition hover:bg-surface-hover"
            >
              <Shield className="h-4 w-4" aria-hidden />
              {BRAND.copy.commissionerHubLabel}
            </Link>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Platform OS summarizes every league; open a single league for its League, Trade and roster
          systems.
        </p>
      </section>

      {/* ── Executive Intelligence entry — deterministic portfolio analytics ── */}
      <section aria-label="Executive Intelligence" className="mt-5 card-premium p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-brand-primary" aria-hidden />
          <h2 className="text-[13px] font-bold uppercase tracking-widest text-secondary">Executive Intelligence</h2>
        </div>
        <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-secondary">
          A deterministic, evidence-backed portfolio view across every connected league season — platform,
          league, commissioner, trade, waiver, draft and manager intelligence, each labeled by data source.
        </p>
        <Link
          href="/fantasy-os/executive"
          className="focus-ring mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-primary/10 px-5 py-2.5 text-[14px] font-bold text-brand-primary transition hover:bg-brand-primary/15"
        >
          Open Executive Intelligence
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>

      {/* ── Demo mode entry — honest preview vs live distinction ── */}
      <section aria-label="Demonstration modes" className="mt-5 card-premium p-5 sm:p-6">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-secondary">Demonstration</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-status-info/25 bg-status-info/5 p-4">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-status-info" aria-hidden />
              <DemoStateBadge state="presentation-preview" />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-secondary">
              A branded tour using presentation-safe preview data — clearly labeled as preview, no account
              required. Preview values are not your connected leagues.
            </p>
            <Link
              href="/commissioner-hub"
              className="focus-ring mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-status-info"
            >
              Open preview <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
          <div className="rounded-2xl border border-status-success/25 bg-status-success/5 p-4">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-status-success" aria-hidden />
              <DemoStateBadge state={isAuthenticated && hasLeagues ? 'live-connected' : 'unavailable-evidence'} />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-secondary">
              Your real, authorized portfolio data, kept current. Requires a connected account; where a
              decision has nothing open you'll see an honest “no action required”, not an empty guess.
            </p>
            <Link
              href={isAuthenticated && hasLeagues ? '/manager-hub' : '/login?callbackUrl=/fantasy-os'}
              prefetch={false}
              className="focus-ring mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-status-success"
            >
              {isAuthenticated && hasLeagues ? 'Open live view' : 'Connect a league to activate'}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Guided seven-OS rail ── */}
      <section aria-label="Guided tour of the seven Operating Systems" className="mt-5 card-premium p-5 sm:p-6">
        <h2 className="text-[13px] font-bold uppercase tracking-widest text-secondary">
          The seven Operating Systems
        </h2>
        <ol className="mt-4 space-y-2">
          {GUIDED_SEQUENCE.map((s, i) => (
            <li key={s.key}>
              <Link
                href={s.href}
                className="focus-ring group flex items-center gap-3 rounded-xl border border-subtle bg-surface-muted px-4 py-3 transition hover:border-brand-primary/30 hover:bg-surface-hover"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-primary/25 bg-brand-primary/10 text-[12px] font-black text-brand-primary">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-primary">{s.os}</span>
                  <span className="block text-[12px] text-muted">{s.question}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted transition group-hover:text-brand-primary" aria-hidden />
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
