'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Radio, BookOpen, Shield } from 'lucide-react'
import TabDataState from '@/components/app/tabs/TabDataState'
import { useLeagueSectionData } from '@/hooks/useLeagueSectionData'
import { MetricCard, SmartDataView } from '@/components/app/league/SmartDataView'
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

/**
 * IDP League overview. Offense + IDP combined; scoring style card, education, Chimmy.
 */
export default function IDPHome({ leagueId, onOpenChimmy }: { leagueId: string; onOpenChimmy?: () => void }) {
  const [storyModalOpen, setStoryModalOpen] = useState(false)
  const [playerModalOpen, setPlayerModalOpen] = useState(false)
  const [idpConfig, setIdpConfig] = useState<{ scoringPreset: string; positionMode?: string; rosterPreset?: string } | null>(null)
  const [idpConfigLoading, setIdpConfigLoading] = useState(true)
  const { data, loading, error, reload } = useLeagueSectionData<Record<string, unknown>>(leagueId, 'overview')
  const roster = Array.isArray(data?.roster) ? data?.roster : []
  const faab = typeof data?.faabRemaining === 'number' ? data.faabRemaining : '-'
  const sport = (data as { sport?: string })?.sport
  const season = (data as { season?: number })?.season
  const week = (data as { week?: number })?.week
  const weekNum = typeof week === 'number' ? week : 1
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
        <div className="flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-950/20 px-3 py-2 text-sm text-cyan-200">
          <Shield className="h-4 w-4 shrink-0" />
          <span>IDP League — offense + individual defensive players. Set lineups in Roster; scoring includes defensive stats.</span>
        </div>
        <IdpScoringStyleCard
          leagueId={leagueId}
          config={idpConfig}
          loading={idpConfigLoading}
          onAskChimmy={onOpenChimmy}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <IDPWaiverSection leagueId={leagueId} week={weekNum} />
          <IDPMatchupView leagueId={leagueId} week={weekNum} />
        </div>
        {sampleIdp ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-cyan-500/30 text-cyan-100"
              onClick={() => setPlayerModalOpen(true)}
              data-testid="idp-open-player-ai-modal"
            >
              AI Analysis — {sampleIdp.name}
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
              week={weekNum}
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
          className="flex items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-950/30 px-4 py-2.5 text-sm font-medium text-purple-300 hover:bg-purple-950/50 w-full sm:w-auto"
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
          <div className="grid gap-3 sm:grid-cols-3 flex-1 min-w-0">
            <MetricCard label="Roster Size" value={roster.length} />
            <MetricCard label="FAAB Remaining" value={faab} />
            <MetricCard label="League" value={leagueId} hint="Current context" />
          </div>
          <Link
            href={`/app/league/${encodeURIComponent(leagueId)}/broadcast`}
            className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-2.5 text-sm font-medium text-amber-300 hover:bg-amber-950/50"
          >
            <Radio className="h-4 w-4" /> Launch broadcast
          </Link>
        </div>
        <LeagueDramaWidget leagueId={leagueId} sport={sport} season={season} />
        <SmartDataView data={data} />
      </div>
    </TabDataState>
  )
}
