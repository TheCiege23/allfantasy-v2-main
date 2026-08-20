'use client'

import type { ReactNode } from 'react'
import { useMemo } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import type { LeagueSettingsModalLeague } from './LeagueSettingsSubPanels'
import {
  extractWaiverScheduleLines,
  getSleeperLikeBundle,
  getSettingsRecord,
  waiverTypeLabel,
} from './league-settings-modal-utils'

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-white/38">{children}</p>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-white/[0.05] py-2.5 last:border-0">
      <p className="text-[11px] text-white/42">{label}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-white/92">{value}</p>
    </div>
  )
}

/** Read-only league rules snapshot (Sleeper-shaped JSON) for commissioner hub. */
export function LeagueRulesSummarySection({
  league,
  displayLeague,
  sleeperSettingsHref,
  showEditLink,
}: {
  league: LeagueSettingsModalLeague
  displayLeague: UserLeague
  /** Commissioner deep-link to host app (e.g. Sleeper settings). */
  sleeperSettingsHref?: string | null
  /** When true and href set, show an Edit control (opens host in new tab). */
  showEditLink?: boolean
}) {
  const bundle = useMemo(() => getSleeperLikeBundle(league.settings), [league.settings])
  const settings = useMemo(() => getSettingsRecord(league.settings), [league.settings])
  const waiverMeta = useMemo(() => extractWaiverScheduleLines(league.settings), [league.settings])

  const rosterPositions = (bundle.roster_positions as string[] | undefined) ?? []
  const rosterLine =
    rosterPositions.length > 0
      ? rosterPositions.join(', ')
      : typeof bundle.roster_positions === 'string'
        ? bundle.roster_positions
        : '—'

  const playoffTeams = bundle.playoff_teams ?? settings.playoff_teams
  const playoffStart = bundle.playoff_week_start ?? settings.playoff_week_start
  const waiverType = bundle.waiver_type ?? settings.waiver_type
  const waiverBudget = bundle.waiver_budget ?? settings.waiver_budget
  const tradeDl = bundle.trade_deadline ?? settings.trade_deadline
  const reserveSlots = bundle.reserve_slots ?? settings.reserve_slots
  const taxiSlots = bundle.taxi_slots ?? settings.taxi_slots
  const numTeams =
    typeof bundle.total_rosters === 'number' ? bundle.total_rosters : displayLeague.teamCount

  const waiverTime =
    bundle.waiver_min_time ?? settings.waiver_min_time ?? bundle.players_on_waiver_time ?? null

  const editHref = sleeperSettingsHref?.trim() || null
  const showEdit = Boolean(showEditLink && editHref)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-2">
        <div>
          <h3 className="text-[15px] font-bold text-white">League rules</h3>
          <p className="text-[11px] text-white/40">Read-only snapshot · edit on your host platform</p>
        </div>
        {showEdit ? (
          <a
            href={editHref!}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] font-semibold text-[#ff3d81] hover:text-[#ff9ec0]"
            data-testid="league-rules-edit-sleeper"
          >
            Edit
          </a>
        ) : null}
      </div>

      <div>
        <SectionLabel>Roster construction</SectionLabel>
        <p className="text-[13px] leading-relaxed text-white/88">{rosterLine}</p>
      </div>

      <div>
        <SectionLabel>Playoffs</SectionLabel>
        <SummaryRow
          label="Bracket"
          value={
            playoffTeams != null && playoffStart != null
              ? `${playoffTeams} teams, starts week ${playoffStart}`
              : playoffTeams != null
                ? `${playoffTeams} teams`
                : '—'
          }
        />
      </div>

      <div>
        <SectionLabel>Daily waivers</SectionLabel>
        {waiverMeta.daily.length > 0 ? (
          <ul className="space-y-1.5 text-[13px] text-white/85">
            {waiverMeta.daily.map((line) => (
              <li key={line} className="leading-snug">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-amber-200/75">
            Daily waiver schedule not present in synced JSON. Open Edit to configure Mon–Sun behavior on your host app.
          </p>
        )}
        {waiverMeta.clearWaivers ? (
          <p className="mt-2 text-[12px] text-white/70">{waiverMeta.clearWaivers}</p>
        ) : (
          <SummaryRow label="Clear waivers" value="—" />
        )}
      </div>

      <div>
        <SectionLabel>Waivers & budget</SectionLabel>
        <SummaryRow label="Waiver type" value={waiverTypeLabel(waiverType)} />
        <SummaryRow label="Waiver / FAAB budget" value={waiverBudget != null ? `$${waiverBudget}` : '—'} />
        {waiverTime != null ? (
          <SummaryRow label="Waiver time" value={String(waiverTime)} />
        ) : null}
      </div>

      <div>
        <SectionLabel>Roster slots</SectionLabel>
        <SummaryRow label="Teams" value={String(numTeams)} />
        <SummaryRow label="Injured reserve" value={reserveSlots != null ? String(reserveSlots) : '—'} />
        <SummaryRow label="Taxi" value={taxiSlots != null ? String(taxiSlots) : '—'} />
      </div>

      <div>
        <SectionLabel>Trades</SectionLabel>
        <SummaryRow label="Trade deadline" value={tradeDl != null ? `Week ${tradeDl}` : '—'} />
      </div>

      <p className="text-[11px] text-white/38">
        Synced from your host league settings. After you save changes in Sleeper (or your platform), re-sync or refresh
        to see updates here.
      </p>

      {editHref ? (
        <a
          href={editHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-[12px] font-medium text-[#ff3d81]/90 hover:underline"
          data-testid="league-rules-open-sleeper"
        >
          Open full league settings on host →
        </a>
      ) : null}
    </div>
  )
}
