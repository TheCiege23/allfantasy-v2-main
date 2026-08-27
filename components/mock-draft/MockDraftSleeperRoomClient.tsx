'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ManagerRoleBadge } from '@/components/ManagerRoleBadge'
import { DEFAULT_SPORT, SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { isTournamentHubRow, type LeagueRecordPolicyInput } from '@/lib/dashboard/league-card-fetch-policy'

type EntryStep = 'entry' | 'league' | 'open' | 'draft' | 'complete'
type DraftMode = 'league' | 'open'
type DraftType = 'snake' | 'auction' | 'linear'
type DraftScoring = 'PPR' | 'Half PPR' | 'Standard' | 'Points' | 'Categories'
type DraftSpeed = 30 | 15 | 5 | 0
type DraftStatus = 'setup' | 'drafting' | 'paused' | 'complete'
type MobilePanel = 'players' | 'roster' | 'chat' | null

interface LeagueListItem {
  id: string
  name: string
  platform: string
  platformLeagueId: string | null
  sport: SupportedSport
  scoring: string
  teamCount: number
  isDynasty: boolean
  synced: boolean
  navigationLeagueId: string | null
  unifiedLeagueId: string | null
}

interface LeagueRecord {
  wins: number
  losses: number
  ties: number
  pointsFor: number
}

interface LeagueManager {
  slot: number
  rosterId: number
  managerId: string
  managerName: string
  avatarUrl: string | null
  isUser: boolean
  slotPredicted: boolean
  role: string | null
  isOrphan: boolean
  record: LeagueRecord
}

interface LeagueMockPayload {
  league: {
    leagueId: string | null
    platformLeagueId: string
    leagueName: string
    sport: SupportedSport
    scoring: DraftScoring
    isDynasty: boolean
    teamCount: number
    rounds: number
    draftType: DraftType
    superflex: boolean
    managers: LeagueManager[]
    detectedUserSlot: number
    hasExplicitDraftOrder: boolean
  }
}

interface DraftSettings {
  teamCount: number
  rounds: number
  draftType: DraftType
  sport: SupportedSport
  scoring: DraftScoring
  superflex: boolean
  myPickSlot: number
  speed: DraftSpeed
}

interface DraftPick {
  overall: number
  round: number
  pick: number
  slot: number
  playerId: string
  playerName: string
  position: string
  team: string
  adp: number
  projectedPts: number
  aiReason?: string
  isUser: boolean
  managerName: string
}

interface TeamSlot {
  slot: number
  rosterId?: number
  managerId: string
  managerName: string
  avatarUrl: string | null
  isUser: boolean
  isAI: boolean
  role: string | null
  isOrphan: boolean
  picks: DraftPick[]
  rosterNeeds: string[]
  slotPredicted?: boolean
  record?: LeagueRecord
}

interface AvailablePlayer {
  id: string
  name: string
  position: string
  team: string
  adp: number
  projectedPts: number
  ownership: number
  injuryStatus: string | null
  tier: number
  posRank: string
  isRookie: boolean
}

interface ChatMessage {
  role: 'user' | 'ai'
  content: string
  pick?: number
}

interface DraftState {
  settings: DraftSettings
  teams: TeamSlot[]
  availablePlayers: AvailablePlayer[]
  picks: DraftPick[]
  currentPick: number
  onTheClock: number
  status: DraftStatus
  timerSeconds: number
  chatMessages: ChatMessage[]
}

interface SaveResponse {
  draftId: string
  shareId: string
}

const SPEED_OPTIONS: Array<{ value: DraftSpeed; label: string }> = [
  { value: 30, label: 'Slow 30s' },
  { value: 15, label: 'Normal 15s' },
  { value: 5, label: 'Fast 5s' },
  { value: 0, label: 'Auto' },
]

const FOOTBALL_SCORING_OPTIONS: DraftScoring[] = ['PPR', 'Half PPR', 'Standard']
const GENERIC_SCORING_OPTIONS: DraftScoring[] = ['Points', 'Categories', 'Standard']

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isFootballSport(sport: SupportedSport): boolean {
  return sport === 'NFL' || sport === 'NCAAF'
}

function normalizeLeagueFromList(value: unknown): LeagueListItem | null {
  const raw = recordFromUnknown(value)
  if (!raw) return null

  const id = stringFromUnknown(raw.id)
  const name = stringFromUnknown(raw.name)
  if (!id || !name) return null

  /*
   * ⚠ A tournament hub is not a league this tool can answer for. Its `id` is a
   * `LegacyTournament` key, so every league-scoped call downstream resolves to nothing — and it
   * cannot be spotted by `hasUnifiedRecord`, which these rows set TRUE. Dropped from the picker
   * rather than listed as a dead entry; tournaments live at `/tournament/[id]`.
   */
  if (isTournamentHubRow(raw as LeagueRecordPolicyInput)) return null

  return {
    id,
    name,
    platform: stringFromUnknown(raw.platform) ?? 'sleeper',
    platformLeagueId: stringFromUnknown(raw.platformLeagueId),
    sport: normalizeToSupportedSport(
      stringFromUnknown(raw.sport_type) ??
        stringFromUnknown(raw.sport) ??
        DEFAULT_SPORT,
    ),
    scoring: stringFromUnknown(raw.scoring) ?? 'Standard',
    teamCount: numberFromUnknown(raw.leagueSize) ?? numberFromUnknown(raw.totalTeams) ?? 12,
    isDynasty: raw.isDynasty === true,
    synced: raw.hasUnifiedRecord !== false,
    navigationLeagueId: stringFromUnknown(raw.navigationLeagueId),
    unifiedLeagueId: stringFromUnknown(raw.unifiedLeagueId),
  }
}

function isFootballScoring(settings: DraftSettings): DraftScoring[] {
  return isFootballSport(settings.sport) ? FOOTBALL_SCORING_OPTIONS : GENERIC_SCORING_OPTIONS
}

function positionLabelColor(position: string): string {
  switch (position.toUpperCase()) {
    case 'QB':
      return 'bg-red-500/20 text-red-300'
    case 'RB':
      return 'bg-green-500/20 text-green-300'
    case 'WR':
      return 'bg-blue-500/20 text-blue-300'
    case 'TE':
      return 'bg-orange-500/20 text-orange-300'
    case 'K':
      return 'bg-gray-500/20 text-gray-300'
    case 'DEF':
    case 'DST':
      return 'bg-purple-500/20 text-purple-300'
    case 'PG':
    case 'SG':
    case 'G':
      return 'bg-sky-500/20 text-sky-300'
    case 'SF':
    case 'PF':
    case 'F':
      return 'bg-emerald-500/20 text-emerald-300'
    case 'C':
      return 'bg-yellow-500/20 text-yellow-300'
    case 'P':
    case 'SP':
    case 'RP':
      return 'bg-rose-500/20 text-rose-300'
    case 'MID':
      return 'bg-cyan-500/20 text-cyan-300'
    case 'FWD':
    case 'OF':
      return 'bg-indigo-500/20 text-indigo-300'
    case 'GK':
      return 'bg-amber-500/20 text-amber-300'
    case 'FLEX':
    case 'UTIL':
      return 'bg-cyan-500/20 text-cyan-300'
    default:
      return 'bg-white/10 text-white/70'
  }
}

function getRosterSlots(settings: DraftSettings): string[] {
  switch (settings.sport) {
    case 'NHL':
      return ['C', 'C', 'LW', 'RW', 'LW', 'RW', 'D', 'D', 'UTIL', 'G']
    case 'NBA':
      return ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL']
    case 'MLB':
      return ['C', '1B', '2B', '3B', 'SS', 'OF', 'OF', 'OF', 'UTIL', 'P', 'P']
    case 'NCAAB':
      return ['G', 'G', 'F', 'F', 'C', 'UTIL']
    case 'NCAAF':
      return settings.superflex
        ? ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX']
        : ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
    case 'SOCCER':
      return ['GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'UTIL']
    default:
      return settings.superflex
        ? ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF']
        : ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']
  }
}

function slotSupportsPosition(slot: string, position: string): boolean {
  const normalizedSlot = slot.toUpperCase()
  const normalizedPosition = position.toUpperCase()
  if (normalizedSlot === normalizedPosition) return true

  if (normalizedSlot === 'FLEX') {
    return ['RB', 'WR', 'TE'].includes(normalizedPosition)
  }
  if (normalizedSlot === 'SUPER_FLEX') {
    return ['QB', 'RB', 'WR', 'TE'].includes(normalizedPosition)
  }
  if (normalizedSlot === 'UTIL') {
    return true
  }
  if (normalizedSlot === 'G') {
    return ['PG', 'SG', 'G'].includes(normalizedPosition)
  }
  if (normalizedSlot === 'F') {
    return ['SF', 'PF', 'F'].includes(normalizedPosition)
  }
  if (normalizedSlot === 'P') {
    return ['P', 'SP', 'RP'].includes(normalizedPosition)
  }
  return false
}

function assignRosterSlots(picks: DraftPick[], settings: DraftSettings): Array<DraftPick | null> {
  const slots = getRosterSlots(settings)
  const assigned = Array.from({ length: slots.length }, () => null as DraftPick | null)

  for (const pick of picks) {
    const exactIndex = slots.findIndex((slot, index) => !assigned[index] && slot.toUpperCase() === pick.position.toUpperCase())
    if (exactIndex >= 0) {
      assigned[exactIndex] = pick
      continue
    }

    const flexIndex = slots.findIndex((slot, index) => !assigned[index] && slotSupportsPosition(slot, pick.position))
    if (flexIndex >= 0) {
      assigned[flexIndex] = pick
      continue
    }

    const firstOpen = assigned.findIndex((entry) => entry == null)
    if (firstOpen >= 0) assigned[firstOpen] = pick
  }

  return assigned
}

function computeTeamNeeds(team: TeamSlot, settings: DraftSettings): string[] {
  const slots = getRosterSlots(settings)
  const assigned = assignRosterSlots(team.picks, settings)
  const needs = slots
    .map((slot, index) => (assigned[index] == null ? slot : null))
    .filter((slot): slot is string => slot != null)
    .flatMap((slot) => {
      switch (slot.toUpperCase()) {
        case 'FLEX':
          return ['RB', 'WR', 'TE']
        case 'SUPER_FLEX':
          return ['QB', 'RB', 'WR', 'TE']
        case 'UTIL':
          return []
        case 'G':
          return ['PG', 'SG']
        case 'F':
          return ['SF', 'PF']
        case 'P':
          return ['P']
        default:
          return [slot]
      }
    })

  return Array.from(new Set(needs))
}

function scorePlayerForTeam(
  player: AvailablePlayer,
  team: TeamSlot,
  needs: string[],
  settings: DraftSettings,
  picks: DraftPick[],
  availablePlayers: AvailablePlayer[],
): number {
  let score = Math.max(0, 200 - player.adp)
  const primaryNeed = needs[0] ?? null
  const roundNumber = Math.ceil((picks.length + 1) / settings.teamCount)

  if (needs.includes(player.position)) score += 20
  if (primaryNeed === player.position) score += 10

  if (settings.superflex && player.position === 'QB' && !team.picks.some((pick) => pick.position === 'QB')) {
    score += 15
  }

  const remainingAtPosition = availablePlayers.filter((entry) => entry.position === player.position).length
  if (remainingAtPosition < Math.max(3, Math.floor(settings.teamCount / 3)) && needs.includes(player.position)) {
    score += 8
  }

  if (roundNumber > settings.rounds * 0.7) {
    if (player.ownership < 50 && player.adp > (roundNumber * settings.teamCount * 0.8)) {
      score += 5
    }
    if (player.isRookie) score += 3
  }

  score += Math.min(20, player.projectedPts / 12)
  return score
}

function generatePickReason(player: AvailablePlayer, team: TeamSlot, needs: string[], round: number): string {
  if (needs.includes(player.position)) {
    return `Filled a ${player.position} need with value at ${player.adp.toFixed(1)} ADP.`
  }
  if (round > 10 && player.isRookie) {
    return 'Late-round upside swing with rookie growth appeal.'
  }
  if (round > 12) {
    return 'Added depth and contingent upside for the bench.'
  }
  return `${team.managerName} stayed on value and grabbed best player available.`
}

function getRoundOrder(teams: TeamSlot[], round: number, draftType: DraftType): TeamSlot[] {
  if (draftType === 'snake' && round % 2 === 0) {
    return [...teams].reverse()
  }
  return teams
}

function getOnTheClockSlot(teams: TeamSlot[], settings: DraftSettings, overallPick: number): number {
  const round = Math.ceil(overallPick / settings.teamCount)
  const pickIndex = ((overallPick - 1) % settings.teamCount) + 1
  const orderedTeams = getRoundOrder(teams, round, settings.draftType)
  return orderedTeams[pickIndex - 1]?.slot ?? teams[0]?.slot ?? 1
}

function createOpenMockTeams(settings: DraftSettings): TeamSlot[] {
  return Array.from({ length: settings.teamCount }, (_, index) => {
    const slot = index + 1
    const managerName = slot === settings.myPickSlot ? 'You' : `AI Team ${slot}`
    const baseTeam: TeamSlot = {
      slot,
      managerId: `slot-${slot}`,
      managerName,
      avatarUrl: null,
      isUser: slot === settings.myPickSlot,
      isAI: slot !== settings.myPickSlot,
      role: null,
      isOrphan: false,
      picks: [],
      rosterNeeds: [],
    }

    return {
      ...baseTeam,
      rosterNeeds: computeTeamNeeds(baseTeam, settings),
    }
  })
}

function createLeagueMockTeams(payload: LeagueMockPayload['league'], settings: DraftSettings): TeamSlot[] {
  return payload.managers.map((manager) => {
    const team: TeamSlot = {
      slot: manager.slot,
      rosterId: manager.rosterId,
      managerId: manager.managerId,
      managerName: manager.managerName,
      avatarUrl: manager.avatarUrl,
      isUser: manager.slot === settings.myPickSlot,
      isAI: manager.slot !== settings.myPickSlot,
      role: manager.role,
      isOrphan: manager.isOrphan,
      picks: [],
      rosterNeeds: [],
      slotPredicted: manager.slotPredicted,
      record: manager.record,
    }

    return {
      ...team,
      rosterNeeds: computeTeamNeeds(team, settings),
    }
  })
}

function buildDefaultSettings(): DraftSettings {
  return {
    teamCount: 12,
    rounds: 15,
    draftType: 'snake',
    sport: DEFAULT_SPORT,
    scoring: 'PPR',
    superflex: false,
    myPickSlot: 1,
    speed: 15,
  }
}

function scoringLabelFromLeague(value: string): DraftScoring {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('half')) return 'Half PPR'
  if (normalized.includes('ppr')) return 'PPR'
  if (normalized.includes('categorie')) return 'Categories'
  if (normalized.includes('point')) return 'Points'
  return 'Standard'
}

function buildPlayerContextMessage(state: DraftState, queue: string[]): string {
  const currentTeam = state.teams.find((team) => team.slot === state.onTheClock)
  const queuedPlayers = queue
    .map((id) => state.availablePlayers.find((player) => player.id === id))
    .filter((player): player is AvailablePlayer => player != null)
    .slice(0, 5)

  const draftedNames = new Set(state.picks.map((pick) => pick.playerId))
  const topAvailable = state.availablePlayers
    .filter((player) => !draftedNames.has(player.id))
    .slice(0, 8)
    .map((player) => `${player.name} (${player.position}, ${player.team || 'FA'}, ADP ${player.adp.toFixed(1)})`)
    .join(', ')

  const rosterSummary = currentTeam
    ? currentTeam.picks.map((pick) => `${pick.playerName} (${pick.position})`).join(', ') || 'No picks yet'
    : 'No active team'

  return [
    `Mock draft context: ${state.settings.sport} ${state.settings.scoring} ${state.settings.draftType} draft.`,
    `Current pick: #${state.currentPick}.`,
    `On the clock: ${currentTeam?.managerName ?? 'Unknown manager'}.`,
    `Current roster: ${rosterSummary}.`,
    `Top available players: ${topAvailable}.`,
    queuedPlayers.length > 0
      ? `Queued players: ${queuedPlayers.map((player) => `${player.name} (${player.position})`).join(', ')}.`
      : 'Queued players: none.',
    'Keep the answer tight, practical, and fantasy-specific.',
  ].join(' ')
}

export default function MockDraftSleeperRoomClient({
  initialLeagueId = '',
  initialSport = DEFAULT_SPORT,
}: {
  initialLeagueId?: string
  initialSport?: string
}) {
  const queryLeagueId = initialLeagueId.trim()
  const querySport = normalizeToSupportedSport(initialSport)
  const autoLoadedLeagueRef = useRef<string | null>(null)
  const [step, setStep] = useState<EntryStep>('entry')
  const [mode, setMode] = useState<DraftMode>('open')
  const [settings, setSettings] = useState<DraftSettings>(buildDefaultSettings())
  const [leagues, setLeagues] = useState<LeagueListItem[]>([])
  const [loadingLeagues, setLoadingLeagues] = useState(false)
  const [leagueError, setLeagueError] = useState<string | null>(null)
  const [selectedLeague, setSelectedLeague] = useState<LeagueListItem | null>(null)
  const [leaguePayload, setLeaguePayload] = useState<LeagueMockPayload['league'] | null>(null)
  const [loadingLeaguePayload, setLoadingLeaguePayload] = useState(false)
  const [draftState, setDraftState] = useState<DraftState | null>(null)
  const [queue, setQueue] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [showDrafted, setShowDrafted] = useState(false)
  const [rookiesOnly, setRookiesOnly] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [shareId, setShareId] = useState<string | null>(null)
  const [teamGrade, setTeamGrade] = useState<string | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadLeagues() {
      setLoadingLeagues(true)
      setLeagueError(null)

      try {
        const response = await fetch('/api/league/list')
        const payload = (await response.json().catch(() => ({}))) as { leagues?: unknown[]; error?: string }
        if (!response.ok) {
          throw new Error(payload.error ?? 'Could not load leagues.')
        }

        const mapped = arrayFromUnknown(payload.leagues)
          .map((entry) => normalizeLeagueFromList(entry))
          .filter((entry): entry is LeagueListItem => entry != null)
          .filter((league) => league.platform === 'sleeper' && (league.platformLeagueId != null || league.navigationLeagueId != null))

        if (!cancelled) setLeagues(mapped)
      } catch (error) {
        if (!cancelled) {
          setLeagueError(error instanceof Error ? error.message : 'Could not load leagues.')
        }
      } finally {
        if (!cancelled) setLoadingLeagues(false)
      }
    }

    void loadLeagues()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSettings((current) => {
      const nextTeamCount = Math.max(2, current.teamCount)
      const nextPickSlot = Math.min(nextTeamCount, Math.max(1, current.myPickSlot))
      if (nextPickSlot === current.myPickSlot) return current
      return { ...current, myPickSlot: nextPickSlot }
    })
  }, [settings.teamCount])

  const draftedIds = useMemo(() => new Set(draftState?.picks.map((pick) => pick.playerId) ?? []), [draftState?.picks])

  const filteredPlayers = useMemo(() => {
    if (!draftState) return []

    return draftState.availablePlayers.filter((player) => {
      if (!showDrafted && draftedIds.has(player.id)) return false
      if (rookiesOnly && !player.isRookie) return false
      if (filter !== 'All' && player.position.toUpperCase() !== filter.toUpperCase()) return false
      if (search.trim().length > 0) {
        const haystack = `${player.name} ${player.position} ${player.team} ${player.posRank}`.toLowerCase()
        if (!haystack.includes(search.trim().toLowerCase())) return false
      }
      return true
    })
  }, [draftState, draftedIds, filter, rookiesOnly, search, showDrafted])

  const onTheClockTeam = useMemo(
    () => draftState?.teams.find((team) => team.slot === draftState.onTheClock) ?? null,
    [draftState],
  )

  const isUserTurn = Boolean(onTheClockTeam?.isUser && draftState?.status === 'drafting')

  const queuePlayers = useMemo(() => {
    if (!draftState) return []
    return queue
      .map((id) => draftState.availablePlayers.find((player) => player.id === id))
      .filter((player): player is AvailablePlayer => player != null)
      .filter((player) => !draftedIds.has(player.id))
  }, [draftState, draftedIds, queue])

  const copyShareUrl = useCallback((value: string) => {
    const url = `${window.location.origin}/mock-draft/share/${value}`
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(url)
    }
  }, [])

  const callChimmy = useCallback(
    async (message: string, includeConversation: boolean) => {
      const formData = new FormData()
      formData.set('message', message)
      formData.set('source', 'mock-draft')
      formData.set('sport', draftState?.settings.sport ?? settings.sport)
      formData.set('leagueFormat', mode)
      formData.set('scoring', draftState?.settings.scoring ?? settings.scoring)
      formData.set(
        'conversation',
        JSON.stringify(
          includeConversation
            ? (draftState?.chatMessages ?? []).slice(-6).map((entry) => ({
                role: entry.role === 'ai' ? 'assistant' : 'user',
                content: entry.content,
              }))
            : [],
        ),
      )

      const response = await fetch('/api/chat/chimmy', {
        method: 'POST',
        body: formData,
      })

      const payload = (await response.json().catch(() => ({}))) as { response?: string; error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Chimmy request failed.')
      }

      return payload.response ?? 'Chimmy did not return a message.'
    },
    [draftState, mode, settings.scoring, settings.sport],
  )

  const persistDraft = useCallback(
    async (state: DraftState): Promise<SaveResponse | null> => {
      if (state.picks.length === 0) return null

      setSavingDraft(true)
      try {
        const response = await fetch('/api/mock-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            draftId,
            leagueId: leaguePayload?.leagueId ?? null,
            rounds: state.settings.rounds,
            results: {
              draftType: state.settings.draftType,
              teams: state.teams,
              picks: state.picks,
              settings: state.settings,
              completedAt: new Date().toISOString(),
            },
          }),
        })

        const payload = (await response.json().catch(() => ({}))) as Partial<SaveResponse> & { error?: string }
        if (!response.ok || !payload.draftId || !payload.shareId) {
          throw new Error(payload.error ?? 'Could not save mock draft.')
        }

        setDraftId(payload.draftId)
        setShareId(payload.shareId)
        return { draftId: payload.draftId, shareId: payload.shareId }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not save mock draft.'
        setTeamGrade((current) => current ?? message)
        return null
      } finally {
        setSavingDraft(false)
      }
    },
    [draftId, leaguePayload?.leagueId],
  )

  const handlePick = useCallback(
    (player: AvailablePlayer, isAiPick: boolean) => {
      setDraftState((current) => {
        if (!current || current.status !== 'drafting') return current
        if (draftedIds.has(player.id)) return current

        const round = Math.ceil(current.currentPick / current.settings.teamCount)
        const pickInRound = ((current.currentPick - 1) % current.settings.teamCount) + 1
        const team = current.teams.find((entry) => entry.slot === current.onTheClock)
        if (!team) return current

        const pick: DraftPick = {
          overall: current.currentPick,
          round,
          pick: pickInRound,
          slot: team.slot,
          playerId: player.id,
          playerName: player.name,
          position: player.position,
          team: player.team,
          adp: player.adp,
          projectedPts: player.projectedPts,
          aiReason: isAiPick ? generatePickReason(player, team, team.rosterNeeds, round) : undefined,
          isUser: team.isUser,
          managerName: team.managerName,
        }

        const updatedTeams = current.teams.map((entry) => {
          if (entry.slot !== team.slot) return entry
          const nextTeam = { ...entry, picks: [...entry.picks, pick] }
          return {
            ...nextTeam,
            rosterNeeds: computeTeamNeeds(nextTeam, current.settings),
          }
        })

        const nextCurrentPick = current.currentPick + 1
        const totalPicks = current.settings.rounds * current.settings.teamCount
        const nextState: DraftState = {
          ...current,
          teams: updatedTeams,
          picks: [...current.picks, pick],
          currentPick: Math.min(nextCurrentPick, totalPicks + 1),
          onTheClock:
            nextCurrentPick <= totalPicks
              ? getOnTheClockSlot(updatedTeams, current.settings, nextCurrentPick)
              : current.onTheClock,
          status: nextCurrentPick > totalPicks ? 'complete' : current.status,
          timerSeconds: current.settings.speed,
          chatMessages:
            isAiPick && pick.aiReason
              ? [...current.chatMessages, { role: 'ai', content: pick.aiReason, pick: pick.overall }]
              : current.chatMessages,
        }

        return nextState
      })
    },
    [draftedIds],
  )

  useEffect(() => {
    if (!draftState || draftState.status !== 'drafting') return

    const clockTeam = draftState.teams.find((team) => team.slot === draftState.onTheClock)
    if (!clockTeam) return

    if (clockTeam.isUser) {
      if (draftState.settings.speed === 0) return
      const interval = window.setInterval(() => {
        setDraftState((current) => {
          if (!current || current.status !== 'drafting' || current.onTheClock !== clockTeam.slot) return current
          return { ...current, timerSeconds: Math.max(0, current.timerSeconds - 1) }
        })
      }, 1000)

      return () => window.clearInterval(interval)
    }

    const delay = draftState.settings.speed === 0 ? 300 : draftState.settings.speed * 200
    const timeout = window.setTimeout(() => {
      const latestState = draftState
      const availablePlayers = latestState.availablePlayers.filter(
        (player) => !latestState.picks.some((pick) => pick.playerId === player.id),
      )
      const needs = computeTeamNeeds(clockTeam, latestState.settings)
      const scored = availablePlayers
        .map((player) => ({
          player,
          score: scorePlayerForTeam(player, clockTeam, needs, latestState.settings, latestState.picks, availablePlayers),
        }))
        .sort((left, right) => right.score - left.score)

      const topThree = scored.slice(0, 3)
      if (topThree.length === 0) return

      const random = Math.random()
      const selected =
        random > 0.9 && topThree[2]
          ? topThree[2].player
          : random > 0.65 && topThree[1]
            ? topThree[1].player
            : topThree[0].player

      handlePick(selected, true)
    }, delay)

    return () => window.clearTimeout(timeout)
  }, [draftState, handlePick, queue])

  useEffect(() => {
    if (!draftState || draftState.status !== 'drafting' || !onTheClockTeam?.isUser) return
    if (draftState.settings.speed === 0 || draftState.timerSeconds > 0) return

    const queuedPlayer = queue
      .map((id) => draftState.availablePlayers.find((player) => player.id === id))
      .find((player): player is AvailablePlayer => player != null && !draftedIds.has(player.id))

    const fallbackPlayer =
      queuedPlayer ??
      draftState.availablePlayers.find((player) => !draftedIds.has(player.id)) ??
      null

    if (fallbackPlayer) {
      handlePick(fallbackPlayer, false)
    }
  }, [draftState, draftedIds, handlePick, onTheClockTeam?.isUser, queue])

  useEffect(() => {
    if (!draftState || draftState.status !== 'complete') return
    setStep('complete')
    if (!shareId && !savingDraft) {
      void persistDraft(draftState)
    }
  }, [draftState, persistDraft, savingDraft, shareId])

  const loadLeaguePayload = useCallback(async (league: LeagueListItem) => {
    setSelectedLeague(league)
    setLoadingLeaguePayload(true)
    setLeagueError(null)

    try {
      const query = new URLSearchParams()
      const requestLeagueId = league.navigationLeagueId ?? league.unifiedLeagueId ?? league.id
      if (requestLeagueId) query.set('leagueId', requestLeagueId)
      if (league.platformLeagueId) query.set('platformLeagueId', league.platformLeagueId)
      query.set('sport', league.sport)

      const response = await fetch(`/api/mock-draft?${query.toString()}`)
      const payload = (await response.json().catch(() => ({}))) as LeagueMockPayload & { error?: string }
      if (!response.ok || !payload.league) {
        throw new Error(payload.error ?? 'Could not load league managers.')
      }

      setLeaguePayload(payload.league)
      setSettings({
        teamCount: payload.league.teamCount,
        rounds: payload.league.rounds,
        draftType: payload.league.draftType,
        sport: payload.league.sport,
        scoring: payload.league.scoring,
        superflex: payload.league.superflex,
        myPickSlot: payload.league.detectedUserSlot,
        speed: 15,
      })
    } catch (error) {
      setLeagueError(error instanceof Error ? error.message : 'Could not load league managers.')
    } finally {
      setLoadingLeaguePayload(false)
    }
  }, [])

  useEffect(() => {
    if (!queryLeagueId || autoLoadedLeagueRef.current === queryLeagueId || loadingLeagues) return
    const match = leagues.find((league) =>
      [league.id, league.navigationLeagueId, league.unifiedLeagueId, league.platformLeagueId]
        .filter(Boolean)
        .some((value) => String(value) === queryLeagueId),
    )
    if (!match) {
      const fallbackLeague: LeagueListItem = {
        id: queryLeagueId,
        name: 'League mock draft',
        platform: 'allfantasy',
        platformLeagueId: null,
        sport: querySport,
        scoring: 'Standard',
        teamCount: 12,
        isDynasty: false,
        synced: true,
        navigationLeagueId: queryLeagueId,
        unifiedLeagueId: queryLeagueId,
      }
      autoLoadedLeagueRef.current = queryLeagueId
      setMode('league')
      setStep('league')
      void loadLeaguePayload(fallbackLeague)
      return
    }
    autoLoadedLeagueRef.current = queryLeagueId
    setMode('league')
    setStep('league')
    void loadLeaguePayload(match)
  }, [leagues, loadLeaguePayload, loadingLeagues, queryLeagueId, querySport])

  const loadPlayers = useCallback(async (nextSettings: DraftSettings): Promise<AvailablePlayer[]> => {
    const type = selectedLeague?.isDynasty ? 'dynasty' : 'redraft'
    const pool = selectedLeague?.isDynasty ? 'combined' : 'vet'
    const params = new URLSearchParams({
      type,
      pool,
      limit: '300',
      sport: nextSettings.sport.toLowerCase(),
      leagueId: selectedLeague?.id ?? '',
      draftType: nextSettings.draftType,
      scoring: nextSettings.scoring,
      teamCount: String(nextSettings.teamCount),
    })
    const response = await fetch(`/api/mock-draft/adp?${params.toString()}`)
    const payload = (await response.json().catch(() => ({}))) as { entries?: unknown[]; error?: string }
    if (!response.ok) {
      throw new Error(payload.error ?? 'Could not load player pool.')
    }

    const mapped = arrayFromUnknown(payload.entries)
      .map((entry, index) => {
        const raw = recordFromUnknown(entry)
        if (!raw) return null

        const name = stringFromUnknown(raw.name)
        const position = stringFromUnknown(raw.position)
        if (!name || !position) return null

        return {
          id: stringFromUnknown(raw.playerId) ?? stringFromUnknown(raw.sleeperId) ?? `${name}-${position}-${index}`,
          name,
          position,
          team: stringFromUnknown(raw.team) ?? '',
          adp: numberFromUnknown(raw.adp) ?? index + 1,
          projectedPts: numberFromUnknown(raw.value) ?? Math.max(0, 250 - index),
          ownership: numberFromUnknown(raw.timesDrafted) ?? Math.max(10, 95 - index / 4),
          injuryStatus: stringFromUnknown(raw.injuryStatus),
          tier: Math.max(1, Math.ceil((index + 1) / 12)),
          posRank: `${position}${index + 1}`,
          isRookie: raw.isRookie === true,
        } satisfies AvailablePlayer
      })
      .filter((player): player is AvailablePlayer => player != null)
      .sort((left, right) => left.adp - right.adp)

    return mapped
  }, [selectedLeague?.id, selectedLeague?.isDynasty])

  const startDraft = useCallback(async () => {
    try {
      const players = await loadPlayers(settings)
      const teams =
        mode === 'league' && leaguePayload
          ? createLeagueMockTeams(leaguePayload, settings)
          : createOpenMockTeams(settings)

      const initialState: DraftState = {
        settings,
        teams,
        availablePlayers: players,
        picks: [],
        currentPick: 1,
        onTheClock: getOnTheClockSlot(teams, settings, 1),
        status: 'drafting',
        timerSeconds: settings.speed,
        chatMessages: [
          {
            role: 'ai',
            content:
              mode === 'league' && leaguePayload
                ? `Loaded ${leaguePayload.leagueName}. Draft room is live.`
                : 'Open mock is ready. AI will handle every non-user pick.',
          },
        ],
      }

      setDraftState(initialState)
      setQueue([])
      setSearch('')
      setFilter('All')
      setShowDrafted(false)
      setRookiesOnly(false)
      setChatInput('')
      setDraftId(null)
      setShareId(null)
      setTeamGrade(null)
      setStep('draft')
    } catch (error) {
      setLeagueError(error instanceof Error ? error.message : 'Could not start draft.')
    }
  }, [leaguePayload, loadPlayers, mode, settings])

  const askAi = useCallback(async () => {
    if (!draftState || chatLoading) return

    setChatLoading(true)
    try {
      const response = await callChimmy(
        `${buildPlayerContextMessage(draftState, queue)} Give me the best recommendation for this spot.`,
        true,
      )
      setDraftState((current) =>
        current
          ? {
              ...current,
              chatMessages: [...current.chatMessages, { role: 'ai', content: response, pick: current.currentPick }],
            }
          : current,
      )
    } catch (error) {
      setDraftState((current) =>
        current
          ? {
              ...current,
              chatMessages: [
                ...current.chatMessages,
                {
                  role: 'ai',
                  content: error instanceof Error ? error.message : 'Chimmy could not answer right now.',
                },
              ],
            }
          : current,
      )
    } finally {
      setChatLoading(false)
    }
  }, [callChimmy, chatLoading, draftState, queue])

  const sendChat = useCallback(async () => {
    if (!draftState || chatLoading || chatInput.trim().length === 0) return

    const message = chatInput.trim()
    setChatInput('')
    setChatLoading(true)
    setDraftState((current) =>
      current
        ? {
            ...current,
            chatMessages: [...current.chatMessages, { role: 'user', content: message }],
          }
        : current,
    )

    try {
      const response = await callChimmy(
        `${buildPlayerContextMessage(draftState, queue)} User question: ${message}`,
        true,
      )
      setDraftState((current) =>
        current
          ? {
              ...current,
              chatMessages: [...current.chatMessages, { role: 'ai', content: response }],
            }
          : current,
      )
    } catch (error) {
      setDraftState((current) =>
        current
          ? {
              ...current,
              chatMessages: [
                ...current.chatMessages,
                {
                  role: 'ai',
                  content: error instanceof Error ? error.message : 'Chimmy could not answer right now.',
                },
              ],
            }
          : current,
      )
    } finally {
      setChatLoading(false)
    }
  }, [callChimmy, chatInput, chatLoading, draftState, queue])

  const gradeMyTeam = useCallback(async () => {
    if (!draftState || draftState.status !== 'complete' || chatLoading) return

    setChatLoading(true)
    try {
      const myTeam = draftState.teams.find((team) => team.isUser)
      const myPicks = myTeam?.picks.map((pick) => `${pick.playerName} (${pick.position})`).join(', ') ?? 'No picks'
      const message = [
        `Grade my ${draftState.settings.sport} mock draft team from A to F.`,
        `League settings: ${draftState.settings.teamCount} teams, ${draftState.settings.rounds} rounds, ${draftState.settings.scoring}, ${draftState.settings.draftType}.`,
        `My picks: ${myPicks}.`,
        'Give one clear grade and a compact strengths / weaknesses breakdown.',
      ].join(' ')

      const response = await callChimmy(message, false)
      setTeamGrade(response)
      setDraftState((current) =>
        current
          ? {
              ...current,
              chatMessages: [...current.chatMessages, { role: 'ai', content: response }],
            }
          : current,
      )
    } catch (error) {
      setTeamGrade(error instanceof Error ? error.message : 'Could not grade team.')
    } finally {
      setChatLoading(false)
    }
  }, [callChimmy, chatLoading, draftState])

  const exportDraft = useCallback(() => {
    if (!draftState) return
    const blob = new Blob(
      [
        JSON.stringify(
          {
            draftType: draftState.settings.draftType,
            teams: draftState.teams,
            picks: draftState.picks,
            settings: draftState.settings,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `mock-draft-${Date.now()}.json`
    anchor.click()
    window.URL.revokeObjectURL(url)
  }, [draftState])

  const resetToSetup = useCallback(() => {
    if (!window.confirm('Reset this mock draft and go back to setup?')) return
    setDraftState(null)
    setQueue([])
    setShareId(null)
    setDraftId(null)
    setTeamGrade(null)
    setStep(mode === 'league' ? 'league' : 'open')
  }, [mode])

  const draftAgain = useCallback(() => {
    void startDraft()
  }, [startDraft])

  const shareDraft = useCallback(async () => {
    if (!draftState) return
    if (!shareId) {
      const saved = await persistDraft(draftState)
      if (!saved?.shareId) return
      copyShareUrl(saved.shareId)
      return
    }
    copyShareUrl(shareId)
  }, [copyShareUrl, draftState, persistDraft, shareId])

  const currentRosterSlots = useMemo(
    () => (draftState && onTheClockTeam ? assignRosterSlots(onTheClockTeam.picks, draftState.settings) : []),
    [draftState, onTheClockTeam],
  )

  const availableFilters = useMemo(() => {
    if (!draftState) return ['All']
    const positions = Array.from(new Set(draftState.availablePlayers.map((player) => player.position)))
    return ['All', ...positions]
  }, [draftState])

  function renderLeagueGate() {
    return (
      <div className="min-h-screen bg-[#070b16] text-white">
        <div className="border-b border-white/6 bg-[#070b16]/95 backdrop-blur-xl">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
            <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300">League Mock</div>
            <h1 className="mt-3 text-3xl font-black">Select a Sleeper league</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/50">
              Import real managers, avatars, and draft slots when Sleeper has them. If order is not set yet, AllFantasy predicts it from team records.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="mb-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep('entry')}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:border-white/20 hover:text-white"
              data-testid="mock-draft-back-entry"
            >
              Back
            </button>
          </div>

          {loadingLeagues ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="h-28 animate-pulse rounded-3xl border border-white/8 bg-[#0c1224]" />
              ))}
            </div>
          ) : null}

          {leagueError ? (
            <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
              {leagueError}
            </div>
          ) : null}

          {!loadingLeagues && leagues.length === 0 ? (
            <div className="rounded-3xl border border-white/8 bg-[#0c1224] p-8 text-center text-sm text-white/55">
              No Sleeper leagues are available on this account yet.
            </div>
          ) : null}

          {!loadingLeagues && leagues.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {leagues.map((league) => (
                <button
                  key={league.id}
                  type="button"
                  onClick={() => void loadLeaguePayload(league)}
                  className={`rounded-3xl border p-5 text-left transition-all ${
                    selectedLeague?.id === league.id
                      ? 'border-cyan-400/40 bg-cyan-500/10'
                      : 'border-white/8 bg-[#0c1224] hover:border-white/15 hover:bg-white/[0.03]'
                  }`}
                  data-testid={`mock-draft-league-card-${league.id}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-200">
                        Sleeper
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/50">
                        {league.sport}
                      </span>
                    </div>
                    <span className={`text-xs ${league.synced ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {league.synced ? 'Ready' : 'Fallback'}
                    </span>
                  </div>
                  <div className="mt-4 text-lg font-bold text-white">{league.name}</div>
                  <div className="mt-2 text-sm text-white/45">
                    {league.teamCount} teams · {league.scoring} · {league.isDynasty ? 'Dynasty' : 'Redraft'}
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {selectedLeague && loadingLeaguePayload ? (
            <div className="mt-6 rounded-3xl border border-white/8 bg-[#0c1224] p-6 text-sm text-white/60">
              Loading managers and Sleeper draft settings...
            </div>
          ) : null}

          {leaguePayload ? (
            <div className="mt-6 rounded-3xl border border-white/8 bg-[#0c1224] p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300">
                    {leaguePayload.leagueName}
                  </div>
                  <h2 className="mt-2 text-2xl font-black">Draft room preview</h2>
                  <p className="mt-2 text-sm text-white/50">
                    {leaguePayload.teamCount} teams · {leaguePayload.rounds} rounds · {leaguePayload.scoring} · {leaguePayload.draftType}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">My seat</span>
                    <select
                      value={settings.myPickSlot}
                      onChange={(event) => setSettings((current) => ({ ...current, myPickSlot: Number(event.target.value) }))}
                      className="rounded-xl border border-white/10 bg-[#070b16] px-3 py-2 text-sm text-white focus:outline-none"
                      data-testid="mock-draft-league-seat-select"
                    >
                      {leaguePayload.managers.map((manager) => (
                        <option key={manager.slot} value={manager.slot}>
                          Pick {manager.slot}: {manager.managerName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">Draft speed</span>
                    <select
                      value={settings.speed}
                      onChange={(event) => setSettings((current) => ({ ...current, speed: Number(event.target.value) as DraftSpeed }))}
                      className="rounded-xl border border-white/10 bg-[#070b16] px-3 py-2 text-sm text-white focus:outline-none"
                      data-testid="mock-draft-league-speed-select"
                    >
                      {SPEED_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                {leaguePayload.managers.map((manager) => (
                  <div
                    key={manager.slot}
                    className={`rounded-2xl border p-3 ${
                      settings.myPickSlot === manager.slot
                        ? 'border-cyan-400/40 bg-cyan-500/10'
                        : 'border-white/8 bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06] text-sm font-black text-white">
                        {manager.avatarUrl ? (
                          <img src={manager.avatarUrl} alt={manager.managerName} className="h-full w-full object-cover" />
                        ) : (
                          manager.managerName.slice(0, 1).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <div className="truncate text-sm font-semibold text-white">{manager.managerName}</div>
                          <ManagerRoleBadge role={manager.isOrphan ? 'orphan' : manager.role ?? 'member'} />
                        </div>
                        <div className="text-[11px] text-white/40">
                          Slot {manager.slot}
                          {manager.slotPredicted ? ' (predicted)' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-[11px] text-white/45">
                      {manager.record.wins}-{manager.record.losses}-{manager.record.ties} · {manager.record.pointsFor.toFixed(1)} PF
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void startDraft()}
                  className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-black text-black shadow-[0_12px_30px_rgba(6,182,212,0.25)] hover:bg-cyan-400"
                  data-testid="mock-draft-league-start"
                >
                  Start Draft
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLeaguePayload(null)
                    setSelectedLeague(null)
                  }}
                  className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/60 hover:border-white/20 hover:text-white"
                >
                  Change League
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  function renderChipGroup<T extends string | number>(args: {
    label: string
    value: T
    options: Array<{ value: T; label: string }>
    onChange: (value: T) => void
    testPrefix: string
  }) {
    return (
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">{args.label}</div>
        <div className="flex flex-wrap gap-2">
          {args.options.map((option) => (
            <button
              key={`${args.testPrefix}-${option.value}`}
              type="button"
              onClick={() => args.onChange(option.value)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition-all ${
                args.value === option.value
                  ? 'bg-cyan-500 text-black'
                  : 'bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white'
              }`}
              data-testid={`${args.testPrefix}-${String(option.value)}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  function renderOpenSetup() {
    return (
      <div className="min-h-screen bg-[#070b16] text-white">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <div className="mb-6 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep('entry')}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:border-white/20 hover:text-white"
            >
              Back
            </button>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300">Open Mock</div>
              <h1 className="mt-2 text-3xl font-black">Configure your room</h1>
            </div>
          </div>

          <div className="rounded-3xl border border-white/8 bg-[#0c1224] p-6">
            <div className="grid gap-6 md:grid-cols-2">
              {renderChipGroup({
                label: 'Teams',
                value: settings.teamCount,
                options: [8, 10, 12, 14].map((value) => ({ value, label: String(value) })),
                onChange: (value) => setSettings((current) => ({ ...current, teamCount: value })),
                testPrefix: 'mock-draft-open-teams',
              })}
              {renderChipGroup({
                label: 'Rounds',
                value: settings.rounds,
                options: [10, 12, 15, 18, 20].map((value) => ({ value, label: String(value) })),
                onChange: (value) => setSettings((current) => ({ ...current, rounds: value })),
                testPrefix: 'mock-draft-open-rounds',
              })}
              {renderChipGroup({
                label: 'Format',
                value: settings.draftType,
                options: [
                  { value: 'snake', label: 'Snake' },
                  { value: 'auction', label: 'Auction' },
                  { value: 'linear', label: 'Linear' },
                ],
                onChange: (value) => setSettings((current) => ({ ...current, draftType: value })),
                testPrefix: 'mock-draft-open-format',
              })}
              {renderChipGroup({
                label: 'Sport',
                value: settings.sport,
                options: SUPPORTED_SPORTS.map((value) => ({ value, label: value })),
                onChange: (value) =>
                  setSettings((current) => ({
                    ...current,
                    sport: value,
                    scoring: isFootballSport(value) ? 'PPR' : 'Points',
                    superflex: isFootballSport(value) ? current.superflex : false,
                  })),
                testPrefix: 'mock-draft-open-sport',
              })}
              {renderChipGroup({
                label: 'Scoring',
                value: settings.scoring,
                options: isFootballScoring(settings).map((value) => ({ value, label: value })),
                onChange: (value) => setSettings((current) => ({ ...current, scoring: value })),
                testPrefix: 'mock-draft-open-scoring',
              })}
              {renderChipGroup({
                label: 'Draft speed',
                value: settings.speed,
                options: SPEED_OPTIONS,
                onChange: (value) => setSettings((current) => ({ ...current, speed: value })),
                testPrefix: 'mock-draft-open-speed',
              })}
              {isFootballSport(settings.sport) ? (
                renderChipGroup({
                  label: 'QB Format',
                  value: settings.superflex ? 'superflex' : '1qb',
                  options: [
                    { value: '1qb', label: '1QB' },
                    { value: 'superflex', label: 'Superflex' },
                  ],
                  onChange: (value) => setSettings((current) => ({ ...current, superflex: value === 'superflex' })),
                  testPrefix: 'mock-draft-open-qb',
                })
              ) : (
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm text-white/50">
                  Position format is sport-aware for {settings.sport}. Flexible utility slots are applied automatically.
                </div>
              )}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">My pick slot</div>
                <select
                  value={settings.myPickSlot}
                  onChange={(event) => setSettings((current) => ({ ...current, myPickSlot: Number(event.target.value) }))}
                  className="w-full rounded-xl border border-white/10 bg-[#070b16] px-3 py-3 text-sm text-white focus:outline-none"
                  data-testid="mock-draft-open-pick-slot"
                >
                  {Array.from({ length: settings.teamCount }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>
                      Pick Slot {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void startDraft()}
                className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-black text-black shadow-[0_12px_30px_rgba(6,182,212,0.25)] hover:bg-cyan-400"
                data-testid="mock-draft-open-start"
              >
                Start Draft
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderEntry() {
    return (
      <div className="min-h-screen bg-[#070b16] px-4 py-10 text-white sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-[32px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.15),transparent_42%),#0a1124] p-6 sm:p-8">
            <div className="max-w-2xl">
              <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-300">Mock Draft Simulator</div>
              <h1 className="mt-4 text-3xl font-black sm:text-4xl">AI-powered drafting for every team in your league</h1>
              <p className="mt-3 text-sm leading-6 text-white/55">
                Import a real Sleeper league for actual managers and draft slots, or build a custom room from scratch and let AllFantasy AI handle every other pick.
              </p>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/8 bg-[#0c1224] p-6">
                <div className="text-xs font-bold uppercase tracking-[0.24em] text-indigo-300">League Mock</div>
                <h2 className="mt-3 text-2xl font-black">Import a real league</h2>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Use real manager names, Sleeper avatars, and exact draft positions when the league already has order locked in.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode('league')
                    setStep('league')
                  }}
                  className="mt-6 rounded-2xl bg-indigo-500 px-4 py-3 text-sm font-black text-white hover:bg-indigo-400"
                  data-testid="mock-draft-entry-league"
                >
                  Select League
                </button>
              </div>

              <div className="rounded-3xl border border-white/8 bg-[#0c1224] p-6">
                <div className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-300">Open Mock</div>
                <h2 className="mt-3 text-2xl font-black">Custom draft room</h2>
                <p className="mt-3 text-sm leading-6 text-white/50">
                  Pick the team count, rounds, draft type, sport, scoring, and your slot. AI drafts every other team locally.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMode('open')
                    setStep('open')
                  }}
                  className="mt-6 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-black hover:bg-cyan-400"
                  data-testid="mock-draft-entry-open"
                >
                  Configure Draft
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderDraftBoard() {
    if (!draftState) return null

    const playerPanel = (
      <div className="flex h-full flex-col bg-[#0c0c1e]">
        {isUserTurn && draftState.settings.speed > 0 ? (
          <div className="h-1.5 w-full bg-white/5">
            <div
              className={`h-full ${draftState.timerSeconds <= 5 ? 'bg-red-500' : 'bg-cyan-500'}`}
              style={{
                width: `${Math.max(0, Math.min(100, (draftState.timerSeconds / draftState.settings.speed) * 100))}%`,
              }}
            />
          </div>
        ) : null}

        <div className="border-b border-white/8 p-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/35">Queue</div>
          <div className="mt-3 space-y-2">
            {queuePlayers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-xs text-white/30">
                Right-click a player to queue them.
              </div>
            ) : (
              queuePlayers.map((player, index) => (
                <div key={player.id} className="rounded-xl border border-orange-400/20 bg-orange-500/10 p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-black text-orange-200">
                      #{index + 1}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${positionLabelColor(player.position)}`}>
                      {player.position}
                    </span>
                    <span className="truncate font-semibold text-white">{player.name}</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setQueue((current) => {
                          if (index === 0) return current
                          const next = [...current]
                          const [entry] = next.splice(index, 1)
                          next.splice(index - 1, 0, entry)
                          return next
                        })
                      }
                      className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/55 hover:text-white"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setQueue((current) => {
                          if (index === current.length - 1) return current
                          const next = [...current]
                          const [entry] = next.splice(index, 1)
                          next.splice(index + 1, 0, entry)
                          return next
                        })
                      }
                      className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-white/55 hover:text-white"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() => setQueue((current) => current.filter((id) => id !== player.id))}
                      className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-red-300/75 hover:text-red-200"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-b border-white/8 p-3">
          <div className="flex flex-wrap items-center gap-1">
            {availableFilters.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`rounded-lg px-2 py-1 text-[10px] font-black ${
                  filter === option ? 'bg-cyan-500 text-black' : 'bg-white/8 text-white/50'
                }`}
                data-testid={`mock-draft-filter-${option}`}
              >
                {option}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search players..."
            className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none"
            data-testid="mock-draft-player-search"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-white/45">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={showDrafted} onChange={(event) => setShowDrafted(event.target.checked)} />
              Show Drafted
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={rookiesOnly} onChange={(event) => setRookiesOnly(event.target.checked)} />
              Rookies Only
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filteredPlayers.map((player, index) => {
            const drafted = draftedIds.has(player.id)
            const queued = queue.includes(player.id) && !drafted
            return (
              <button
                key={player.id}
                type="button"
                onContextMenu={(event) => {
                  event.preventDefault()
                  if (drafted) return
                  setQueue((current) => (current.includes(player.id) ? current : [...current, player.id]))
                }}
                onClick={() => {
                  if (drafted || !isUserTurn) return
                  handlePick(player, false)
                }}
                className={`mb-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-all ${
                  isUserTurn && !drafted ? 'hover:bg-white/8' : 'cursor-default'
                } ${drafted ? 'opacity-45' : ''} ${player.injuryStatus === 'OUT' ? 'opacity-50' : ''}`}
                data-testid={`mock-draft-player-row-${player.id}`}
              >
                <div className="w-4 text-xs text-white/25">{index + 1}</div>
                <div className={`w-8 rounded px-1 py-0.5 text-center text-[10px] font-black ${positionLabelColor(player.position)}`}>
                  {player.position}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-white/85">{player.name}</div>
                  <div className="text-[10px] text-white/30">
                    {player.team || 'FA'} · {player.posRank}
                  </div>
                </div>
                {queued ? (
                  <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[9px] font-black text-orange-200">
                    QUEUED
                  </span>
                ) : null}
                {player.injuryStatus ? (
                  <span className="text-[9px] font-black text-red-300">{player.injuryStatus}</span>
                ) : null}
                <div className="text-[10px] font-mono text-white/40">{player.adp.toFixed(1)}</div>
              </button>
            )
          })}
        </div>
      </div>
    )

    const rosterAndChatPanel = (
      <div className="flex h-full flex-col bg-[#0c0c1e]">
        <div className="border-b border-white/8 p-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
            {onTheClockTeam?.isUser ? 'Your Roster' : `${onTheClockTeam?.managerName ?? 'Current Team'} Roster`}
          </div>
          <div className="mt-3 space-y-1">
            {getRosterSlots(draftState.settings).map((slot, index) => (
              <div key={`${slot}-${index}`} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5">
                <span className={`w-12 rounded px-1 py-0.5 text-center text-[9px] font-black ${positionLabelColor(slot)}`}>
                  {slot}
                </span>
                {currentRosterSlots[index] ? (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-white/75">{currentRosterSlots[index]?.playerName}</span>
                    <span className="text-[9px] text-white/30">{currentRosterSlots[index]?.team}</span>
                  </>
                ) : (
                  <span className="text-[10px] italic text-white/20">Empty</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">Chat</div>
          <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
            {draftState.chatMessages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`rounded-lg px-2 py-1.5 text-[10px] ${
                  message.role === 'ai'
                    ? 'bg-cyan-500/10 text-cyan-100'
                    : 'bg-white/5 text-white/65'
                }`}
              >
                {message.content}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void sendChat()
              }}
              placeholder="Type a message..."
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:outline-none"
              data-testid="mock-draft-chat-input"
            />
            <button
              type="button"
              onClick={() => void sendChat()}
              className="rounded-xl bg-white/10 px-3 py-2 text-xs text-white/70 hover:text-white"
              data-testid="mock-draft-chat-send"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => void askAi()}
              className="rounded-xl bg-[linear-gradient(135deg,#7c3aed,#0891b2)] px-3 py-2 text-xs font-bold text-white"
              data-testid="mock-draft-ask-ai"
            >
              Ask AI
            </button>
          </div>
        </div>
      </div>
    )

    return (
      <div className="min-h-screen bg-[#0a0a18] text-white">
        <div className="border-b border-white/6 bg-[#070b16]/95 backdrop-blur-xl">
          <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-300">
                  {leaguePayload?.leagueName ?? 'Open Mock'}
                </div>
                <h1 className="mt-1 text-2xl font-black">Sleeper-style draft room</h1>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/60">
                {draftState.settings.scoring} · {draftState.settings.teamCount} teams · {draftState.settings.rounds} rounds · {draftState.settings.draftType}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {draftState.status === 'drafting' ? (
                  <button
                    type="button"
                    onClick={() => setDraftState((current) => (current ? { ...current, status: 'paused' } : current))}
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:border-white/20 hover:text-white"
                    data-testid="mock-draft-pause"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setDraftState((current) =>
                        current && current.status !== 'complete'
                          ? { ...current, status: 'drafting', timerSeconds: current.settings.speed }
                          : current,
                      )
                    }
                    className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:border-white/20 hover:text-white"
                    data-testid="mock-draft-resume"
                  >
                    Resume
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetToSetup}
                  className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:border-white/20 hover:text-white"
                  data-testid="mock-draft-reset"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={exportDraft}
                  className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:border-white/20 hover:text-white"
                  data-testid="mock-draft-export"
                >
                  Export
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/60 hover:border-white/20 hover:text-white"
                  data-testid="mock-draft-settings-open"
                >
                  Settings
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
          <div className="hidden gap-0 overflow-hidden rounded-3xl border border-white/8 bg-[#0c0c1e] lg:grid lg:grid-cols-[260px_minmax(0,1fr)_240px]">
            <div className="min-h-[78vh] border-r border-white/8">{playerPanel}</div>
            <div className="min-h-[78vh] overflow-auto">
              <div className="min-w-[960px]">
                <div
                  className="grid border-b border-white/6"
                  style={{ gridTemplateColumns: `repeat(${draftState.settings.teamCount}, minmax(110px, 1fr))` }}
                >
                  {draftState.teams.map((team) => (
                    <div key={team.slot} className="border-r border-white/6 p-2 text-center">
                      <div
                        className={`mx-auto mb-1 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 ${
                          team.isUser ? 'border-cyan-400' : 'border-white/20'
                        }`}
                      >
                        {team.avatarUrl ? (
                          <img src={team.avatarUrl} alt={team.managerName} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-500/30 to-cyan-500/30 text-xs font-black text-white">
                            {team.managerName.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-center gap-1">
                        <div className="truncate text-[10px] font-bold text-white/70">{team.managerName}</div>
                        <ManagerRoleBadge role={team.isOrphan ? 'orphan' : team.role ?? 'member'} />
                      </div>
                      {team.isUser ? <div className="text-[9px] text-cyan-400">YOU</div> : null}
                      {team.slotPredicted ? <div className="text-[9px] text-amber-300">(predicted)</div> : null}
                    </div>
                  ))}
                </div>

                {Array.from({ length: draftState.settings.rounds }, (_, roundIndex) => {
                  const round = roundIndex + 1
                  const orderedTeams = getRoundOrder(draftState.teams, round, draftState.settings.draftType)
                  return (
                    <div
                      key={round}
                      className="grid border-b border-white/6"
                      style={{ gridTemplateColumns: `repeat(${draftState.settings.teamCount}, minmax(110px, 1fr))` }}
                    >
                      {orderedTeams.map((team, pickIndex) => {
                        const overallPick = (round - 1) * draftState.settings.teamCount + pickIndex + 1
                        const pick = draftState.picks.find((entry) => entry.overall === overallPick)
                        const onClock = draftState.currentPick === overallPick && draftState.status === 'drafting'
                        return (
                          <div
                            key={`${team.slot}-${overallPick}`}
                            className={`min-h-[52px] border-r border-white/6 p-1.5 transition-all ${
                              onClock
                                ? 'bg-cyan-500/15 ring-1 ring-cyan-400/40'
                                : team.isUser
                                  ? 'bg-violet-500/5'
                                  : ''
                            } ${isUserTurn && !pick ? 'hover:bg-white/[0.04]' : ''}`}
                          >
                            <div className="mb-1 text-[9px] text-white/20">
                              {round}.{String(pickIndex + 1).padStart(2, '0')}
                            </div>
                            {pick ? (
                              <div>
                                <div className={`mb-0.5 inline-flex rounded px-1 py-0.5 text-[9px] font-black ${positionLabelColor(pick.position)}`}>
                                  {pick.position}
                                </div>
                                <div className="truncate text-[10px] font-semibold leading-tight text-white/85">
                                  {pick.playerName}
                                </div>
                                <div className="truncate text-[9px] text-white/30">{pick.team || 'FA'}</div>
                                {pick.aiReason && !pick.isUser ? (
                                  <div className="mt-0.5 line-clamp-1 text-[8px] italic leading-tight text-cyan-300/70">
                                    {pick.aiReason}
                                  </div>
                                ) : null}
                              </div>
                            ) : onClock ? (
                              <div className="flex h-8 items-center justify-center">
                                <div className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="min-h-[78vh] border-l border-white/8">{rosterAndChatPanel}</div>
          </div>

          <div className="lg:hidden">
            <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-4">
              <div className="mb-4 flex items-center justify-between text-xs text-white/50">
                <span>
                  Pick #{draftState.currentPick} · {onTheClockTeam?.managerName ?? 'Unknown'}
                </span>
                <span>{draftState.status}</span>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[960px]">
                  <div
                    className="grid border-b border-white/6"
                    style={{ gridTemplateColumns: `repeat(${draftState.settings.teamCount}, minmax(110px, 1fr))` }}
                  >
                    {draftState.teams.map((team) => (
                      <div key={team.slot} className="border-r border-white/6 p-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <div className="truncate text-[10px] font-bold text-white/70">{team.managerName}</div>
                          <ManagerRoleBadge role={team.isOrphan ? 'orphan' : team.role ?? 'member'} />
                        </div>
                        {team.isUser ? <div className="text-[9px] text-cyan-400">YOU</div> : null}
                      </div>
                    ))}
                  </div>
                  {Array.from({ length: draftState.settings.rounds }, (_, roundIndex) => {
                    const round = roundIndex + 1
                    const orderedTeams = getRoundOrder(draftState.teams, round, draftState.settings.draftType)
                    return (
                      <div
                        key={round}
                        className="grid border-b border-white/6"
                        style={{ gridTemplateColumns: `repeat(${draftState.settings.teamCount}, minmax(110px, 1fr))` }}
                      >
                        {orderedTeams.map((team, pickIndex) => {
                          const overallPick = (round - 1) * draftState.settings.teamCount + pickIndex + 1
                          const pick = draftState.picks.find((entry) => entry.overall === overallPick)
                          return (
                            <div key={`${team.slot}-${overallPick}`} className="min-h-[52px] border-r border-white/6 p-1.5">
                              <div className="mb-1 text-[9px] text-white/20">
                                {round}.{String(pickIndex + 1).padStart(2, '0')}
                              </div>
                              {pick ? (
                                <>
                                  <div className={`inline-flex rounded px-1 py-0.5 text-[9px] font-black ${positionLabelColor(pick.position)}`}>
                                    {pick.position}
                                  </div>
                                  <div className="truncate text-[10px] font-semibold text-white/85">{pick.playerName}</div>
                                </>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="sticky bottom-4 mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setMobilePanel('players')}
                className="flex-1 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-black"
              >
                Players
              </button>
              <button
                type="button"
                onClick={() => setMobilePanel('roster')}
                className="flex-1 rounded-2xl border border-white/10 bg-[#0c1224] px-4 py-3 text-sm font-black text-white"
              >
                Roster
              </button>
              <button
                type="button"
                onClick={() => setMobilePanel('chat')}
                className="flex-1 rounded-2xl border border-white/10 bg-[#0c1224] px-4 py-3 text-sm font-black text-white"
              >
                Chat
              </button>
            </div>
          </div>
        </div>

        {mobilePanel ? (
          <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobilePanel(null)}>
            <div
              className="absolute bottom-0 left-0 right-0 max-h-[82vh] overflow-hidden rounded-t-[28px] border border-white/8 bg-[#0c1224]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                <div className="text-sm font-bold text-white">
                  {mobilePanel === 'players' ? 'Players' : mobilePanel === 'roster' ? 'Current Roster' : 'Draft Chat'}
                </div>
                <button type="button" onClick={() => setMobilePanel(null)} className="text-white/60">
                  Close
                </button>
              </div>
              <div className="max-h-[72vh] overflow-y-auto">
                {mobilePanel === 'players' ? playerPanel : mobilePanel === 'roster' || mobilePanel === 'chat' ? rosterAndChatPanel : null}
              </div>
            </div>
          </div>
        ) : null}

        {settingsOpen && draftState ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-xl rounded-3xl border border-white/8 bg-[#0c1224] p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-300">Draft Settings</div>
                  <h2 className="mt-2 text-2xl font-black">Live room controls</h2>
                </div>
                <button type="button" onClick={() => setSettingsOpen(false)} className="text-white/60">
                  Close
                </button>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">Speed</span>
                  <select
                    value={draftState.settings.speed}
                    onChange={(event) => {
                      const nextSpeed = Number(event.target.value) as DraftSpeed
                      setDraftState((current) =>
                        current
                          ? {
                              ...current,
                              settings: { ...current.settings, speed: nextSpeed },
                              timerSeconds: nextSpeed,
                            }
                          : current,
                      )
                    }}
                    className="w-full rounded-xl border border-white/10 bg-[#070b16] px-3 py-3 text-sm text-white"
                  >
                    {SPEED_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">Scoring</span>
                  <select
                    value={draftState.settings.scoring}
                    onChange={(event) =>
                      setDraftState((current) =>
                        current
                          ? {
                              ...current,
                              settings: { ...current.settings, scoring: event.target.value as DraftScoring },
                              teams: current.teams.map((team) => ({
                                ...team,
                                rosterNeeds: computeTeamNeeds(team, {
                                  ...current.settings,
                                  scoring: event.target.value as DraftScoring,
                                }),
                              })),
                            }
                          : current,
                      )
                    }
                    className="w-full rounded-xl border border-white/10 bg-[#070b16] px-3 py-3 text-sm text-white"
                  >
                    {isFootballScoring(draftState.settings).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  function renderCompletion() {
    const myTeam = draftState?.teams.find((team) => team.isUser)
    const sourceLeagueId =
      leaguePayload?.leagueId ??
      selectedLeague?.navigationLeagueId ??
      selectedLeague?.unifiedLeagueId ??
      selectedLeague?.id ??
      null
    const sourceLeaguePath = sourceLeagueId ? encodeURIComponent(sourceLeagueId) : null
    const shareUrl = shareId && typeof window !== 'undefined'
      ? `${window.location.origin}/mock-draft/share/${shareId}`
      : null
    return (
      <div className="min-h-screen bg-[#070b16] px-4 py-10 text-white sm:px-6">
        <div className="mx-auto max-w-4xl rounded-[32px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.14),transparent_40%),#0a1124] p-6 sm:p-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-300">Mock Draft Complete</div>
          <h1 className="mt-4 text-3xl font-black">
            {leaguePayload?.leagueName ? `Your ${leaguePayload.leagueName} mock draft is finished` : 'Your mock draft is finished'}
          </h1>
          <p className="mt-3 text-sm text-white/55">
            {myTeam?.managerName ?? 'Your team'} finished with {myTeam?.picks.length ?? 0} picks.
          </p>

          {myTeam ? (
            <div className="mt-6 rounded-3xl border border-white/8 bg-[#0c1224] p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/40">Your Picks</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {myTeam.picks.map((pick) => (
                  <div key={pick.overall} className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                    <div className="mb-2 text-[10px] text-white/35">#{pick.overall}</div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${positionLabelColor(pick.position)}`}>
                        {pick.position}
                      </span>
                      <span className="truncate text-sm font-semibold text-white">{pick.playerName}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-white/35">{pick.team || 'FA'} · ADP {pick.adp.toFixed(1)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {sourceLeaguePath ? (
              <a
                href={`/league/${sourceLeaguePath}`}
                className="rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3 text-sm font-bold text-cyan-100 hover:bg-cyan-500/18"
                data-testid="mock-draft-back-to-league"
              >
                Back to League
              </a>
            ) : null}
            {sourceLeaguePath ? (
              <a
                href={`/league/${sourceLeaguePath}/draft`}
                className="rounded-2xl border border-violet-400/30 bg-violet-500/10 px-4 py-3 text-sm font-bold text-violet-100 hover:bg-violet-500/18"
                data-testid="mock-draft-back-to-draft-room"
              >
                Back to Draft Room
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => void shareDraft()}
              className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-black text-black hover:bg-cyan-400"
              data-testid="mock-draft-share-button"
            >
              {savingDraft ? 'Saving...' : shareId ? 'Copy Share Draft URL' : 'Share Draft'}
            </button>
            <button
              type="button"
              onClick={draftAgain}
              className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/70 hover:border-white/20 hover:text-white"
              data-testid="mock-draft-draft-again"
            >
              Draft Again
            </button>
            <button
              type="button"
              onClick={() => void gradeMyTeam()}
              className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/70 hover:border-white/20 hover:text-white"
              data-testid="mock-draft-grade-team"
            >
              Grade My Team
            </button>
          </div>

          {shareId ? (
            <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/60">
              Share URL: <span className="text-cyan-300">{shareUrl}</span>
            </div>
          ) : null}

          {teamGrade ? (
            <div className="mt-6 rounded-3xl border border-white/8 bg-[#0c1224] p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-300">Team Grade</div>
              <div className="mt-3 text-sm leading-6 text-white/75">{teamGrade}</div>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (step === 'entry') return renderEntry()
  if (step === 'league') return renderLeagueGate()
  if (step === 'open') return renderOpenSetup()
  if (step === 'complete') return renderCompletion()
  return renderDraftBoard()
}
