'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { Radio, BookOpen, Shield } from 'lucide-react'
import TabDataState from '@/components/app/tabs/TabDataState'
import { useLeagueSectionData } from '@/hooks/useLeagueSectionData'
import { LeagueDramaWidget } from '@/components/app/league/LeagueDramaWidget'
import { ShareLeagueLinkCard } from '@/components/social/ShareLeagueLinkCard'
import { LeagueStoryModal } from '@/components/league-story/LeagueStoryModal'
import { IdpScoringStyleCard } from '@/components/idp/IdpScoringStyleCard'
import { IDPWaiverSection } from '@/components/idp/IDPWaiverSection'
import { IDPMatchupView } from '@/app/idp/components/IDPMatchupView'
import { IDPPlayerModal } from '@/app/idp/components/IDPPlayerModal'
import { Button } from '@/components/ui/button'
import type { PlayerMap } from '@/lib/hooks/useSleeperPlayers'

function pickFirstIdpPlayer(
  roster: unknown[]
): { playerId: string; name: string; position: string; team: string } | null {
  for (const row of roster) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const pos = String(o.position ?? o.pos ?? '').toUpperCase()
    if (['DE', 'DT', 'DL', 'LB', 'CB', 'S', 'SS', 'FS', 'DB'].includes(pos)) {
      const id = String(o.player_id ?? o.playerId ?? o.id ?? '')
      if (id) {
        return {
          playerId: id,
          name: String(o.name ?? o.full_name ?? 'Player'),
          position: pos,
          team: String(o.team ?? o.editorial_team_abbr ?? ''),
        }
      }
    }
  }
  return null
}

/** The players on the overview: `unifiedRoster` rows, else the ids in the stored roster object. */
function rosterRows(data: Record<string, unknown> | null | undefined): unknown[] {
  if (!data) return []
  if (Array.isArray(data.unifiedRoster)) return data.unifiedRoster
  if (Array.isArray(data.roster)) return data.roster
  const players = (data.roster as { players?: unknown } | null | undefined)?.players
  return Array.isArray(players) ? players : []
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--text)]">{value}</p>
    </div>
  )
}

/**
 * IDP League overview. Offense + IDP combined; scoring style card, education, Chimmy.
 */
export default function IDPHome({ leagueId, onOpenChimmy }: { leagueId: string; onOpenChimmy?: () => void }) {
  const [storyModalOpen, setStoryModalOpen] = useState(false)
  const [playerModalOpen, setPlayerModalOpen] = useState(false)
  const [idpConfig, setIdpConfig] = useState<{ scoringPreset: string; positionMode?: string; rosterPreset?: string } | null>(null)
  const [idpConfigLoading, setIdpConfigLoading] = useState(true)
  const { data, loading, error, reload } = useLeagueSectionData<Record<string, unknown>>(leagueId, 'overview')
  // The overview's `roster` is the stored roster OBJECT ({ players, starters, … }), never an array, so this counted
  // 0 for every league (2026-11-23). `unifiedRoster` carries the players with their positions.
  const roster = rosterRows(data)
  const faab = typeof data?.faabRemaining === 'number' ? data.faabRemaining : '—'
  const sport = (data as { sport?: string })?.sport
  const season = (data as { season?: number })?.season
  // The overview names the current week `leagueWeek`; reading `week` (absent) asked for week 1 all season.
  const d = data as { leagueWeek?: number | null; week?: number | null } | null
  const week = typeof d?.leagueWeek === 'number' ? d.leagueWeek : typeof d?.week === 'number' ? d.week : undefined
  const weekNum = week
  const leagueName = (data as { leagueName?: string })?.leagueName ?? 'League'
  const sampleIdp = pickFirstIdpPlayer(roster)
  /*
   * The modal looks the player up as `players[playerId]`, so a one-entry map built from the row
   * we already have is the whole contract. IDPHome has no Sleeper player map and fetching one to
   * open a single modal would be a page-weight cost for nothing. Anything the modal wants beyond
   * these fields it names as absent rather than filling in.
   */
  const idpPlayerMap: PlayerMap = sampleIdp
    ? { [sampleIdp.playerId]: { id: sampleIdp.playerId, name: sampleIdp.name, position: sampleIdp.position, team: sampleIdp.team } }
    : {}

  useEffect(() => {
    let active = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/idp/config`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d?.config) setIdpConfig(d.config)
      })
      .finally(() => { if (active) setIdpConfigLoading(false) })
    return () => { active = false }
  }, [leagueId])

  return (
    <TabDataState title="Overview" loading={loading} error={error} onReload={() => void reload()}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text2)]">
          <Shield className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <span>You start offense and individual defenders, and defensive stats score. Set your lineup on the Team tab.</span>
        </div>
        <IdpScoringStyleCard
          leagueId={leagueId}
          config={idpConfig}
          loading={idpConfigLoading}
          onAskChimmy={onOpenChimmy}
        />
        <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
          <IDPWaiverSection leagueId={leagueId} week={weekNum ?? 1} />
          <IDPMatchupView leagueId={leagueId} week={weekNum} />
        </div>
        {sampleIdp ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-[var(--accent-line)] text-[var(--accent)]"
              onClick={() => setPlayerModalOpen(true)}
              data-testid="idp-open-player-ai-modal"
            >
              Chimmy Analysis — {sampleIdp.name}
            </Button>
            {/*
              No rosterId here: IDPHome picks a sample defender off the overview payload, which
              carries no roster row id. The modal degrades for that deliberately — it skips the
              contract block and disables the trade link rather than inventing either.
            */}
            <IDPPlayerModal
              leagueId={leagueId}
              playerId={sampleIdp.playerId}
              name={sampleIdp.name}
              position={sampleIdp.position}
              team={sampleIdp.team || null}
              sport={sport ?? 'NFL'}
              week={weekNum ?? 1}
              players={idpPlayerMap}
              open={playerModalOpen}
              onOpenChange={setPlayerModalOpen}
            />
          </div>
        ) : null}
        <ShareLeagueLinkCard leagueId={leagueId} />
        <button
          type="button"
          data-testid="league-story-open-button"
          onClick={() => setStoryModalOpen(true)}
          className="flex items-center gap-2 rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] px-4 py-2.5 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] w-full sm:w-auto"
        >
          <BookOpen className="h-4 w-4" /> Create league story
        </button>
        {storyModalOpen && (
          <LeagueStoryModal
            leagueId={leagueId}
            leagueName={leagueName}
            week={typeof week === 'number' ? week : undefined}
            season={typeof season === 'number' ? String(season) : undefined}
            sport={sport}
            onClose={() => setStoryModalOpen(false)}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid flex-1 min-w-0 grid-cols-2 gap-3 sm:max-w-sm">
            <Stat label="Players" value={<span data-testid="idp-roster-count">{roster.length}</span>} />
            <Stat label="FAAB left" value={faab} />
          </div>
          <Link
            href={`/app/league/${encodeURIComponent(leagueId)}/broadcast`}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line2)] bg-[var(--warn-soft)] px-4 py-2.5 text-sm font-medium text-[var(--warn)] hover:bg-[var(--warn-soft)]"
          >
            <Radio className="h-4 w-4" /> Launch broadcast
          </Link>
        </div>
        <LeagueDramaWidget leagueId={leagueId} sport={sport} season={season} />
      </div>
    </TabDataState>
  )
}
