'use client'

import { useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import { GitBranch } from 'lucide-react'
import { ManagerRoleBadge } from '@/components/ManagerRoleBadge'
import type { LeagueTeamSlot, UserLeague } from '@/app/dashboard/types'
import {
  sortTeamsForManagerListing,
  type LeagueSeasonSnapshot,
} from '@/lib/league/sort-teams-standings'
import type { StandingsPresentation } from '@/app/league/[leagueId]/league-dashboard-types'

function teamAvatarSrc(avatarUrl: string | null): string | null {
  if (!avatarUrl?.trim()) return null
  const t = avatarUrl.trim()
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return `https://sleepercdn.com/avatars/${t}`
}

function teamInitials(team: LeagueTeamSlot): string {
  const raw = team.teamName.trim() || team.ownerName.trim() || '?'
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  }
  return raw.slice(0, 2).toUpperCase()
}

function isPreDraftLeague(league: UserLeague): boolean {
  const s = String(league.status ?? '').toLowerCase()
  if (!s) return true
  if (s.includes('in_season') || s === 'in season' || s === 'complete' || s === 'postseason') {
    return false
  }
  return s.includes('draft') || s.includes('pre') || s === 'scheduled'
}

function isPostSeason(league: UserLeague, snapshot: LeagueSeasonSnapshot | null): boolean {
  const s = String(league.status ?? '').toLowerCase()
  if (s === 'complete' || s.includes('complete') || s === 'offseason' || s === 'off_season') return true
  const phase = String(
    (league.settings as Record<string, unknown> | undefined)?.dynastySeasonPhase ?? '',
  ).toLowerCase()
  if (phase === 'offseason' || phase === 'complete') return true
  const snapStatus = String(snapshot?.status ?? '').toLowerCase()
  if (snapStatus === 'complete') return true
  return false
}

function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function subtitleForTeam(
  league: UserLeague,
  team: LeagueTeamSlot,
  rank: number,
  total: number,
  snapshot: LeagueSeasonSnapshot | null,
  preDraft: boolean,
  showDraftPositions: boolean,
): string {
  if (preDraft) {
    if (!showDraftPositions) return ''
    return team.draftPosition != null ? `Draft position #${team.draftPosition}` : 'No draft position'
  }
  if (isPostSeason(league, snapshot)) {
    if (snapshot?.championTeamId === team.id) return 'Champion'
    if (rank === 1) return 'Champion'
    if (rank === 2) return 'Runner-up'
    return `${ordinal(rank)} of ${total}`
  }
  return ''
}

type Tier = 'chop_zone' | 'danger' | 'safe'

function guillotineOrderedTeams(
  teams: LeagueTeamSlot[],
  league: UserLeague,
  snapshot: LeagueSeasonSnapshot | null,
  dangerByTeamId: Record<string, Tier>,
): LeagueTeamSlot[] {
  const base = sortTeamsForManagerListing(teams, league, snapshot)
  const idx = new Map(base.map((t, i) => [t.id, i]))
  const order: Record<Tier, number> = { chop_zone: 0, danger: 1, safe: 2 }
  return [...teams].sort((a, b) => {
    const ta = dangerByTeamId[a.id] ?? 'safe'
    const tb = dangerByTeamId[b.id] ?? 'safe'
    const oa = order[ta] ?? 3
    const ob = order[tb] ?? 3
    if (oa !== ob) return oa - ob
    return (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0)
  })
}

function guillotineBadge(tier: Tier | undefined): { label: string; className: string } | null {
  if (!tier) return null
  if (tier === 'chop_zone') {
    return {
      label: 'Chop zone',
      className: 'border-rose-500/40 bg-rose-500/15 text-rose-100',
    }
  }
  if (tier === 'danger') {
    return {
      label: 'In danger',
      className: 'border-amber-500/40 bg-amber-500/12 text-amber-100',
    }
  }
  return { label: 'Safe', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100/90' }
}

export function LeagueManagersStandingsSection({
  league,
  leagueId,
  teams,
  seasonSnapshot,
  draftTabExtras,
  standingsPresentation = { mode: 'standard' },
  /** When false (e.g. League tab during pre-draft), hide draft slot subtext under each team. */
  showDraftPositions = true,
}: {
  league: UserLeague
  leagueId: string
  teams: LeagueTeamSlot[]
  seasonSnapshot: LeagueSeasonSnapshot | null
  draftTabExtras?: { filled: number; cap: number; isFull: boolean; isOwner: boolean }
  standingsPresentation?: StandingsPresentation
  showDraftPositions?: boolean
}) {
  const preDraft = isPreDraftLeague(league)
  const sorted = useMemo(
    () => sortTeamsForManagerListing(teams, league, seasonSnapshot),
    [teams, league, seasonSnapshot],
  )

  const heading = useMemo(() => {
    if (preDraft) return 'Team'
    if (standingsPresentation.mode === 'guillotine') return 'Standings · Guillotine'
    if (standingsPresentation.mode === 'survivor') return 'Standings · Tribes'
    if (standingsPresentation.mode === 'divisions') return 'Standings · Divisions'
    return 'Standings'
  }, [preDraft, standingsPresentation.mode])

  const bracketHref = `/league/${leagueId}?view=standings`

  const divisionBlocks = useMemo(() => {
    if (standingsPresentation.mode !== 'divisions') return null
    const divMeta = new Map(
      standingsPresentation.divisions.map((d) => [
        d.divisionId,
        { name: d.name, tier: d.tierLevel },
      ]),
    )
    const byDiv = new Map<string, LeagueTeamSlot[]>()
    for (const t of sorted) {
      const key = t.divisionId ?? '__unassigned__'
      const list = byDiv.get(key) ?? []
      list.push(t)
      byDiv.set(key, list)
    }
    const orderedDivIds = [...standingsPresentation.divisions]
      .sort((a, b) => a.tierLevel - b.tierLevel)
      .map((d) => d.divisionId)
    const blocks: { title: string; list: LeagueTeamSlot[] }[] = []
    for (const id of orderedDivIds) {
      const list = byDiv.get(id)
      if (list?.length) {
        blocks.push({
          title: divMeta.get(id)?.name ?? 'Division',
          list,
        })
      }
    }
    const unassigned = byDiv.get('__unassigned__')
    if (unassigned?.length) {
      blocks.push({ title: 'Unassigned', list: unassigned })
    }
    return blocks
  }, [sorted, standingsPresentation])

  const survivorBlocks = useMemo(() => {
    if (standingsPresentation.mode !== 'survivor') return null
    const inTribe = new Set<string>()
    const blocks: { title: string; list: LeagueTeamSlot[] }[] = []
    for (const tribe of standingsPresentation.tribes) {
      const list = tribe.teamIds
        .map((id) => teams.find((x) => x.id === id))
        .filter((x): x is LeagueTeamSlot => Boolean(x))
      for (const t of list) inTribe.add(t.id)
      if (list.length) {
        blocks.push({ title: tribe.name, list: sortTeamsForManagerListing(list, league, seasonSnapshot) })
      }
    }
    const rest = teams.filter((t) => !inTribe.has(t.id))
    if (rest.length) {
      blocks.push({
        title: 'Not assigned',
        list: sortTeamsForManagerListing(rest, league, seasonSnapshot),
      })
    }
    return blocks
  }, [standingsPresentation, teams, league, seasonSnapshot])

  const guillotineList = useMemo(() => {
    if (standingsPresentation.mode !== 'guillotine') return null
    return guillotineOrderedTeams(teams, league, seasonSnapshot, standingsPresentation.dangerByTeamId)
  }, [standingsPresentation, teams, league, seasonSnapshot])

  const renderRow = (
    team: LeagueTeamSlot,
    rank: number,
    total: number,
    extra?: { guillotineTier?: Tier },
  ) => {
    const src = teamAvatarSrc(team.avatarUrl)
    const wl =
      team.ties > 0 ? `${team.wins}-${team.losses}-${team.ties}` : `${team.wins}-${team.losses}`
    const hasRecord = team.wins > 0 || team.losses > 0 || team.ties > 0
    const showUnclaimed = draftTabExtras && team.isOrphan && draftTabExtras.isOwner
    const faab =
      team.faabRemaining != null && Number.isFinite(team.faabRemaining) ? `$${team.faabRemaining}` : '—'
    const prio =
      team.waiverPriority != null && Number.isFinite(team.waiverPriority) ? team.waiverPriority : '—'
    const sub = subtitleForTeam(league, team, rank, total, seasonSnapshot, preDraft, showDraftPositions)
    const gBadge = extra?.guillotineTier ? guillotineBadge(extra.guillotineTier) : null

    return (
      <li key={team.id} className="py-2 sm:py-2.5">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-7 shrink-0 text-center text-[14px] font-bold tabular-nums text-white/65 sm:w-8 sm:text-[15px]">
            {rank}
          </div>
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white/10 sm:h-10 sm:w-10">
            {src ? (
              <img src={src} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[11px] font-bold text-white/70">
                {teamInitials(team)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-semibold leading-tight text-white sm:text-[14px]">
                    {team.teamName}
                  </span>
                  <ManagerRoleBadge role={team.role} />
                  {showUnclaimed ? (
                    <span className="rounded border border-cyan-500/40 bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-cyan-300">
                      Unclaimed
                    </span>
                  ) : null}
                  {gBadge ? (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${gBadge.className}`}
                    >
                      {gBadge.label}
                    </span>
                  ) : null}
                </div>
                {!preDraft ? (
                  <p className="mt-0.5 text-[11px] text-white/38">
                    @{team.ownerName.replace(/^@/, '') || 'manager'}
                  </p>
                ) : null}
              </div>
              {!preDraft ? (
                <div className="shrink-0 text-right">
                  <span className="text-[15px] font-bold tabular-nums text-white sm:text-[16px]">
                    {hasRecord ? wl : '—'}
                  </span>
                </div>
              ) : null}
            </div>
            {preDraft && sub ? (
              <p className="mt-1.5 text-[10px] text-sky-200/45">{sub}</p>
            ) : !preDraft ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-sky-200/55 sm:text-[11px]">
                <span>PF {team.pointsFor > 0 ? team.pointsFor.toFixed(2) : '—'}</span>
                <span>PA {team.pointsAgainst > 0 ? team.pointsAgainst.toFixed(2) : '—'}</span>
                <span>
                  WAIVER {faab} ({prio})
                </span>
                {sub ? <span className="text-white/35">{sub}</span> : null}
              </div>
            ) : null}
          </div>
        </div>
      </li>
    )
  }

  const listForMode = (): ReactNode => {
    if (standingsPresentation.mode === 'divisions' && divisionBlocks) {
      return divisionBlocks.map((block) => (
        <div key={block.title}>
          <div className="bg-[#151a28] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-cyan-200/80 sm:px-4">
            {block.title}
          </div>
          <ul className="divide-y divide-white/[0.04] px-2 sm:px-3">
            {block.list.map((team, i) => renderRow(team, i + 1, block.list.length))}
          </ul>
        </div>
      ))
    }

    if (standingsPresentation.mode === 'survivor' && survivorBlocks) {
      return survivorBlocks.map((block) => (
        <div key={block.title}>
          <div className="bg-[#151a28] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-amber-200/85 sm:px-4">
            {block.title}
          </div>
          <ul className="divide-y divide-white/[0.04] px-2 sm:px-3">
            {block.list.map((team, i) => renderRow(team, i + 1, block.list.length))}
          </ul>
        </div>
      ))
    }

    if (standingsPresentation.mode === 'guillotine' && guillotineList) {
      const danger = standingsPresentation.dangerByTeamId
      return (
        <ul className="divide-y divide-white/[0.04] px-2 py-1 sm:px-3">
          {guillotineList.map((team, index) =>
            renderRow(team, index + 1, guillotineList.length, {
              guillotineTier: danger[team.id],
            }),
          )}
        </ul>
      )
    }

    return (
      <ul className="divide-y divide-white/[0.04] px-2 py-1 sm:px-3">
        {sorted.map((team, index) => renderRow(team, index + 1, sorted.length))}
      </ul>
    )
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border border-white/[0.06] bg-[#11182b]"
      aria-label={preDraft ? 'Teams' : 'Standings'}
      data-testid="league-managers-standings"
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-white sm:text-[16px]">{heading}</h2>
          {preDraft && draftTabExtras ? (
            <p className="mt-0.5 text-[11px] text-white/45">
              {draftTabExtras.isFull
                ? 'League is full'
                : `${draftTabExtras.filled} of ${draftTabExtras.cap} teams`}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!preDraft && draftTabExtras ? (
            <p className="text-[11px] text-white/45">
              {draftTabExtras.isFull
                ? 'League is full'
                : `${draftTabExtras.filled} of ${draftTabExtras.cap} teams`}
            </p>
          ) : !preDraft ? (
            <span className="text-[11px] text-white/40">
              {teams.length} team{teams.length === 1 ? '' : 's'}
            </span>
          ) : null}
          {!preDraft ? (
            <Link
              href={bracketHref}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.1] bg-[#12192e] text-cyan-300/90 transition hover:bg-white/[0.06] hover:text-cyan-200"
              aria-label="Playoff bracket, standings and seeds"
              title="Playoff bracket, standings and seeds"
              data-testid="league-standings-bracket-link"
            >
              <GitBranch className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>

      {listForMode()}
    </section>
  )
}
