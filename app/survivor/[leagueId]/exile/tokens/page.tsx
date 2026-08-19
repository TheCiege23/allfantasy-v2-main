'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSurvivorUi } from '@/lib/survivor/SurvivorUiContext'

export default function SurvivorExileTokensPage() {
  const params = useParams()
  const leagueId = typeof params?.leagueId === 'string' ? params.leagueId : ''
  const ctx = useSurvivorUi()
  const bal = ctx.tokenBalance ?? 0
  const cap = 12
  const pct = Math.min(100, cap > 0 ? Math.round((bal / cap) * 100) : 0)
  const arc = 264 * (pct / 100)

  // No per-event token ledger is wired into SurvivorUiContext yet — show an honest empty state
  // rather than the same 4 fabricated events for every league (matches the chimmy tab's pattern).
  const events: { icon: string; label: string; week: number; tone: string }[] = []

  return (
    <div className="px-3 pb-28 pt-4 md:px-6 md:pb-10">
      <Link href={`/survivor/${leagueId}/exile`} className="text-[12px] text-violet-300">
        ← Back to Exile Island
      </Link>

      <div className="mx-auto mt-8 flex max-w-sm flex-col items-center">
        <div className="relative h-44 w-44">
          <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--survivor-exile)"
              strokeWidth="10"
              strokeDasharray={`${arc} 264`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="font-mono text-4xl font-bold tabular-nums text-white">{bal}</p>
            <p className="text-[11px] text-white/45">/ {cap} cap</p>
          </div>
        </div>
        <p className="mt-4 text-center text-[12px] text-white/55">
          Conversion preview: tokens may convert to FAAB or points per commissioner rules.
        </p>
      </div>

      <section className="mx-auto mt-10 max-w-lg survivor-panel p-4">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-white/45">Recent events</h2>
        {events.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {events.map((e, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border border-white/[0.05] bg-black/20 px-3 py-2 text-[12px]">
                <span className={`font-mono text-[11px] ${e.tone}`}>{e.icon}</span>
                <div>
                  <p className="text-white/80">{e.label}</p>
                  <p className="text-[10px] text-white/35">Week {e.week}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[12px] text-white/35" data-testid="exile-tokens-events-empty">
            No token events recorded yet.
          </p>
        )}
      </section>

      <section className="mx-auto mt-6 max-w-lg rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-[12px] text-red-100/90">
        ⚠ Boss reset risk: if enabled, a boss win can zero your stack.
      </section>

      <section className="mx-auto mt-6 max-w-lg rounded-xl border border-violet-500/25 bg-violet-950/20 p-4">
        <p className="text-[12px] font-semibold text-violet-100">Return qualification</p>
        <p className="mt-1 text-[12px] text-white/55">Status: not qualified — earn one more token or win the return challenge.</p>
      </section>
    </div>
  )
}
