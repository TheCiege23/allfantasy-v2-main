'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayerEntry } from '@/components/app/draft-room/PlayerPanel'
import { DraftHelperCopilot } from '@/components/app/draft-room/DraftHelperCopilot'
import { DraftHelperIntelligence } from '@/components/app/draft-room/DraftHelperIntelligence'
import {
  filterPlayersAvailableForDraftAi,
  normalizeDraftedPlayerName,
} from '@/lib/draft-room/availableForDraftAi'
import {
  buildAiAdpLookupMaps,
  expandAiAdpKeysForLookup,
  lookupAiAdpMatch,
  type AiAdpSnapshotRow,
} from '@/lib/draft-room/ai-adp-lookup'
import { getDefaultRosterSlotsForSport } from '@/lib/draft-room'
import { resolveEffectiveCurrentPick } from '@/lib/live-draft-engine/draftRoomCoreState'
import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { ComponentProps } from 'react'
import type { DraftHelperPanelProps } from '@/components/app/draft-room/DraftHelperPanel'

type DraftCompanionCopilotProps = Partial<ComponentProps<typeof DraftHelperCopilot>>

type DraftIntelProps = ComponentProps<typeof DraftHelperIntelligence>

type DraftSettingsJson = {
  draftUISettings?: {
    aiAdpEnabled?: boolean
    aiQueueReorderEnabled?: boolean
    draftAiExplanationEnabled?: boolean
    orphanTeamAiManagerEnabled?: boolean
  }
  formatType?: string
  idpRosterSummary?: { starterSlots: Record<string, number>; benchSlots: number } | null
  orphanAiProviderAvailable?: boolean
  commissionerAiDraft?: {
    assignedAiTeams: Array<{ active?: boolean }>
  } | null
}

type AssistantContextJson = {
  headlines?: Array<{ id?: string; title?: string; playerName?: string | null }>
  injuries?: Array<{ playerName?: string; status?: string; note?: string }>
  sportsFeed?: {
    available?: boolean
    digest?: string | null
  }
}

function buildAssistantFeedBrief(ctx: AssistantContextJson | null): string {
  if (!ctx) return ''
  const chunks: string[] = []
  for (const h of (ctx.headlines ?? []).slice(0, 5)) {
    const t = typeof h.title === 'string' ? h.title.trim() : ''
    if (!t) continue
    chunks.push(h.playerName ? `${h.playerName}: ${t}` : t)
  }
  for (const inj of (ctx.injuries ?? []).slice(0, 5)) {
    const bits = [inj.playerName, inj.status, inj.note].filter(
      (x): x is string => typeof x === 'string' && x.trim().length > 0,
    )
    if (bits.length) chunks.push(bits.join(' '))
  }
  const digest = ctx.sportsFeed?.digest?.trim()
  if (digest) chunks.push(digest)
  return chunks.join(' | ').slice(0, 600)
}

function entriesToPlayers(
  entries: NormalizedDraftEntry[],
  draftUISettings: DraftSettingsJson['draftUISettings'],
  aiAdpMaps: ReturnType<typeof buildAiAdpLookupMaps> | null,
): PlayerEntry[] {
  return entries.map((e) => {
    const name = e.name ?? e.display?.displayName ?? ''
    const position = e.position ?? e.display?.metadata?.position ?? ''
    const team = e.team ?? e.display?.metadata?.teamAbbreviation ?? null
    const ai =
      draftUISettings?.aiAdpEnabled && aiAdpMaps ? lookupAiAdpMatch(aiAdpMaps, name, position, team) : null
    return {
      id: e.playerId ?? e.display?.playerId ?? name,
      name,
      position,
      team,
      adp: e.adp ?? e.display?.stats?.adp ?? null,
      byeWeek: e.byeWeek ?? e.display?.metadata?.byeWeek ?? null,
      aiAdp: draftUISettings?.aiAdpEnabled && ai ? ai.adp : (e.aiAdp ?? null),
      aiAdpSampleSize: ai?.sampleSize,
      aiAdpLowSample: ai?.lowSample,
      display: e.display ?? null,
      isDevy: e.isDevy,
      school: e.school ?? null,
      classYearLabel: e.classYearLabel ?? e.display?.metadata?.classYearLabel ?? null,
      draftGrade: e.draftGrade ?? e.display?.metadata?.draftGrade ?? null,
      projectedLandingSpot: e.projectedLandingSpot ?? e.display?.metadata?.projectedLandingSpot ?? null,
      graduatedToNFL: e.graduatedToNFL,
      poolType: e.poolType,
    }
  })
}

function effectiveRosterSlotsFromSettings(settings: DraftSettingsJson | null, sport: string): string[] {
  const fmt = settings?.formatType
  const idp = settings?.idpRosterSummary
  if (fmt === 'IDP' && idp?.starterSlots) {
    const slots: string[] = []
    for (const [slotName, count] of Object.entries(idp.starterSlots)) {
      for (let i = 0; i < count; i += 1) slots.push(slotName)
    }
    for (let i = 0; i < (idp.benchSlots ?? 0); i += 1) slots.push('BENCH')
    return slots
  }
  return getDefaultRosterSlotsForSport(sport)
}

function isSuperflexSlots(slots: string[]): boolean {
  const normalized = slots.map((s) => String(s || '').toUpperCase())
  return (
    normalized.includes('SUPER_FLEX') ||
    normalized.includes('SUPERFLEX') ||
    normalized.includes('OP') ||
    normalized.filter((slot) => slot === 'QB').length >= 2
  )
}

function isRecommendationPlayerAvailable(
  name: string,
  position: string,
  players: PlayerEntry[],
  draftedNames: ReadonlySet<string>,
  draftedPlayerIds: ReadonlySet<string>,
): boolean {
  const resolved =
    players.find(
      (p) =>
        p.name.trim().toLowerCase() === name.trim().toLowerCase() &&
        p.position.trim().toLowerCase() === position.trim().toLowerCase(),
    ) ?? null
  if (!resolved) return false
  if (draftedNames.has(normalizeDraftedPlayerName(resolved.name))) return false
  const pidRaw = resolved.display?.playerId ?? resolved.id ?? null
  const pid =
    pidRaw != null &&
    String(pidRaw).trim() !== '' &&
    !String(pidRaw).startsWith('name:')
      ? String(pidRaw).trim()
      : null
  if (pid && draftedPlayerIds.has(pid)) return false
  return true
}

export type UseLeagueWarRoomCompanionArgs = {
  leagueId: string
  sport: string
  leagueName: string
  isDynasty?: boolean
  enabled: boolean
}

export type UseLeagueWarRoomCompanionResult = {
  loading: boolean
  error: string | null
  intelligence: ComponentProps<typeof DraftHelperIntelligence> | null
  copilot: DraftCompanionCopilotProps | null
  copilotEmptyMessage: string | null
  refresh: () => void
}

const POLL_MS = 45_000

export function useLeagueWarRoomCompanion({
  leagueId,
  sport,
  leagueName,
  isDynasty = false,
  enabled,
}: UseLeagueWarRoomCompanionArgs): UseLeagueWarRoomCompanionResult {
  const resolvedSport = normalizeToSupportedSport(sport) ?? 'NFL'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intelligence, setIntelligence] = useState<DraftIntelProps | null>(null)
  const [copilot, setCopilot] = useState<DraftCompanionCopilotProps | null>(null)
  const [copilotEmptyMessage, setCopilotEmptyMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    if (!enabled || !leagueId) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    setError(null)
    try {
      // Phase 3b — perf: drop `assistant-context` from this hook entirely.
      // That endpoint takes ~68s on cold load (calls news/injury/AI providers).
      // The War Room companion was firing it on every load AND every 45s poll,
      // serializing the room render. The DraftRoomPageClient bootstrap already
      // fetches ctx in the background; the companion's sportsFeed/digest will
      // be empty here for the first poll, then a future architecture pass can
      // share ctx via React context if needed.
      const [sessionRes, poolRes, settingsRes, rosterCfgRes] = await Promise.all([
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/session`, {
          cache: 'no-store',
          signal: ac.signal,
        }),
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/pool`, {
          cache: 'no-store',
          signal: ac.signal,
        }),
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/settings`, {
          cache: 'no-store',
          signal: ac.signal,
        }),
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/roster-config`, {
          cache: 'no-store',
          signal: ac.signal,
        }),
      ])
      const ctxJson: AssistantContextJson = {}

      const sessionJson = await sessionRes.json().catch(() => ({}))
      const poolJson = await poolRes.json().catch(() => ({}))
      const settingsJson = (await settingsRes.json().catch(() => ({}))) as DraftSettingsJson
      const rosterCfgJson = (await rosterCfgRes.json().catch(() => null)) as {
        orderedSlotLabels?: unknown
      } | null

      if (ac.signal.aborted) return

      const draftSession = (sessionJson.session ?? null) as DraftSessionSnapshot | null
      const draftUISettings = settingsJson.draftUISettings

      let adpEntries: AiAdpSnapshotRow[] = []
      if (draftUISettings?.aiAdpEnabled) {
        try {
          const adpRes = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/ai-adp`, {
            cache: 'no-store',
            signal: ac.signal,
          })
          const adpJson = await adpRes.json().catch(() => ({}))
          if (adpRes.ok && Array.isArray(adpJson.entries)) {
            adpEntries = adpJson.entries as AiAdpSnapshotRow[]
          }
        } catch {
          adpEntries = []
        }
      }
      const aiAdpMaps = adpEntries.length ? buildAiAdpLookupMaps(adpEntries) : null
      const aiAdpByKey =
        draftUISettings?.aiAdpEnabled && adpEntries.length > 0 ? expandAiAdpKeysForLookup(adpEntries) : {}

      const poolSport = typeof poolJson.sport === 'string' ? poolJson.sport : resolvedSport
      const entries = Array.isArray(poolJson.entries) ? (poolJson.entries as NormalizedDraftEntry[]) : []
      const players = entriesToPlayers(entries, draftUISettings, aiAdpMaps)

      const headlines = Array.isArray(ctxJson.headlines) ? ctxJson.headlines : []
      const injuries = Array.isArray(ctxJson.injuries) ? ctxJson.injuries : []
      const sportsFeed: NonNullable<DraftHelperPanelProps['sportsFeed']> = {
        available: Boolean(headlines.length || injuries.length || ctxJson.sportsFeed?.digest),
        headlines: headlines.map((h, idx) => ({
          id: typeof h.id === 'string' && h.id.trim() ? h.id : `headline-${idx}`,
          title: typeof h.title === 'string' ? h.title : '',
          playerName: h.playerName ?? null,
          team: null,
          publishedAt: null,
          source: null,
        })),
        injuries: injuries.map((i, idx) => ({
          playerName: typeof i.playerName === 'string' && i.playerName.trim() ? i.playerName : `Player ${idx + 1}`,
          team: null,
          status: i.status ?? null,
          note: i.note ?? null,
          reportedAt: null,
          source: null,
        })),
      }

      setIntelligence({
        aiFeatureStatus: {
          chimmyReady: Boolean(
            draftSession?.status === 'in_progress' && settingsJson.orphanAiProviderAvailable !== false,
          ),
          liveBrainReady: false,
          aiAdpEnabled: Boolean(draftUISettings?.aiAdpEnabled),
          queueReorderEnabled: Boolean(draftUISettings?.aiQueueReorderEnabled),
          draftExplanationEnabled: Boolean(draftUISettings?.draftAiExplanationEnabled),
          orphanAiEnabled: Boolean(draftUISettings?.orphanTeamAiManagerEnabled),
          commissionerAiManagersCount: (settingsJson.commissionerAiDraft?.assignedAiTeams ?? []).filter((t) => t.active)
            .length,
        },
        sportsFeed,
      })

      const baseCopilot = (partial: Partial<DraftCompanionCopilotProps>): DraftCompanionCopilotProps => ({
        loading: false,
        recommendation: null,
        alternatives: [],
        onRefresh: () => void load(),
        explanation: '',
        evidence: [],
        caveats: [],
        round: partial.round ?? 1,
        pick: partial.pick ?? 1,
        sport: partial.sport ?? poolSport,
        ...partial,
      })

      if (!draftSession || draftSession.status === 'completed') {
        setCopilot(
          baseCopilot({
            round: 1,
            pick: 1,
            sport: poolSport,
          }),
        )
        setCopilotEmptyMessage(
          'No in-progress draft session is available from this tab yet. Open the draft room to connect to the live board.',
        )
        return
      }

      if (draftSession.draftType === 'auction') {
        setCopilot(
          baseCopilot({
            round: draftSession.currentPick?.round ?? 1,
            pick: draftSession.currentPick?.slot ?? 1,
            sport: poolSport,
          }),
        )
        setCopilotEmptyMessage(
          'Auction drafts run nominations and bidding inside the draft room. Open it for live copilot-aligned tools.',
        )
        return
      }

      const currentUserRosterId =
        typeof draftSession.currentUserRosterId === 'string' ? draftSession.currentUserRosterId : undefined
      const currentPick = resolveEffectiveCurrentPick(draftSession)

      const draftedNames = new Set(
        (draftSession.picks ?? []).map((p) => normalizeDraftedPlayerName(p.playerName)).filter(Boolean),
      )
      const draftedPlayerIds = new Set<string>()
      for (const p of draftSession.picks ?? []) {
        if (p.playerId) draftedPlayerIds.add(String(p.playerId).trim())
      }

      const fromConfig =
        rosterCfgRes.ok &&
        rosterCfgJson &&
        typeof rosterCfgJson === 'object' &&
        Array.isArray(rosterCfgJson.orderedSlotLabels) &&
        rosterCfgJson.orderedSlotLabels.length > 0 &&
        rosterCfgJson.orderedSlotLabels.every((x) => typeof x === 'string')
          ? (rosterCfgJson.orderedSlotLabels as string[])
          : []
      const rosterSlots =
        fromConfig.length > 0 ? fromConfig : effectiveRosterSlotsFromSettings(settingsJson, poolSport)
      const isSF = isSuperflexSlots(rosterSlots)

      const onClock = Boolean(
        currentUserRosterId &&
          currentPick &&
          currentPick.rosterId === currentUserRosterId &&
          (draftSession.status === 'in_progress' || draftSession.status === 'paused'),
      )

      if (!onClock || !currentPick) {
        setCopilot(
          baseCopilot({
            round: currentPick?.round ?? 1,
            pick: currentPick?.slot ?? 1,
            sport: poolSport,
          }),
        )
        setCopilotEmptyMessage(
          'Copilot picks refresh when your team is on the clock. War Room Chimmy and headlines below stay available.',
        )
        return
      }

      const availablePool = filterPlayersAvailableForDraftAi(players, draftedNames, draftedPlayerIds)
      if (availablePool.length === 0) {
        setCopilot(
          baseCopilot({
            round: currentPick.round,
            pick: currentPick.slot,
            sport: poolSport,
          }),
        )
        setCopilotEmptyMessage('No players available in the synced pool — open the draft room to refresh.')
        return
      }

      const myRoster =
        draftSession.picks
          ?.filter((p) => p.rosterId === currentUserRosterId)
          .map((p) => ({
            position: p.position,
            team: p.team ?? null,
            byeWeek: p.byeWeek ?? null,
          })) ?? []

      const available = availablePool.map((p) => ({
        name: p.name,
        position: p.position,
        team: p.team ?? null,
        adp: draftUISettings?.aiAdpEnabled && p.aiAdp != null ? p.aiAdp : p.adp,
        byeWeek: p.byeWeek ?? null,
      }))

      const assistantFeedBrief = buildAssistantFeedBrief(ctxJson)

      const res = await fetch('/api/draft/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          available,
          teamRoster: myRoster,
          rosterSlots,
          round: currentPick.round,
          pick: currentPick.slot,
          totalTeams: draftSession.teamCount,
          sport: poolSport,
          isDynasty,
          isSF,
          mode: 'needs',
          includeAIExplanation: false,
          leagueId,
          leagueName,
          aiAdpByKey: Object.keys(aiAdpByKey).length ? aiAdpByKey : undefined,
          ...(assistantFeedBrief.trim() ? { assistantFeedBrief: assistantFeedBrief.trim() } : {}),
        }),
        signal: ac.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (ac.signal.aborted) return

      if (!res.ok || !data.ok) {
        setCopilot(
          baseCopilot({
            loading: false,
            round: currentPick.round,
            pick: currentPick.slot,
            sport: poolSport,
          }),
        )
        setCopilotEmptyMessage(typeof data.error === 'string' ? data.error : 'Could not load copilot recommendation.')
        return
      }

      let recommendation = data.recommendation ?? null
      let alternatives = Array.isArray(data.alternatives) ? data.alternatives : []
      const caveats = Array.isArray(data.caveats) ? [...data.caveats] : []

      if (
        recommendation &&
        !isRecommendationPlayerAvailable(
          recommendation.player.name,
          recommendation.player.position,
          players,
          draftedNames,
          draftedPlayerIds,
        )
      ) {
        caveats.push('Suggested player may have just been drafted — refresh or open the draft room.')
        recommendation = null
      }
      alternatives = alternatives.filter((alt: { player?: { name?: string; position?: string } }) =>
        alt?.player?.name && alt?.player?.position
          ? isRecommendationPlayerAvailable(
              alt.player.name,
              alt.player.position,
              players,
              draftedNames,
              draftedPlayerIds,
            )
          : false,
      )

      setCopilot({
        loading: false,
        recommendation,
        alternatives,
        onRefresh: () => void load(),
        explanation: typeof data.explanation === 'string' ? data.explanation : '',
        evidence: Array.isArray(data.evidence) ? data.evidence : [],
        caveats,
        round: currentPick.round,
        pick: currentPick.slot,
        sport: poolSport,
      })
      setCopilotEmptyMessage(null)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Failed to load draft companion')
      setCopilot(null)
      setCopilotEmptyMessage(null)
    } finally {
      if (!ac.signal.aborted) setLoading(false)
    }
  }, [enabled, isDynasty, leagueId, leagueName, resolvedSport])

  useEffect(() => {
    if (!enabled || !leagueId) {
      setLoading(false)
      setIntelligence(null)
      setCopilot(null)
      setCopilotEmptyMessage(null)
      setError(null)
      return
    }
    void load()
    const id = window.setInterval(() => void load(), POLL_MS)
    return () => {
      window.clearInterval(id)
      abortRef.current?.abort()
    }
  }, [enabled, leagueId, load])

  return {
    loading,
    error,
    intelligence,
    copilot,
    copilotEmptyMessage,
    refresh: load,
  }
}
