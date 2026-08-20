'use client'

import { CircleHelp, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import {
  detectScoringFlavor,
  getScoringSettings,
  getSleeperLikeBundle,
  humanizeScoringKey,
} from './league-settings-modal-utils'
import type { LeagueSettingsModalLeague } from './LeagueSettingsSubPanels'

function SleeperEditLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[13px] font-semibold text-[#ff3d81] hover:text-[#ff9ec0]"
      data-testid="scoring-settings-edit-sleeper"
    >
      Edit
    </a>
  )
}

/** Full `scoring_settings` list — read-only cells styled like Sleeper commissioner scoring. */
export function ScoringSettingsFullSection({
  league,
  sleeperSettingsHref,
  showEditLink,
}: {
  league: LeagueSettingsModalLeague
  showEditLink: boolean
  sleeperSettingsHref: string | null
}) {
  const bundle = useMemo(() => getSleeperLikeBundle(league.settings), [league.settings])
  const scoring = useMemo(() => getScoringSettings(league.settings), [league.settings])
  const flavor = useMemo(() => detectScoringFlavor(scoring), [scoring])

  const rows = useMemo(() => {
    const keys = Object.keys(scoring).sort((a, b) => a.localeCompare(b))
    return keys.map((k) => ({ key: k, value: scoring[k]!, label: humanizeScoringKey(k) }))
  }, [scoring])

  const sport = String(bundle.sport ?? 'NFL')

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold text-white">Scoring Settings</span>
          <span className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/45">
            {sport}
          </span>
        </div>
        {showEditLink && sleeperSettingsHref ? <SleeperEditLink href={sleeperSettingsHref} /> : null}
      </div>

      <div className="rounded-lg border border-[#ff3d81]/20 bg-[#ff3d81]/[0.07] px-3 py-2 text-[11px] text-[#ffd7e5]/85">
        Values are synced from your host league. Use Edit to change scoring in Sleeper (or your platform).
        Flavor hint: <span className="font-semibold text-[#ffe9f1]">{flavor}</span>.
      </div>

      <p className="text-[10px] font-bold uppercase tracking-wide text-white/38">All scoring rules</p>

      {rows.length === 0 ? (
        <p className="text-[13px] text-white/45">No scoring_settings in synced league JSON yet.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] bg-[#0a1228]/90">
          {rows.map(({ key, value, label }) => {
            const neg = value < 0
            const display = `${value > 0 ? '+' : ''}${value}`
            return (
              <li
                key={key}
                className="flex items-center justify-between gap-2 px-2.5 py-2 sm:gap-3"
                data-testid={`scoring-row-${key}`}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate text-[13px] text-white/90">{label}</span>
                  <span
                    className="inline-flex shrink-0 text-white/35"
                    title={`${label} (scoring key: ${key})`}
                    aria-hidden
                  >
                    <CircleHelp className="h-3.5 w-3.5" />
                  </span>
                </span>
                <span
                  className={`inline-flex min-h-[34px] min-w-[3.25rem] shrink-0 items-center justify-end rounded-md border border-white/[0.08] bg-[#0d1628] px-2 py-1 text-right text-[13px] font-semibold tabular-nums ${
                    neg ? 'text-rose-400' : 'text-white/95'
                  }`}
                >
                  {display}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {sleeperSettingsHref ? (
        <div className="space-y-2 pt-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-white/35">Popular presets</p>
          <div className="grid grid-cols-2 gap-2">
            <a
              href={sleeperSettingsHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="scoring-preset-espn"
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-left transition hover:border-[#ff3d81]/25 hover:bg-white/[0.06]"
            >
              <p className="text-[13px] font-bold text-white">ESPN</p>
              <p className="mt-1 text-[11px] leading-snug text-white/45">Apply ESPN-style scoring in commissioner tools.</p>
            </a>
            <a
              href={sleeperSettingsHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="scoring-preset-yahoo"
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-left transition hover:border-[#ff3d81]/25 hover:bg-white/[0.06]"
            >
              <p className="text-[13px] font-bold text-white">Yahoo</p>
              <p className="mt-1 text-[11px] leading-snug text-white/45">Apply Yahoo-style scoring in commissioner tools.</p>
            </a>
          </div>
        </div>
      ) : null}

      {sleeperSettingsHref ? (
        <a
          href={sleeperSettingsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-950/20 px-3 py-2.5 text-left transition hover:border-amber-500/35"
          data-testid="scoring-reset-sleeper"
        >
          <div>
            <p className="text-[13px] font-semibold text-amber-200/95">Reset</p>
            <p className="text-[11px] text-white/45">Reset to default scoring in Sleeper commissioner tools.</p>
          </div>
          <RefreshCw className="h-4 w-4 shrink-0 text-amber-300/80" aria-hidden />
        </a>
      ) : null}

      {sleeperSettingsHref ? (
        <a
          href={sleeperSettingsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[12px] font-medium text-[#ff3d81]/90 hover:underline"
        >
          Open full scoring editor on host →
        </a>
      ) : (
        <p className="text-[11px] text-white/38">Connect a Sleeper league to deep-link scoring edits.</p>
      )}
    </div>
  )
}
