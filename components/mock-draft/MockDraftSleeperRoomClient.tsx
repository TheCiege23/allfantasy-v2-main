'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { mockTurnDurationMs, remainingMockSeconds } from '@/lib/mock-draft/turn-clock'
import { postChimmyRequest } from '@/lib/chimmy/postRequest'
import {
  applyMockQueueProposal,
  buildMockDraftBoard,
  readMockQueueProposal,
  type MockBoardAuction,
  type MockQueueProposal,
} from '@/lib/mock-draft/mockChimmyBoard'
import { MockQueueCard } from '@/components/chimmy/MockQueueCard'
import { CHIMMY_PRO_TOOL_UPGRADE_HREF, proUpsellLine, readProUpsell, type ChimmyProOnlyTool } from '@/lib/chimmy/answerPolish'
import { ManagerRoleBadge } from '@/components/ManagerRoleBadge'
import { DEFAULT_SPORT, SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { getMockDraftTeamCountOptions } from '@/lib/mock-draft/mockTeamCount'
import { DraftBoardPreview } from '@/components/app/draft-room/DraftBoardPreview'
import { DraftRoomShell, type MobileDraftTab } from '@/components/app/draft-room/DraftRoomShell'
import { DraftTopBar } from '@/components/app/draft-room/DraftTopBar'
import { DraftRoundOneAnnouncementOverlay } from '@/components/app/draft-room/DraftRoundOneAnnouncementOverlay'
import type { RoundOneAnnouncementQueueItem } from '@/lib/draft-room/resolvePickAnnouncementAssets'
import { positionTintHex } from '@/lib/draft-room/positionTint'
import { leagueAccentFor } from '@/lib/draft-room/leagueAccent'
import { tileSignatureChipsByOverall } from '@/lib/draft-room/leagueSignature'
import type { DraftRoomLeagueFacts } from '@/lib/draft-room/leagueNote'
import { SKIN_ON_FILL } from '@/lib/draft-room/sleeperSkin'
import { LanguageFallbackBoundary } from '@/components/i18n/LanguageProviderClient'
import { mockDraftRoomMessages } from '@/lib/core-app/messages/mockDraftRoom'
import { draftRoomHeaderMessages } from '@/lib/core-app/messages/draftRoomHeader'
import { PlayerAvatar } from '@/components/app/draft-room/PlayerAvatar'
import { ResultsRosterPanel, type ResultsRosterPanelPick, type ResultsRosterPanelTeam } from '@/components/app/draft-room/ResultsRosterPanel'
import { sportHasByeWeeks } from '@/lib/draft-room/rosterSlotOrder'
import {
  buildSleeperPoolStatColumnDefs,
  formatDraftStatDisplay,
  getStatValueForDraftPlayer,
  type DraftStatPlayerSource,
} from '@/lib/draft-room/draftSportStatColumns'
import { mockPlayerAssetUrls } from '@/lib/mock-draft/mockPlayerAssets'
import { parseAfAdpContributions, sortByAfAdp, type MockPoolSort } from '@/lib/mock-draft/mockAfAdpSort'
import { ADP_LABEL_AF, AF_BLUE, TOOLTIP_AF_ADP, afAdpCellTitle, systemAdpCellTitle } from '@/lib/draft-room/adpReadinessCopy'
import { clockProgressPercent } from '@/lib/draft-room/clockProgress'
import { DraftModeBanner } from '@/components/app/draft-room/DraftModeBanner'
import { useMessages } from '@/components/i18n/useMessages'
import { draftRoomRedesignMessages } from '@/lib/core-app/messages/draftRoomRedesign'
import { AuctionBidDock, AuctionSpotlightPanel, type AuctionSpotlightPanelProps } from '@/components/app/draft-room/AuctionSpotlightPanel'
import {
  auctionValues as computeAuctionValues,
  createMockAuction,
  mockAuctionTiming,
  nominateForUser,
  placeUserBid,
  resumeMockAuction,
  sellLot,
  tickMockAuction,
  type MockAuctionContext,
  type MockAuctionSale,
  type MockAuctionState,
} from '@/lib/mock-draft/mockAuction'
import type { DraftPickSnapshot } from '@/lib/live-draft-engine/types'
import '@/components/core-app/af-core.css'
import '@/components/app/draft-room/af-draft-room.css'

type EntryStep = 'entry' | 'league' | 'open' | 'draft' | 'complete'
type DraftMode = 'league' | 'open'
type DraftType = 'snake' | 'auction' | 'linear'
type DraftScoring = 'PPR' | 'Half PPR' | 'Standard' | 'Points' | 'Categories'
type DraftSpeed = 30 | 15 | 5 | 0
type DraftStatus = 'setup' | 'drafting' | 'paused' | 'complete'
/** The mock room's dock: what sits beside the pool on a laptop, and behind its own tab on a tablet. */
type MockDockTab = 'queue' | 'roster' | 'chat'

/**
 * Room v2, phase 5: the mock room's dock tabs, styled like the live room's `DraftCenterDockTabBar`
 * (whose tab set is the live room's own). `role="tab"`, so a phone's tray buttons stay the only
 * "Players" / "Chat" buttons on the page.
 */
function MockDockTabBar<T extends string>({
  tabs,
  active,
  onSelect,
  testIdBase,
}: {
  tabs: Array<{ id: T; label: string }>
  active: T
  onSelect: (id: T) => void
  testIdBase: string
}) {
  return (
    <div
      role="tablist"
      data-testid={`${testIdBase}-tabbar`}
      className="flex gap-1 overflow-x-auto border-b border-white/8 bg-[#0a1228] px-2 py-1.5 [scrollbar-width:none]"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onSelect(tab.id)}
          data-testid={`${testIdBase}-tab-${tab.id}`}
          className={`min-h-[40px] flex-1 shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] transition-colors ${
            active === tab.id ? 'bg-white/12 text-cyan-100' : 'text-white/60 hover:bg-white/5'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

/** "1.03": round and pick-in-round, the live room's pick label. */
export function mockPickLabel(overall: number, teamCount: number): string {
  const size = Math.max(1, teamCount)
  const round = Math.ceil(overall / size)
  const inRound = ((overall - 1) % size) + 1
  return `${round}.${String(inRound).padStart(2, '0')}`
}

/** A mock pick in the live room's snapshot shape (the auction panel and the round-1 card). */
function toPickSnapshot(pick: DraftPick, teamCount: number): DraftPickSnapshot {
  return {
    id: `mock-${pick.overall}`, overall: pick.overall, round: pick.round, slot: pick.slot, rosterId: String(pick.slot),
    displayName: pick.managerName, playerName: pick.playerName, position: pick.position, team: pick.team || null,
    byeWeek: null, playerId: pick.playerId, playerImageUrl: pick.headshotUrl ?? null, tradedPickMeta: null,
    source: 'mock', pickLabel: mockPickLabel(pick.overall, teamCount), amount: pick.price ?? null, createdAt: '',
  }
}

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
    rosterSlots?: string[]
    managers: LeagueManager[]
    detectedUserSlot: number
    hasExplicitDraftOrder: boolean
    /**
     * Room v2: the league's real type and its room facts (lib/mock-draft/leagueMockRoomFacts). Optional:
     * a mock saved before them restores without, and falls back to the dynasty/redraft accent.
     */
    leagueConcept?: string | null
    leagueFacts?: Pick<DraftRoomLeagueFacts, 'note' | 'slotSalaryByOverall'> | null
  }
}

interface DraftSettings {
  rosterSlots?: string[]
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
  adp: number | null
  projectedPts: number
  /* Optional so a mock saved before headshots existed still restores. */
  headshotUrl?: string | null
  teamLogoUrl?: string | null
  aiReason?: string
  /** Auction only: the winning bid. */
  price?: number
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
  adp: number | null
  /* AF ADP (lib/adp/afAdp.ts) beside market ADP. Optional so a mock saved before it still restores. */
  afAdp?: number | null
  afAdpContributions?: { market: number; imported: number; af: number } | null
  afAdpImportedSampleSize?: number | null
  afAdpOwnSampleSize?: number | null
  projectedPts: number
  ownership: number
  injuryStatus: string | null
  tier: number
  posRank: string
  isRookie: boolean
  /* Football bye week from the pool feed (Phase 7). Optional so an older saved mock still restores. */
  byeWeek?: number | null
  /*
   * The live room's season stat columns (lib/mock-draft/mockPoolSeasonStats.ts): `display.stats` and,
   * in football, the season splits. Optional, so a mock saved before them restores with dashes.
   */
  display?: { stats?: Record<string, number> | null } | null
  nflDraftProjectionSplits?: DraftStatPlayerSource['nflDraftProjectionSplits']
  /* Optional so a mock saved before headshots existed still restores. */
  headshotUrl?: string | null
  teamLogoUrl?: string | null
  /* The league signature chip (room v2): age, or a college player's class. Optional for older saved mocks. */
  age?: number | null
  classYearLabel?: string | null
  poolType?: string | null
}

interface ChatMessage {
  role: 'user' | 'ai'
  content: string
  pick?: number
  /** A queue change Chimmy proposed. Applied to this room's queue only when the user taps Confirm. */
  queueProposal?: MockQueueProposal
  queueProposalState?: 'pending' | 'applied' | 'stale' | 'dismissed'
  queueProposalNote?: string
  /** AF Pro tools a free answer reached for and the server refused (`meta.proUpsell`). */
  proUpsell?: ChimmyProOnlyTool[]
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
  turnDeadlineMs: number | null
  pausedRemainingMs?: number
  chatMessages: ChatMessage[]
  /** Auction drafts: budgets, the player on the block and the bids (see lib/mock-draft/mockAuction). */
  auction?: MockAuctionState | null
  /** Auction drafts: dollar value per player id, fixed when the draft starts. */
  auctionValues?: Record<string, number>
  /** When the draft was paused, so auction clocks can resume where they stopped. */
  pausedAtMs?: number
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

/** Only the numeric stats survive into the saved mock: the columns read numbers and nothing else. */
function numericStatsFromUnknown(value: unknown): Record<string, number> | null {
  const record = recordFromUnknown(value)
  if (!record) return null
  const out: Record<string, number> = {}
  for (const [key, v] of Object.entries(record)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
  }
  return Object.keys(out).length ? out : null
}

/** NFL offense: points and average, then the two columns that describe the position. */
const NFL_MOCK_STAT_KEYS: Record<string, readonly string[]> = {
  QB: ['pts', 'avg', 'pa_yds', 'pa_td'],
  RB: ['pts', 'avg', 'ru_yds', 'ru_td'],
  WR: ['pts', 'avg', 'rec', 'rec_yds'],
  TE: ['pts', 'avg', 'rec', 'rec_yds'],
}

/**
 * Up to four of the live room's stat columns (its pool table's own set) for one pool row, by sport
 * and position — a pitcher gets pitching columns, a goalie goalie ones, a receiver catches and yards.
 * A missing value is a dash, never a guess.
 */
export function mockPoolStatCells(player: Pick<AvailablePlayer, 'position' | 'display' | 'nflDraftProjectionSplits' | 'adp'>, sport: string) {
  const defs = buildSleeperPoolStatColumnDefs(sport, { position: player.position })
  const wanted = String(sport).toUpperCase() === 'NFL' ? NFL_MOCK_STAT_KEYS[String(player.position).toUpperCase()] : undefined
  const picked = wanted ? wanted.flatMap((key) => defs.filter((d) => d.key === key)) : defs
  return picked
    .slice(0, 4)
    .map((column) => ({
      key: column.key,
      label: column.label,
      value: formatDraftStatDisplay(getStatValueForDraftPlayer(player as DraftStatPlayerSource, column), column),
    }))
}

/**
 * The phone pool row's stat line: two stats, short labels, so it fits beside the Draft and Queue
 * buttons on a 390px screen without being cut off. Football leads with points per game (a season
 * total says less in a draft) and then the position's main stat; other sports take their first two
 * stats that have a value. Missing values are skipped, never shown as dashes or guessed.
 */
export function mockPoolPhoneStatLine(
  player: Pick<AvailablePlayer, 'position' | 'display' | 'nflDraftProjectionSplits' | 'adp'>,
  sport: string,
): string | null {
  const isNfl = String(sport).toUpperCase() === 'NFL'
  const cells = mockPoolStatCells(player, sport).filter((cell) => cell.value !== '—' && !(isNfl && cell.key === 'pts'))
  const line = cells.slice(0, 2).map((cell) => `${cell.label} ${cell.value}`).join(' · ')
  return line || null
}

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

/** The AF position palette (room v2), the same chip colors the live pool and board use. */
function positionChipStyle(position: string, sport?: string | null): CSSProperties {
  const tint = positionTintHex(position, sport)
  return tint
    ? { backgroundColor: tint, color: SKIN_ON_FILL }
    : { backgroundColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)' }
}

function getRosterSlots(settings: DraftSettings): string[] {
  if (settings.rosterSlots?.length) return settings.rosterSlots
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

/** The mock's flat slot list ("QB", "RB", "RB", …, "BN") as the counts the shared roster panel reads. */
export function mockStarterSlotCounts(slots: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const slot of slots) {
    const key = String(slot ?? '').trim().toUpperCase()
    if (!key || key === 'BN' || key === 'BENCH' || key === 'IR' || key === 'TAXI') continue
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
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
  if (['UTIL', 'SUPER_UTIL', 'BN'].includes(normalizedSlot)) {
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
        case 'SUPER_UTIL':
        case 'BN':
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
  let score = Math.max(0, 200 - (player.adp ?? 9999))
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
    if (player.ownership < 50 && player.adp != null && player.adp > (roundNumber * settings.teamCount * 0.8)) {
      score += 5
    }
    if (player.isRookie) score += 3
  }

  score += Math.min(20, player.projectedPts / 12)
  return score
}

function generatePickReason(player: AvailablePlayer, team: TeamSlot, needs: string[], round: number): string {
  if (needs.includes(player.position) && player.adp != null) {
    return `Filled a ${player.position} need with value at ${player.adp?.toFixed(1) ?? '\u2014'} ADP.`
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

/**
 * Picks between the one on the clock and the given slot's next turn: 0 when that slot is on the
 * clock, null when it has no turn left. Walks the same order `getOnTheClockSlot` assigns, so a snake
 * draft's turn at the end of a round is counted correctly.
 */
export function mockPicksUntilSlot(teams: TeamSlot[], settings: DraftSettings, currentPick: number, slot: number): number | null {
  const total = settings.teamCount * settings.rounds
  for (let k = 0; currentPick + k <= total && k <= settings.teamCount * 2; k += 1) {
    if (getOnTheClockSlot(teams, settings, currentPick + k) === slot) return k
  }
  return null
}

/** Every mock auction team starts with this budget, the common league default. */
const MOCK_AUCTION_BUDGET = 200

function auctionContextFor(state: DraftState, now: number, queue: string[]): MockAuctionContext | null {
  const auction = state.auction
  if (!auction) return null
  const user = state.teams.find((team) => team.isUser)
  if (!user) return null
  const values = state.auctionValues ?? {}
  const sold = new Set(state.picks.map((pick) => pick.playerId))
  const spotsLeft: Record<number, number> = {}
  const needs: Record<number, string[]> = {}
  for (const team of state.teams) {
    spotsLeft[team.slot] = Math.max(0, state.settings.rounds - team.picks.length)
    needs[team.slot] = team.rosterNeeds
  }
  const available = state.availablePlayers
    .filter((player) => !sold.has(player.id))
    .sort((a, b) => (values[b.id] ?? 0) - (values[a.id] ?? 0))
    .map((player) => ({ id: player.id, position: player.position }))
  return {
    now,
    rand: Math.random,
    userSlot: user.slot,
    order: state.teams.map((team) => team.slot).sort((a, b) => a - b),
    spotsLeft,
    needs,
    values,
    available,
    autoNominateId: queue.find((id) => !sold.has(id)) ?? null,
    timing: mockAuctionTiming(state.settings.speed),
  }
}

/** Applies an auction change, then records a sale (if any) on the board and the winner's roster. */
function withAuctionResult(state: DraftState, next: MockAuctionState, sale: MockAuctionSale | null, complete: boolean, ctx: MockAuctionContext): DraftState {
  const nominator = ctx.order[next.nominationIndex] ?? state.onTheClock
  if (!sale) {
    if (next === state.auction && !complete) return state
    return { ...state, auction: next, onTheClock: nominator, status: complete ? 'complete' : state.status }
  }
  const player = state.availablePlayers.find((entry) => entry.id === sale.playerId)
  const team = state.teams.find((entry) => entry.slot === sale.winnerSlot)
  if (!player || !team) return { ...state, auction: next, onTheClock: nominator }
  const overall = state.picks.length + 1
  const round = team.picks.length + 1
  const pick: DraftPick = {
    overall,
    round,
    pick: round,
    slot: team.slot,
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    team: player.team,
    adp: player.adp,
    projectedPts: player.projectedPts,
    headshotUrl: player.headshotUrl ?? null,
    teamLogoUrl: player.teamLogoUrl ?? null,
    price: sale.price,
    isUser: team.isUser,
    managerName: team.managerName,
  }
  const teams = state.teams.map((entry) => {
    if (entry.slot !== team.slot) return entry
    const nextTeam = { ...entry, picks: [...entry.picks, pick] }
    return { ...nextTeam, rosterNeeds: computeTeamNeeds(nextTeam, state.settings) }
  })
  const allFull = teams.every((entry) => entry.picks.length >= state.settings.rounds)
  const playersLeft = state.availablePlayers.length > state.picks.length + 1
  return {
    ...state,
    auction: next,
    teams,
    picks: [...state.picks, pick],
    currentPick: overall + 1,
    onTheClock: nominator,
    status: allFull || !playersLeft ? 'complete' : state.status,
  }
}

function applyAuctionTick(state: DraftState, now: number, queue: string[]): DraftState {
  if (state.status !== 'drafting' || !state.auction) return state
  const ctx = auctionContextFor(state, now, queue)
  if (!ctx) return state
  const tick = tickMockAuction(state.auction, ctx)
  return withAuctionResult(state, tick.state, tick.sale, tick.complete, ctx)
}

function createOpenMockTeams(settings: DraftSettings): TeamSlot[] {
  return Array.from({ length: settings.teamCount }, (_, index) => {
    const slot = index + 1
    const managerName = slot === settings.myPickSlot ? 'You' : `Chimmy Team ${slot}`
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

/** The mock auction as Chimmy reads it: who is on the block, the bid, and every team's money. */
function mockAuctionForChimmy(state: DraftState, now: number): MockBoardAuction | null {
  const auction = state.auction
  if (!auction) return null
  const lot = auction.lot
  const player = lot ? state.availablePlayers.find((p) => p.id === lot.playerId) ?? null : null
  const nameOf = (slot: number) => state.teams.find((t) => t.slot === slot)?.managerName ?? null
  return {
    nomination: player ? { name: player.name, position: player.position, team: player.team || null } : null,
    currentBid: lot?.bid ?? 0,
    highBidderName: lot ? nameOf(lot.leaderSlot) : null,
    minNextBid: lot ? lot.bid + 1 : auction.minBid,
    bidSecondsLeft: lot ? Math.max(0, Math.ceil((lot.endsAtMs - now) / 1000)) : null,
    teams: state.teams.map((t) => ({
      name: t.managerName,
      budget: auction.budgets[t.slot] ?? 0,
      openSlots: Math.max(0, auction.rosterSize - t.picks.length),
      isViewer: t.isUser,
    })),
  }
}

type ChimmyReply = { text: string; queueProposal: MockQueueProposal | null; proUpsell: ChimmyProOnlyTool[] }

function aiMessageFrom(reply: ChimmyReply, pick?: number): ChatMessage {
  return {
    role: 'ai',
    content: reply.text,
    ...(pick != null ? { pick } : {}),
    ...(reply.queueProposal ? { queueProposal: reply.queueProposal, queueProposalState: 'pending' as const } : {}),
    ...(reply.proUpsell.length > 0 ? { proUpsell: reply.proUpsell } : {}),
  }
}

/**
 * A queue change Chimmy proposed, in the chat. Nothing changes until Confirm, and Confirm only edits this
 * room's queue — it never drafts. Stage 3 of drafts (2026-11-16).
 */
function MockQueueCardForMessage({ message, onResolve }: { message: ChatMessage; onResolve: (action: 'confirm' | 'dismiss') => void }) {
  if (!message.queueProposal) return null
  return <MockQueueCard proposal={message.queueProposal} state={message.queueProposalState ?? 'pending'} note={message.queueProposalNote} onResolve={onResolve} />
}

export default function MockDraftSleeperRoomClient({
  initialLeagueId = '',
  initialSport = DEFAULT_SPORT,
  viewerId,
}: {
  initialLeagueId?: string
  initialSport?: string
  viewerId: string
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
  const [poolSort, setPoolSort] = useState<MockPoolSort>('adp')
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Phone tray tab ('board' = tray collapsed), the live room's contract with `DraftRoomShell`. */
  const [mobileTab, setMobileTab] = useState<MobileDraftTab>('board')
  /** Laptop dock tab; on a portrait tablet, also which dock panel shows when the dock has the screen. */
  const [dockTab, setDockTab] = useState<MockDockTab>('queue')
  /** Portrait tablet: the pool or the dock, one at a time. */
  const [tabletPanel, setTabletPanel] = useState<'players' | 'dock'>('players')
  const selectDockTab = useCallback((tab: MockDockTab) => {
    setDockTab(tab)
    setTabletPanel('dock')
  }, [])
  const mockCopy = useMessages(mockDraftRoomMessages)
  const headerCopy = useMessages(draftRoomHeaderMessages)
  /*
   * Round-1 picks get the live room's announcement card, as a toast (`variant="toast"`). CPU
   * managers pick seconds apart, so a newer pick replaces a CPU card at once instead of queueing
   * behind it (a backlog would still be playing in round 3); the viewer's own card keeps its full
   * time, with the newest pick waiting behind it. Picks already on the board when the room mounts
   * (a restored mock) are not announced again.
   */
  const [roundOneQueue, setRoundOneQueue] = useState<RoundOneAnnouncementQueueItem[]>([])
  const announcedThroughRef = useRef<number | null>(null)
  const dismissRoundOne = useCallback(() => setRoundOneQueue((queue) => queue.slice(1)), [])
  const [draftId, setDraftId] = useState<string | null>(null)
  const [shareId, setShareId] = useState<string | null>(null)
  const [teamGrade, setTeamGrade] = useState<string | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [checkpointReady, setCheckpointReady] = useState(false)
  const [checkpointError, setCheckpointError] = useState<string | null>(null)
  const [recoveredDraft, setRecoveredDraft] = useState(false)
  const checkpointKey = `af:mock-draft:v1:${encodeURIComponent(viewerId)}:${encodeURIComponent(queryLeagueId || 'open')}`
  const lastCheckpointRef = useRef<string | null>(null)
  const latestCheckpointRef = useRef<string | null>(null)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(checkpointKey)
      if (raw) {
        const saved = JSON.parse(raw)
        const state = saved?.state as DraftState | undefined
        if (saved.version !== 1 || !state || !Array.isArray(state.picks) || !Array.isArray(state.teams) ||
          !Array.isArray(state.availablePlayers) || !Array.isArray(state.chatMessages) || !state.settings ||
          !['drafting', 'paused', 'complete'].includes(state.status) ||
          !Number.isInteger(state.currentPick) || state.currentPick < 1 ||
          !Array.isArray(saved.queue) || !saved.queue.every((id: unknown) => typeof id === 'string') ||
          ![0, 5, 15, 30].includes(state.settings.speed) || !Number.isInteger(state.settings.teamCount) ||
          state.settings.teamCount < 2 || !Number.isInteger(state.settings.rounds) || state.settings.rounds < 1) {
          throw new Error('Invalid saved mock draft')
        }
        const remaining = state.status === 'paused'
          ? state.pausedRemainingMs ?? state.timerSeconds * 1000
          : Math.max(0, (state.turnDeadlineMs ?? Date.now()) - Date.now())
        setDraftState(state.status === 'complete' ? state : {
          ...state, status: 'paused', turnDeadlineMs: null,
          pausedRemainingMs: remaining, timerSeconds: Math.ceil(remaining / 1000),
        })
        setSettings(state.settings)
        setQueue(saved.queue)
        setMode(saved.mode === 'league' ? 'league' : 'open')
        setSelectedLeague(saved.selectedLeague ?? null)
        setLeaguePayload(saved.leaguePayload ?? null)
        setDraftId(saved.draftId ?? null)
        setShareId(saved.shareId ?? null)
        setStep(state.status === 'complete' ? 'complete' : 'draft')
        autoLoadedLeagueRef.current = queryLeagueId
        setRecoveredDraft(true)
      }
    } catch {
      setCheckpointError('Your saved mock could not be restored. Start a new mock, or export this one before leaving if browser storage is unavailable.')
    }
    setCheckpointReady(true)
  }, [checkpointKey, queryLeagueId])

  // Ignore display-only timer ticks: the absolute deadline already preserves the clock.
  useEffect(() => {
    if (!checkpointReady) return
    const payload = draftState ? JSON.stringify({
      version: 1, state: { ...draftState, timerSeconds: draftState.settings.speed }, queue,
      mode, selectedLeague, leaguePayload, draftId, shareId,
    }) : null
    latestCheckpointRef.current = payload
    if (payload === lastCheckpointRef.current) return
    try {
      if (payload) window.localStorage.setItem(checkpointKey, payload)
      else window.localStorage.removeItem(checkpointKey)
      lastCheckpointRef.current = payload
      setCheckpointError(null)
    } catch {
      setCheckpointError('This browser could not save your mock progress. Keep this tab open or use Export before leaving.')
    }
  }, [checkpointReady, checkpointKey, draftState, queue, mode, selectedLeague, leaguePayload, draftId, shareId])

  useEffect(() => {
    const flush = () => {
      if (!latestCheckpointRef.current) return
      try { window.localStorage.setItem(checkpointKey, latestCheckpointRef.current) } catch { /* visible save warning is handled above */ }
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [checkpointKey])

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
  /*
   * A league mock's tiles carry the live board's signature chip: age in a dynasty, keeper, devy, C2C or
   * EFL league, a college pick's class in devy and C2C. The pool keeps drafted players, so it is the lookup.
   * An open mock has no league, so no chip.
   */
  const leagueConceptForMock = leaguePayload ? leagueAccentFor(leaguePayload.leagueConcept ?? null, { isDynasty: leaguePayload.isDynasty }).concept : null
  const signatureByOverall = useMemo(
    () => tileSignatureChipsByOverall(
      leagueConceptForMock,
      draftState?.picks ?? [],
      // Mock rows keep age at the top level; their `display` holds only stats, which the chips never read.
      (draftState?.availablePlayers ?? []).map((player) => ({ ...player, playerId: player.id, display: null })),
    ),
    [leagueConceptForMock, draftState?.picks, draftState?.availablePlayers],
  )

  useEffect(() => {
    setQueue((current) => {
      const remaining = current.filter((id) => !draftedIds.has(id))
      return remaining.length === current.length ? current : remaining
    })
  }, [draftedIds])

  const filteredPlayers = useMemo(() => {
    if (!draftState) return []

    const visible = draftState.availablePlayers.filter((player) => {
      if (!showDrafted && draftedIds.has(player.id)) return false
      if (rookiesOnly && !player.isRookie) return false
      if (filter !== 'All' && player.position.toUpperCase() !== filter.toUpperCase()) return false
      if (search.trim().length > 0) {
        const haystack = `${player.name} ${player.position} ${player.team} ${player.posRank}`.toLowerCase()
        if (!haystack.includes(search.trim().toLowerCase())) return false
      }
      return true
    })
    return poolSort === 'afAdp' ? sortByAfAdp(visible) : visible
  }, [draftState, draftedIds, filter, poolSort, rookiesOnly, search, showDrafted])

  const onTheClockTeam = useMemo(
    () => draftState?.teams.find((team) => team.slot === draftState.onTheClock) ?? null,
    [draftState],
  )

  // Auction: the user's turn is their nomination, and it ends once their player is on the block.
  const isUserTurn = Boolean(onTheClockTeam?.isUser && draftState?.status === 'drafting' && !draftState?.auction?.lot)
  /*
   * The live room's clock language, in the mock room (2026-11-05): the pick, who is on the clock,
   * how far away your turn is, and a bar for the time left. The timer only ticks on your own turn
   * (the AI picks at once), so the time and its bar are shown then and nowhere else.
   */
  const roomCopy = useMessages(draftRoomRedesignMessages)
  const userSlot = draftState?.teams.find((team) => team.isUser)?.slot ?? null
  const picksUntilUser =
    draftState && userSlot != null && draftState.status !== 'complete' && !draftState.auction
      ? mockPicksUntilSlot(draftState.teams, draftState.settings, draftState.currentPick, userSlot)
      : null
  const clockProgress =
    draftState && isUserTurn && !draftState.auction && draftState.settings.speed > 0 ? clockProgressPercent(draftState.timerSeconds, draftState.settings.speed) : null
  const clockUrgent = Boolean(draftState && isUserTurn && !draftState.auction && draftState.settings.speed > 0 && draftState.timerSeconds <= 5)
  const clockStatus = !draftState
    ? null
    : draftState.status === 'complete'
      ? roomCopy.mockStatusComplete
      : draftState.status === 'paused'
        ? roomCopy.mockStatusPaused
        : isUserTurn
          ? roomCopy.clockBarYouOnClock
          : picksUntilUser != null && picksUntilUser > 0
            ? `~${roomCopy.clockBarPicksUntil(picksUntilUser)}`
            : null

  /* The chat log follows the newest message, so a Chimmy card's Confirm is in view without hunting. */
  const chatMessageCount = draftState?.chatMessages.length ?? 0
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.querySelectorAll<HTMLElement>('[data-mock-chat-log]').forEach((el) => {
      el.scrollTop = el.scrollHeight
    })
  }, [chatMessageCount, dockTab, mobileTab])

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

  /*
   * Chimmy reads THIS board (stage 3 of drafts, 2026-11-16). The room runs in the browser, so nothing
   * on the server knows the mock — the snapshot rides with every question and the server turns it into
   * Chimmy's grounding (lib/chimmy/mockDraftGrounding.ts). Before this, Chimmy saw a one-line summary.
   */
  const callChimmy = useCallback(
    async (message: string, includeConversation: boolean): Promise<ChimmyReply> => {
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

      if (draftState) {
        const board = buildMockDraftBoard(
          {
            settings: draftState.settings,
            teams: draftState.teams,
            availablePlayers: draftState.availablePlayers,
            picks: draftState.picks,
            currentPick: draftState.currentPick,
            status: draftState.status,
            userSecondsLeft: isUserTurn && draftState.settings.speed > 0 ? draftState.timerSeconds : null,
            slotAtOverall: (overall) => getOnTheClockSlot(draftState.teams, draftState.settings, overall),
            auction: mockAuctionForChimmy(draftState, Date.now()),
          },
          queue,
        )
        if (board) formData.set('mockDraftBoard', JSON.stringify(board))
      }

      const response = await postChimmyRequest(formData)

      const payload = (await response.json().catch(() => ({}))) as {
        response?: string
        error?: string
        meta?: { mockQueueProposals?: unknown; proUpsell?: unknown }
      }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Chimmy request failed.')
      }

      const proposals = Array.isArray(payload.meta?.mockQueueProposals) ? payload.meta.mockQueueProposals : []
      return {
        text: payload.response ?? 'Chimmy did not return a message.',
        queueProposal: readMockQueueProposal(proposals[0]),
        proUpsell: readProUpsell(payload.meta?.proUpsell),
      }
    },
    [draftState, isUserTurn, mode, queue, settings.scoring, settings.sport],
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
    (player: AvailablePlayer, isAiPick: boolean, expectedOverall?: number) => {
      setDraftState((current) => {
        if (!current || current.status !== 'drafting') return current
        if (expectedOverall != null && current.currentPick !== expectedOverall) return current
        if (current.picks.some((pick) => pick.playerId === player.id)) return current

        const round = Math.ceil(current.currentPick / current.settings.teamCount)
        const pickInRound = ((current.currentPick - 1) % current.settings.teamCount) + 1
        const team = current.teams.find((entry) => entry.slot === current.onTheClock)
        if (!team || team.isUser === isAiPick) return current

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
          headshotUrl: player.headshotUrl ?? null,
          teamLogoUrl: player.teamLogoUrl ?? null,
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
          turnDeadlineMs: Date.now() + mockTurnDurationMs(current.settings.speed,
            Boolean(updatedTeams.find((entry) => entry.slot === getOnTheClockSlot(updatedTeams, current.settings, nextCurrentPick))?.isUser)),
          pausedRemainingMs: undefined,
          chatMessages:
            isAiPick && pick.aiReason
              ? [...current.chatMessages, { role: 'ai', content: pick.aiReason, pick: pick.overall }]
              : current.chatMessages,
        }

        return nextState
      })
    },
    [],
  )

  useEffect(() => {
    // Auctions run on their own clock (the auction effect below), not one pick per turn.
    if (!draftState || draftState.status !== 'drafting' || draftState.auction) return

    const clockTeam = draftState.teams.find((team) => team.slot === draftState.onTheClock)
    if (!clockTeam) return

    const deadline = draftState.turnDeadlineMs
    if (clockTeam.isUser) {
      if (draftState.settings.speed === 0 || deadline == null) return
      const refreshClock = () => {
        setDraftState((current) => {
          if (!current || current.status !== 'drafting' || current.currentPick !== draftState.currentPick) return current
          const remaining = remainingMockSeconds(deadline, Date.now())
          return current.timerSeconds === remaining ? current : { ...current, timerSeconds: remaining }
        })
      }
      const onVisible = () => { if (!document.hidden) refreshClock() }
      refreshClock()
      const interval = window.setInterval(refreshClock, 250)
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('pageshow', refreshClock)
      return () => {
        window.clearInterval(interval)
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('pageshow', refreshClock)
      }
    }

    let picked = false
    const pickCpu = () => {
      if (picked) return
      picked = true
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

      handlePick(selected, true, latestState.currentPick)
    }
    const timeout = window.setTimeout(pickCpu, Math.max(0, (deadline ?? Date.now()) - Date.now()))
    const onVisible = () => { if (!document.hidden && (deadline ?? 0) <= Date.now()) pickCpu() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [draftState, handlePick])

  useEffect(() => {
    if (!draftState || draftState.status !== 'drafting' || draftState.auction || !onTheClockTeam?.isUser) return
    if (draftState.settings.speed === 0 || draftState.timerSeconds > 0) return

    const queuedPlayer = queue
      .map((id) => draftState.availablePlayers.find((player) => player.id === id))
      .find((player): player is AvailablePlayer => player != null && !draftedIds.has(player.id))

    const fallbackPlayer =
      queuedPlayer ??
      draftState.availablePlayers.find((player) => !draftedIds.has(player.id)) ??
      null

    if (fallbackPlayer) {
      handlePick(fallbackPlayer, false, draftState.currentPick)
    }
  }, [draftState, draftedIds, handlePick, onTheClockTeam?.isUser, queue])

  /*
   * The mock auction's clock. One short interval drives everything — AI bids, AI nominations, the
   * bid clock running out — through the pure engine in lib/mock-draft/mockAuction, which is
   * deadline-based, so a throttled background tab catches up rather than stretching the lot.
   */
  const queueRef = useRef(queue)
  queueRef.current = queue
  const auctionDrafting = draftState?.status === 'drafting' && draftState.auction != null
  const [auctionNow, setAuctionNow] = useState(() => Date.now())
  useEffect(() => {
    if (!auctionDrafting) return
    const step = () => {
      const now = Date.now()
      setAuctionNow(now)
      setDraftState((current) => (current ? applyAuctionTick(current, now, queueRef.current) : current))
    }
    step()
    const interval = window.setInterval(step, 200)
    return () => window.clearInterval(interval)
  }, [auctionDrafting])

  const auctionAct = useCallback((act: (state: MockAuctionState, ctx: MockAuctionContext) => { state: MockAuctionState; sale: MockAuctionSale | null }) => {
    setDraftState((current) => {
      if (!current || current.status !== 'drafting' || !current.auction) return current
      const ctx = auctionContextFor(current, Date.now(), queueRef.current)
      if (!ctx) return current
      const result = act(current.auction, ctx)
      return withAuctionResult(current, result.state, result.sale, false, ctx)
    })
  }, [])
  const auctionNominate = useCallback((playerId: string) => {
    auctionAct((state, ctx) => ({ state: nominateForUser(state, ctx, playerId), sale: null }))
  }, [auctionAct])
  const auctionBid = useCallback((amount: number) => {
    auctionAct((state, ctx) => {
      const result = placeUserBid(state, ctx, amount)
      return { state: result.ok ? result.state : state, sale: null }
    })
  }, [auctionAct])
  const auctionSellNow = useCallback(() => {
    auctionAct((state, ctx) => sellLot(state, ctx))
  }, [auctionAct])

  /*
   * The live room's auction stage, fed by the mock engine. Slots stand in for roster ids, and the
   * user is the commissioner of their own mock, so "Sell now" ends a lot early.
   */
  const auctionPanelProps = useMemo<AuctionSpotlightPanelProps | null>(() => {
    const auction = draftState?.auction
    if (!draftState || !auction) return null
    const lot = auction.lot
    const lotPlayer = lot ? draftState.availablePlayers.find((player) => player.id === lot.playerId) ?? null : null
    const order = [...draftState.teams].sort((a, b) => a.slot - b.slot)
    const budgets: Record<string, number> = {}
    for (const team of order) budgets[String(team.slot)] = auction.budgets[team.slot] ?? auction.budgetPerTeam
    const picks: DraftPickSnapshot[] = draftState.picks.map((pick) => toPickSnapshot(pick, draftState.settings.teamCount))
    const deadline = lot?.endsAtMs ?? auction.nominationDeadlineMs
    const paused = draftState.status === 'paused'
    return {
      auction: {
        draftType: 'auction',
        budgetPerTeam: auction.budgetPerTeam,
        budgets,
        minBidIncrement: 1,
        nominationOrder: order.map((team) => ({ slot: team.slot, rosterId: String(team.slot), displayName: team.managerName })),
        auctionState: {
          nominationOrderIndex: auction.nominationIndex,
          currentNomination: lotPlayer
            ? { playerName: lotPlayer.name, position: lotPlayer.position, team: lotPlayer.team || null, playerId: lotPlayer.id }
            : null,
          currentBid: lot?.bid ?? 0,
          currentBidderRosterId: lot ? String(lot.leaderSlot) : null,
          bidTimerEndAt: lot ? new Date(lot.endsAtMs).toISOString() : null,
          minNextBid: lot ? lot.bid + 1 : auction.minBid,
        },
      },
      currentUserRosterId: userSlot != null ? String(userSlot) : null,
      isCommissioner: true,
      onNominate: (player) => { if (player.playerId) auctionNominate(player.playerId) },
      onBid: auctionBid,
      onResolve: auctionSellNow,
      timerRemainingSeconds: deadline != null && !paused ? remainingMockSeconds(deadline, auctionNow) : null,
      timerStatus: paused ? 'paused' : deadline != null ? 'running' : 'none',
      bidClockSeconds: lot ? Math.round(mockAuctionTiming(draftState.settings.speed).bidWindowMs / 1000) : null,
      rosterSize: draftState.settings.rounds,
      picks,
      minimumBid: auction.minBid,
      queue: queuePlayers.map((player) => ({ playerName: player.name, position: player.position, team: player.team || null, playerId: player.id })),
    }
  }, [draftState, userSlot, auctionNominate, auctionBid, auctionSellNow, auctionNow, queuePlayers])

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
      setSelectedLeague({ ...league, id: payload.league.leagueId ?? league.id, isDynasty: payload.league.isDynasty, sport: payload.league.sport })
      setSettings({
        teamCount: payload.league.teamCount,
        rounds: payload.league.rounds,
        draftType: payload.league.draftType,
        sport: payload.league.sport,
        scoring: payload.league.scoring,
        superflex: payload.league.superflex,
        rosterSlots: payload.league.rosterSlots,
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
    if (!checkpointReady || !queryLeagueId || autoLoadedLeagueRef.current === queryLeagueId || loadingLeagues) return
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
  }, [checkpointReady, leagues, loadLeaguePayload, loadingLeagues, queryLeagueId, querySport])

  const loadPlayers = useCallback(async (nextSettings: DraftSettings): Promise<AvailablePlayer[]> => {
    const type = selectedLeague?.isDynasty ? 'dynasty' : 'redraft'
    const pool = selectedLeague?.isDynasty ? 'combined' : 'vet'
    const params = new URLSearchParams({
      type,
      pool,
      // At least one player per pick plus a margin: a 20-team, 20-round room makes 400 picks.
      // (/api/mock-draft/adp still caps a non-NBA pool at 500.)
      limit: String(Math.max(nextSettings.sport === 'NBA' ? 1000 : 300, nextSettings.teamCount * nextSettings.rounds + 60)),
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
      .map((entry, index): AvailablePlayer | null => {
        const raw = recordFromUnknown(entry)
        if (!raw) return null

        const name = stringFromUnknown(raw.name)
        const position = stringFromUnknown(raw.position)
        if (!name || !position) return null

        const id = stringFromUnknown(raw.playerId) ?? stringFromUnknown(raw.sleeperId) ?? `${name}-${position}-${index}`
        const team = stringFromUnknown(raw.team) ?? ''
        const { headshotUrl, teamLogoUrl } = mockPlayerAssetUrls({
          id,
          name,
          team,
          sport: nextSettings.sport,
          headshotUrl: stringFromUnknown(raw.headshotUrl),
          teamLogoUrl: stringFromUnknown(raw.teamLogoUrl),
        })

        return {
          id,
          name,
          position,
          team,
          headshotUrl,
          teamLogoUrl,
          adp: numberFromUnknown(raw.adp) ?? (nextSettings.sport === 'NBA' ? null : index + 1),
          afAdp: numberFromUnknown(raw.afAdp),
          afAdpContributions: parseAfAdpContributions(raw.afAdpContributions),
          afAdpImportedSampleSize: numberFromUnknown(raw.afAdpImportedSampleSize),
          afAdpOwnSampleSize: numberFromUnknown(raw.afAdpOwnSampleSize),
          projectedPts: numberFromUnknown(raw.value) ?? (nextSettings.sport === 'NBA' ? 0 : Math.max(0, 250 - index)),
          ownership: numberFromUnknown(raw.timesDrafted) ?? Math.max(10, 95 - index / 4),
          injuryStatus: stringFromUnknown(raw.injuryStatus),
          tier: Math.max(1, Math.ceil((index + 1) / 12)),
          posRank: `${position}${index + 1}`,
          isRookie: raw.isRookie === true,
          byeWeek: numberFromUnknown(raw.byeWeek) ?? numberFromUnknown(raw.bye),
          display: { stats: numericStatsFromUnknown(recordFromUnknown(raw.display)?.stats) },
          nflDraftProjectionSplits:
            (recordFromUnknown(raw.nflDraftProjectionSplits) as DraftStatPlayerSource['nflDraftProjectionSplits']) ?? null,
          age: numberFromUnknown(raw.age),
          classYearLabel: stringFromUnknown(raw.classYearLabel),
          poolType: stringFromUnknown(raw.poolType),
        } satisfies AvailablePlayer
      })
      .filter((player): player is AvailablePlayer => player != null)
      .sort((left, right) => (left.adp ?? Infinity) - (right.adp ?? Infinity))

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
        turnDeadlineMs: Date.now() + mockTurnDurationMs(settings.speed,
          Boolean(teams.find((entry) => entry.slot === getOnTheClockSlot(teams, settings, 1))?.isUser)),
        chatMessages: [
          {
            role: 'ai',
            content:
              mode === 'league' && leaguePayload
                ? `Loaded ${leaguePayload.leagueName}. Draft room is live.`
                : 'Open mock is ready. Chimmy will handle every non-user pick.',
          },
        ],
      }
      if (settings.draftType === 'auction') {
        const now = Date.now()
        const order = teams.map((team) => team.slot).sort((a, b) => a - b)
        const userSlot = teams.find((team) => team.isUser)?.slot ?? order[0] ?? 1
        initialState.auctionValues = computeAuctionValues(players, {
          teamCount: settings.teamCount,
          rosterSize: settings.rounds,
          budgetPerTeam: MOCK_AUCTION_BUDGET,
        })
        initialState.auction = createMockAuction({
          teamSlots: order,
          order,
          budgetPerTeam: MOCK_AUCTION_BUDGET,
          rosterSize: settings.rounds,
          userSlot,
          now,
          timing: mockAuctionTiming(settings.speed),
        })
        initialState.onTheClock = order[0] ?? initialState.onTheClock
        initialState.turnDeadlineMs = null
      }

      setRecoveredDraft(false)
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
      const reply = await callChimmy('Give me the best recommendation for this spot.', true)
      setDraftState((current) =>
        current
          ? {
              ...current,
              chatMessages: [...current.chatMessages, aiMessageFrom(reply, current.currentPick)],
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
  }, [callChimmy, chatLoading, draftState])

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
      const reply = await callChimmy(message, true)
      setDraftState((current) =>
        current
          ? {
              ...current,
              chatMessages: [...current.chatMessages, aiMessageFrom(reply)],
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
  }, [callChimmy, chatInput, chatLoading, draftState])

  /** A Chimmy queue card: applied to this room's queue only on the user's tap. Never a pick. */
  const resolveQueueProposal = useCallback(
    (index: number, action: 'confirm' | 'dismiss') => {
      if (!draftState) return
      const target = draftState.chatMessages[index]
      if (!target?.queueProposal || (target.queueProposalState ?? 'pending') !== 'pending') return
      let nextState: NonNullable<ChatMessage['queueProposalState']> = 'dismissed'
      let note: string | undefined
      if (action === 'confirm') {
        const drafted = new Set(draftState.picks.map((p) => p.playerId))
        const pool = new Set(draftState.availablePlayers.map((p) => p.id))
        const result = applyMockQueueProposal(queue, target.queueProposal, (id) => pool.has(id) && !drafted.has(id))
        if (result.ok) {
          setQueue(result.queue)
          nextState = 'applied'
          if (result.skipped.length > 0) note = `Already drafted, so not added: ${result.skipped.join(', ')}.`
        } else {
          nextState = 'stale'
        }
      }
      setDraftState((current) =>
        current
          ? {
              ...current,
              chatMessages: current.chatMessages.map((m, i) =>
                i === index ? { ...m, queueProposalState: nextState, ...(note ? { queueProposalNote: note } : {}) } : m,
              ),
            }
          : current,
      )
    },
    [draftState, queue],
  )

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

      const reply = await callChimmy(message, false)
      setTeamGrade(reply.text)
      setDraftState((current) =>
        current
          ? {
              ...current,
              chatMessages: [...current.chatMessages, aiMessageFrom(reply)],
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

  /* The mock's own controls, in the shared header (room v2 phase 5). Same logic as before the move. */
  const pauseMock = useCallback(() => {
    setDraftState((current) => current ? {
      ...current, status: 'paused', pausedRemainingMs: Math.max(0, (current.turnDeadlineMs ?? Date.now()) - Date.now()), turnDeadlineMs: null,
      pausedAtMs: Date.now(),
    } : current)
  }, [])
  const resumeMock = useCallback(() => {
    setDraftState((current) =>
      current && current.status !== 'complete' && current.auction
        ? { ...current, status: 'drafting', pausedRemainingMs: undefined, pausedAtMs: undefined,
            auction: resumeMockAuction(current.auction, {
              pausedForMs: Date.now() - (current.pausedAtMs ?? Date.now()),
              now: Date.now(),
              timing: mockAuctionTiming(current.settings.speed),
            }) }
        : current && current.status !== 'complete'
        ? { ...current, status: 'drafting',
            turnDeadlineMs: Date.now() + (current.pausedRemainingMs ?? mockTurnDurationMs(current.settings.speed, Boolean(current.teams.find((team) => team.slot === current.onTheClock)?.isUser))),
            timerSeconds: Math.ceil((current.pausedRemainingMs ?? current.settings.speed * 1000) / 1000), pausedRemainingMs: undefined }
        : current,
    )
  }, [])
  /** The header's Ask Chimmy: show the chat (tray on a phone, dock on a laptop or tablet) and ask. */
  const openChimmy = useCallback(() => {
    setMobileTab('chat')
    selectDockTab('chat')
    void askAi()
  }, [askAi, selectDockTab])

  useEffect(() => {
    if (!draftState) {
      announcedThroughRef.current = null
      setRoundOneQueue([])
      return
    }
    const picks = draftState.picks
    const through = announcedThroughRef.current
    announcedThroughRef.current = picks.length
    if (through == null || picks.length <= through || draftState.auction) {
      if (through != null && picks.length < through) setRoundOneQueue([])
      return
    }
    const newest = picks.slice(through).filter((pick) => pick.round === 1).pop()
    if (!newest) return
    const item: RoundOneAnnouncementQueueItem = {
      id: `mock-r1-${newest.isUser ? 'you' : 'cpu'}-${newest.overall}`,
      pick: toPickSnapshot(newest, draftState.settings.teamCount),
      headshotUrl: newest.headshotUrl ?? null,
      teamLogoUrl: newest.teamLogoUrl ?? null,
    }
    setRoundOneQueue((queue) => (queue[0]?.id.startsWith('mock-r1-you-') ? [queue[0], item] : [item]))
  }, [draftState])

  const availableFilters = useMemo(() => {
    if (!draftState) return ['All']
    const positions = Array.from(new Set(draftState.availablePlayers.map((player) => player.position)))
    return ['All', ...positions]
  }, [draftState])

  function renderLeagueGate() {
    return (
      <div className="af-draft-dark min-h-screen bg-[#070b16] text-white">
        <div className="border-b border-white/6 bg-[#070b16]/95 backdrop-blur-xl">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
            <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-cyan-300">League Mock</div>
            <h1 className="mt-3 text-3xl font-black">Select a league</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/50">
              Practice with league managers, roster layout, and draft settings. Imported Sleeper leagues use their draft order when available, or a predicted order from team records.
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

          {!selectedLeague && !loadingLeagues && leagues.length === 0 ? (
            <div className="rounded-3xl border border-white/8 bg-[#0c1224] p-8 text-center text-sm text-white/55">
              No Sleeper leagues are available on this account yet.
            </div>
          ) : null}

          {!selectedLeague && !loadingLeagues && leagues.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {leagues.map((league) => (
                <button
                  key={league.id}
                  type="button"
                  onClick={() => void loadLeaguePayload(league)}
                  className="rounded-3xl border border-white/8 bg-[#0c1224] p-5 text-left transition-all hover:border-white/15 hover:bg-white/[0.03]"
                  data-testid={`mock-draft-league-card-${league.id}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-200">
                        Sleeper
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/50">
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
              Loading managers and league draft settings...
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
      <div className="af-draft-dark min-h-screen bg-[#070b16] text-white">
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
                // Every size a redraft league of this sport accepts (lib/mock-draft/mockTeamCount.ts).
                options: getMockDraftTeamCountOptions(settings.sport, 'redraft').map((value) => ({ value, label: String(value) })),
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
      <div className="af-draft-dark min-h-screen bg-[#070b16] px-4 py-10 text-white sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-[32px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.15),transparent_42%),#0a1124] p-6 sm:p-8">
            <div className="max-w-2xl">
              <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-cyan-300">Mock Draft Simulator</div>
              <h1 className="mt-4 text-3xl font-black sm:text-4xl">Chimmy-powered drafting for every team in your league</h1>
              <p className="mt-3 text-sm leading-6 text-white/55">
                Import a real Sleeper league for actual managers and draft slots, or build a custom room from scratch and let AllFantasy Chimmy handle every other pick.
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
                  Pick the team count, rounds, draft type, sport, scoring, and your slot. Chimmy drafts every other team locally.
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

    const boardNode = <DraftBoardPreview
      teams={draftState.teams.map((team) => ({
        id: String(team.slot), slot: team.slot, name: team.managerName + (team.slotPredicted ? ' (predicted)' : ''),
        avatarUrl: team.avatarUrl, isUser: team.isUser, isCpu: team.isAI, isOrphan: team.isOrphan,
      }))}
      picks={draftState.picks.map((pick) => ({ ...pick, rosterId: String(pick.slot), amount: pick.price ?? null }))}
      teamCount={draftState.settings.teamCount} rounds={draftState.settings.rounds}
      draftType={draftState.settings.draftType} sport={draftState.settings.sport}
      currentOverall={draftState.status === 'drafting' ? draftState.currentPick : null}
      slotSalaryByOverall={draftState.settings.draftType === 'auction' ? null : leaguePayload?.leagueFacts?.slotSalaryByOverall ?? null}
      signatureByOverall={signatureByOverall}
    />

    const sport = draftState.settings.sport
    const byeById = new Map(draftState.availablePlayers.map((player) => [player.id, player.byeWeek ?? null] as const))
    const pickOrNominate = (player: AvailablePlayer) => {
      if (draftedIds.has(player.id) || !isUserTurn) return
      // Auction: your turn is a nomination.
      if (draftState.auction) auctionNominate(player.id)
      else handlePick(player, false, draftState.currentPick)
    }
    const addToQueue = (playerId: string) =>
      setQueue((current) => (current.includes(playerId) ? current : [...current, playerId]))

    const queueList = (
      <div className="flex h-full min-h-0 flex-col bg-[#0c0c1e]" data-testid="mock-draft-queue-panel">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {queuePlayers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-xs text-white/45">{mockCopy.queueEmpty}</div>
          ) : (
            queuePlayers.map((player, index) => (
              <div key={player.id} data-testid={`mock-draft-queue-entry-${player.id}`} className="rounded-xl border border-orange-400/20 bg-orange-500/10 p-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[11px] font-black text-orange-200">#{index + 1}</span>
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-black" style={positionChipStyle(player.position, sport)}>
                    {player.position}
                  </span>
                  <PlayerAvatar
                    headshotUrl={player.headshotUrl}
                    displayName={player.name}
                    teamLogoUrl={player.teamLogoUrl}
                    teamAbbr={player.team}
                    position={player.position}
                    size={24}
                  />
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
                    className="min-h-[36px] rounded-lg border border-white/10 px-3 text-[11px] text-white/65 hover:text-white"
                  >
                    {mockCopy.up}
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
                    className="min-h-[36px] rounded-lg border border-white/10 px-3 text-[11px] text-white/65 hover:text-white"
                  >
                    {mockCopy.down}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQueue((current) => current.filter((id) => id !== player.id))}
                    className="min-h-[36px] rounded-lg border border-white/10 px-3 text-[11px] text-red-300/80 hover:text-red-200"
                  >
                    {mockCopy.remove}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    )

    /*
     * Room v2 pool (phase 4's order, in the mock): Draft — or Nominate in an auction — leads every
     * row, then Queue, then the player. Both are 44px touch targets. Tapping the player row still
     * drafts on your turn, as it always has.
     */
    const poolPanel = (
      <div className="flex h-full min-h-0 flex-col bg-[#0c0c1e]" data-testid="mock-draft-pool-panel">
        {isUserTurn && draftState.settings.speed > 0 ? (
          <div className="h-1.5 w-full shrink-0 bg-white/5">
            <div
              className={`h-full ${draftState.timerSeconds <= 5 ? 'bg-red-500' : 'bg-cyan-500'}`}
              style={{ width: `${Math.max(0, Math.min(100, (draftState.timerSeconds / draftState.settings.speed) * 100))}%` }}
            />
          </div>
        ) : null}
        <div className="shrink-0 border-b border-white/8 p-3">
          <div className="flex flex-wrap items-center gap-1">
            {availableFilters.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`min-h-[32px] rounded-lg px-2.5 py-1 text-[11px] font-black ${
                  filter === option ? 'bg-cyan-400 text-[#06101f]' : 'bg-white/8 text-white/60'
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
            placeholder={mockCopy.searchPlaceholder}
            className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
            data-testid="mock-draft-player-search"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-white/55">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={showDrafted} onChange={(event) => setShowDrafted(event.target.checked)} />
              {mockCopy.showDrafted}
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={rookiesOnly} onChange={(event) => setRookiesOnly(event.target.checked)} />
              {mockCopy.rookiesOnly}
            </label>
            <label className="inline-flex items-center gap-2" title={TOOLTIP_AF_ADP}>
              <input
                type="checkbox"
                checked={poolSort === 'afAdp'}
                onChange={(event) => setPoolSort(event.target.checked ? 'afAdp' : 'adp')}
                data-testid="mock-draft-sort-af-adp"
              />
              {mockCopy.sortBy} <span style={{ color: AF_BLUE }}>{ADP_LABEL_AF}</span>
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1" data-testid="mock-draft-pool-list">
          {filteredPlayers.map((player, index) => {
            const drafted = draftedIds.has(player.id)
            const queued = queue.includes(player.id) && !drafted
            const auction = Boolean(draftState.auction)
            return (
              <div key={player.id} className="flex flex-wrap items-center gap-x-1.5 border-b border-white/[0.04] py-1" data-testid={`mock-draft-pool-row-${player.id}`}>
                <button
                  type="button"
                  disabled={drafted || !isUserTurn}
                  onClick={() => pickOrNominate(player)}
                  aria-label={auction ? mockCopy.nominateAria(player.name) : mockCopy.draftAria(player.name)}
                  className="h-11 min-w-[72px] shrink-0 touch-manipulation rounded-lg bg-cyan-400 px-3 text-xs font-bold text-[#06101f] transition hover:bg-cyan-300 disabled:bg-white/[0.06] disabled:text-white/35"
                  data-testid={`mock-draft-player-draft-${player.id}`}
                >
                  {auction ? mockCopy.nominate : mockCopy.draft}
                </button>
                <button
                  type="button"
                  disabled={drafted || queued}
                  aria-label={mockCopy.queueAria(player.name)}
                  onClick={() => addToQueue(player.id)}
                  className="h-11 shrink-0 touch-manipulation rounded-lg border border-white/15 px-3 text-xs text-cyan-200 disabled:opacity-40"
                  data-testid={`mock-draft-queue-add-${player.id}`}
                >
                  {queued ? mockCopy.queued : mockCopy.queueAdd}
                </button>
                <button
                  type="button"
                  onContextMenu={(event) => {
                    event.preventDefault()
                    if (!drafted) addToQueue(player.id)
                  }}
                  onClick={() => pickOrNominate(player)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-all ${
                    isUserTurn && !drafted ? 'hover:bg-white/8' : 'cursor-default'
                  } ${drafted ? 'opacity-45' : ''} ${player.injuryStatus === 'OUT' ? 'opacity-50' : ''}`}
                  data-testid={`mock-draft-player-row-${player.id}`}
                >
                  <div className="w-5 shrink-0 text-right text-[11px] text-white/35">{index + 1}</div>
                  <div className="w-9 shrink-0 rounded px-1 py-0.5 text-center text-[11px] font-black" style={positionChipStyle(player.position, sport)}>
                    {player.position}
                  </div>
                  <PlayerAvatar
                    headshotUrl={player.headshotUrl}
                    displayName={player.name}
                    teamLogoUrl={player.teamLogoUrl}
                    teamAbbr={player.team}
                    position={player.position}
                    size={32}
                    testIdBase={`mock-draft-player-avatar-${player.id}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-white/90">{player.name}</div>
                    <div className="text-[11px] text-white/45">
                      {player.team || 'FA'} · {player.posRank}
                      {sportHasByeWeeks(sport) && player.byeWeek != null ? (
                        <span data-testid={`mock-draft-player-bye-${player.id}`}> · BYE {player.byeWeek}</span>
                      ) : null}
                    </div>
                  </div>
                  {queued ? (
                    <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[11px] font-black text-orange-200">{mockCopy.queued}</span>
                  ) : null}
                  {player.injuryStatus ? <span className="text-[11px] font-black text-red-300">{player.injuryStatus}</span> : null}
                  {/* Laptop and tablet: the sport's stat columns, each with its own label. */}
                  <div className="hidden shrink-0 items-center gap-3 md:flex" data-testid={`mock-draft-player-stats-${player.id}`}>
                    {mockPoolStatCells(player, sport).map((cell) => (
                      <div key={cell.key} className="flex w-11 flex-col items-end leading-tight">
                        <span className="text-[11px] uppercase tracking-wide text-white/40">{cell.label}</span>
                        <span className="font-mono text-[12px] text-white/85">{cell.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex shrink-0 flex-col items-end leading-tight">
                    <span className="font-mono text-[11px] text-white/45" title={systemAdpCellTitle(player.adp != null)} data-testid={`mock-draft-player-adp-${player.id}`}>
                      {player.adp?.toFixed(1) ?? '—'}
                    </span>
                    <span
                      className="font-mono text-[11px] font-semibold"
                      style={player.afAdp != null ? { color: AF_BLUE } : { color: 'rgba(255,255,255,0.3)' }}
                      title={afAdpCellTitle({
                        hasValue: player.afAdp != null,
                        contributions: player.afAdpContributions ?? null,
                        importedSampleSize: player.afAdpImportedSampleSize ?? null,
                        ownSampleSize: player.afAdpOwnSampleSize ?? null,
                      })}
                      data-testid={`mock-draft-player-af-adp-${player.id}`}
                    >
                      AF {player.afAdp != null ? player.afAdp.toFixed(1) : '—'}
                    </span>
                  </div>
                </button>
                {/*
                 * Phones: the stat line gets a row of its own under the player. Beside the Draft and
                 * Queue buttons the name column is ~75px, too narrow for any stat line to fit.
                 */}
                {(() => {
                  const line = mockPoolPhoneStatLine(player, sport)
                  return line ? (
                    <div
                      className="basis-full truncate pb-0.5 pl-1 text-[11px] text-white/60 md:hidden"
                      data-testid={`mock-draft-player-stats-line-${player.id}`}
                    >
                      {line}
                    </div>
                  ) : null
                })()}
              </div>
            )
          })}
        </div>
      </div>
    )

    /*
     * Phase 7 (2026-11-19): the mock's roster is the live room's "My team" panel — plain slot names
     * in the sport's own order, BN for the bench, the pick each player went at, his bye in football,
     * and a team picker. The old list had no bench, so every pick past the starting slots vanished.
     */
    const mockStarterSlots = mockStarterSlotCounts(getRosterSlots(draftState.settings))
    const mockStarterTotal = Object.values(mockStarterSlots).reduce((sum, n) => sum + n, 0)
    const rosterList = (
      <div className="h-full min-h-0 overflow-hidden" data-testid="mock-draft-roster-panel">
        <ResultsRosterPanel
          teams={draftState.teams.map(
            (team): ResultsRosterPanelTeam => ({
              rosterId: String(team.slot),
              displayName: team.managerName,
              isCurrentUser: team.isUser,
              isAi: team.isAI,
            }),
          )}
          picks={draftState.picks.map(
            (pick): ResultsRosterPanelPick => ({
              rosterId: String(pick.slot),
              playerName: pick.playerName,
              position: pick.position,
              team: pick.team || null,
              overall: pick.overall,
              byeWeek: byeById.get(pick.playerId) ?? null,
              pickLabel: draftState.auction ? null : mockPickLabel(pick.overall, draftState.settings.teamCount),
              imageUrl: pick.headshotUrl ?? null,
            }),
          )}
          currentUserRosterId={String(draftState.teams.find((team) => team.isUser)?.slot ?? '') || null}
          starterSlots={mockStarterSlots}
          benchSlots={Math.max(0, draftState.settings.rounds - mockStarterTotal)}
          sport={sport}
          testIdBase="mock-draft-roster"
        />
      </div>
    )

    const chatBox = (
      <div className="flex h-full min-h-0 flex-col bg-[#0c0c1e] p-3" data-testid="mock-draft-chat-box">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto" data-mock-chat-log="">
          {draftState.chatMessages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-lg px-2 py-1.5 text-[11px] ${message.role === 'ai' ? 'bg-cyan-500/10 text-cyan-100' : 'bg-white/5 text-white/70'}`}
            >
              {message.content}
              {message.queueProposal ? (
                <MockQueueCardForMessage message={message} onResolve={(action) => resolveQueueProposal(index, action)} />
              ) : null}
              {message.proUpsell && message.proUpsell.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/10 pt-2" data-testid="mock-draft-pro-upsell">
                  <span className="text-white/60">{proUpsellLine(message.proUpsell)}</span>
                  <a
                    href={CHIMMY_PRO_TOOL_UPGRADE_HREF}
                    className="rounded-lg bg-white/10 px-2 py-1 font-bold text-white hover:bg-white/15"
                  >
                    Get AF Pro
                  </a>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-3 flex shrink-0 gap-2">
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void sendChat()
            }}
            placeholder={mockCopy.chatPlaceholder}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none"
            data-testid="mock-draft-chat-input"
          />
          <button
            type="button"
            onClick={() => void sendChat()}
            className="min-h-[40px] rounded-xl bg-white/10 px-3 text-xs text-white/75 hover:text-white"
            data-testid="mock-draft-chat-send"
          >
            {mockCopy.send}
          </button>
          <button
            type="button"
            onClick={() => void askAi()}
            className="min-h-[40px] rounded-xl bg-[linear-gradient(135deg,#7c3aed,#0891b2)] px-3 text-xs font-bold text-white"
            data-testid="mock-draft-ask-ai"
          >
            {headerCopy.askChimmy}
          </button>
        </div>
      </div>
    )

    const dockPanels: Record<MockDockTab, ReactNode> = { queue: queueList, roster: rosterList, chat: chatBox }
    const dockTabs: Array<{ id: MockDockTab; label: string }> = [
      { id: 'queue', label: mockCopy.queue },
      { id: 'roster', label: mockCopy.roster },
      { id: 'chat', label: mockCopy.chat },
    ]

    /*
     * Desktop and tablet (768px up), the live room's phase-3 arrangement: on a laptop the pool and
     * a Queue / Roster / Chat dock sit side by side; on a portrait tablet one tab bar (Players plus
     * the dock tabs) sits over both and they take turns at full width.
     */
    const centerColumn = (
      <div className="flex min-h-0 flex-1 flex-col" data-testid="mock-draft-desktop-layout">
        <div className="shrink-0 lg:hidden">
          <MockDockTabBar
            testIdBase="mock-draft-tablet"
            tabs={[{ id: 'players', label: mockCopy.players }, ...dockTabs]}
            active={tabletPanel === 'players' ? 'players' : dockTab}
            onSelect={(id) => {
              if (id === 'players') setTabletPanel('players')
              else selectDockTab(id)
            }}
          />
        </div>
        <div className="flex min-h-0 flex-1">
          <div
            className={`min-h-0 min-w-0 flex-1 overflow-hidden border-r border-white/[0.06] ${
              tabletPanel === 'players' ? 'max-lg:border-r-0' : 'max-lg:hidden'
            }`}
          >
            {poolPanel}
          </div>
          <div
            className={`flex min-h-0 w-[min(380px,34vw)] shrink-0 flex-col max-lg:w-auto max-lg:flex-1 ${tabletPanel === 'dock' ? '' : 'max-lg:hidden'}`}
            data-testid="mock-draft-dock"
          >
            <div className="shrink-0 max-lg:hidden">
              <MockDockTabBar testIdBase="mock-draft-dock" tabs={dockTabs} active={dockTab} onSelect={(id) => selectDockTab(id as MockDockTab)} />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{dockPanels[dockTab]}</div>
          </div>
        </div>
      </div>
    )

    /** Phone tray panels: a named region with Close, as the mock's tray always had. */
    const trayPanel = (title: string, body: ReactNode) => (
      <div role="region" aria-label={title} className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-2 py-2">
          <div className="text-sm font-bold text-white">{title}</div>
          <button type="button" onClick={() => setMobileTab('board')} className="min-h-[36px] px-2 text-white/65">
            {mockCopy.close}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{body}</div>
      </div>
    )

    const status = draftState.status
    /* A league mock takes its league's real type (the same reader as the live room); an open mock has no league, so no chip. */
    const leagueAccent = leaguePayload ? leagueAccentFor(leaguePayload.leagueConcept ?? null, { isDynasty: leaguePayload.isDynasty }) : null
    const pausePill =
      status === 'complete' ? null : status === 'drafting' ? (
        <button
          type="button"
          onClick={pauseMock}
          className="inline-flex h-8 items-center rounded-full border border-amber-400/40 bg-amber-500/12 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-100 hover:bg-amber-500/20"
          data-testid="mock-draft-pause"
        >
          {mockCopy.pause}
        </button>
      ) : (
        <button
          type="button"
          onClick={resumeMock}
          className="inline-flex h-8 items-center rounded-full border border-emerald-400/40 bg-emerald-500/14 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-100 hover:bg-emerald-500/20"
          data-testid="mock-draft-resume"
        >
          {mockCopy.resume}
        </button>
      )

    const topBar = (
      <>
        <DraftTopBar
          leagueName={leaguePayload?.leagueName ?? mockCopy.openMock}
          leagueAccent={leagueAccent}
          leagueNote={leaguePayload?.leagueFacts?.note ?? null}
          sport={sport}
          draftType={draftState.settings.draftType}
          teamCount={draftState.settings.teamCount}
          rounds={draftState.settings.rounds}
          currentManagerOnClock={status === 'complete' ? null : onTheClockTeam?.managerName ?? null}
          currentManagerAvatarUrl={onTheClockTeam?.avatarUrl ?? null}
          isCurrentUserOnClock={isUserTurn}
          pickLabel={status === 'complete' || draftState.auction ? null : mockPickLabel(draftState.currentPick, draftState.settings.teamCount)}
          overallPickNumber={status === 'complete' || draftState.auction ? null : draftState.currentPick}
          timerStatus={
            status === 'paused' ? 'paused' : status === 'drafting' && isUserTurn && !draftState.auction && draftState.settings.speed > 0 ? 'running' : 'none'
          }
          timerRemainingSeconds={draftState.settings.speed > 0 && !draftState.auction ? draftState.timerSeconds : null}
          timerSeconds={draftState.settings.speed > 0 && !draftState.auction ? draftState.settings.speed : null}
          isCommissioner={false}
          draftStatus={status === 'drafting' ? 'in_progress' : status === 'complete' ? 'completed' : 'paused'}
          showAutoPickPill={false}
          showInvite={false}
          controlsSlot={pausePill}
          extraMenuItems={[
            { id: 'reset', label: mockCopy.reset, description: mockCopy.resetDesc, testId: 'mock-draft-reset', onSelect: resetToSetup },
            { id: 'export', label: mockCopy.exportLabel, description: mockCopy.exportDesc, testId: 'mock-draft-export', onSelect: exportDraft },
          ]}
          onOpenDraftRoomSettings={() => setSettingsOpen(true)}
          onOpenChimmy={openChimmy}
          picksUntilUser={picksUntilUser}
          idleClockLabel={
            status !== 'drafting' ? null : draftState.auction ? mockCopy.auctionLive : isUserTurn ? (draftState.settings.speed > 0 ? null : mockCopy.yourPick) : mockCopy.cpuPicking
          }
        />
        {recoveredDraft && status === 'paused' ? (
          <p role="status" className="shrink-0 border-b border-white/8 bg-[#060d1f] px-3 py-2 text-sm text-cyan-200">
            {mockCopy.recovered}
          </p>
        ) : null}
      </>
    )

    /* The live room's dark phone clock bar, under the header. */
    const clockBar = (
      <div className="af-core af-dr af-dr-clockbar" role="region" aria-label={roomCopy.clockBarAria} data-testid="mock-draft-clockbar">
        <div className="af-dr-clockbar-top">
          <span className="af-dr-clockbar-pick" data-testid="mock-draft-current-pick">
            {roomCopy.mockPickLabel(draftState.currentPick)}
            <small>{onTheClockTeam?.managerName ?? ''}</small>
          </span>
          {clockProgress != null ? (
            <span className="af-dr-clockbar-time" data-urgent={clockUrgent ? 'true' : undefined} data-testid="mock-draft-clock">
              {roomCopy.mockSecondsLeft(draftState.timerSeconds)}
            </span>
          ) : null}
        </div>
        {clockStatus ? (
          <span className="af-dr-clockbar-status" data-on-clock={isUserTurn ? 'true' : undefined} data-testid="mock-draft-clock-status">
            {clockStatus}
          </span>
        ) : null}
        {clockProgress != null ? (
          <span className="af-dr-clockbar-progress" aria-hidden>
            <span style={{ width: `${clockProgress}%` }} />
          </span>
        ) : null}
      </div>
    )

    return (
      <LanguageFallbackBoundary>
        <DraftRoomShell
          layout="premium"
          leagueAccent={leagueAccent}
          topBar={topBar}
          managerStrip={null}
          modeBanner={<DraftModeBanner mode="mock" />}
          auctionStrip={auctionPanelProps ? <div data-testid="mock-draft-auction-stage"><AuctionSpotlightPanel {...auctionPanelProps} /></div> : undefined}
          mobileBidDock={auctionPanelProps ? <AuctionBidDock {...auctionPanelProps} /> : undefined}
          mobileStickyBar={clockBar}
          draftBoard={boardNode}
          centerColumn={centerColumn}
          playerPanel={trayPanel(mockCopy.players, poolPanel)}
          queuePanel={trayPanel(mockCopy.queue, queueList)}
          rosterPanel={trayPanel(mockCopy.currentRoster, rosterList)}
          chatPanel={trayPanel(mockCopy.draftChat, chatBox)}
          mobileTab={mobileTab}
          onMobileTabChange={setMobileTab}
        />

        {!draftState.auction ? (
          <DraftRoundOneAnnouncementOverlay
            variant="toast"
            leagueName={leaguePayload?.leagueName ?? undefined}
            sportLabel={sport}
            queue={roundOneQueue}
            onDismissFront={dismissRoundOne}
          />
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
                              turnDeadlineMs: current.status === 'drafting' ? Date.now() + mockTurnDurationMs(nextSpeed, Boolean(current.teams.find((team) => team.slot === current.onTheClock)?.isUser)) : null,
                              pausedRemainingMs: current.status === 'paused' ? mockTurnDurationMs(nextSpeed, Boolean(current.teams.find((team) => team.slot === current.onTheClock)?.isUser)) : undefined,
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
      </LanguageFallbackBoundary>
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
      <div className="af-draft-dark min-h-screen bg-[#070b16] px-4 py-10 text-white sm:px-6">
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
                    <div className="mb-2 text-[11px] text-white/35">#{pick.overall}</div>
                    <div className="flex items-center gap-2">
                      <PlayerAvatar
                        headshotUrl={pick.headshotUrl}
                        displayName={pick.playerName}
                        teamLogoUrl={pick.teamLogoUrl}
                        teamAbbr={pick.team}
                        position={pick.position}
                        size={36}
                      />
                      <span className="rounded px-1.5 py-0.5 text-[11px] font-black" style={positionChipStyle(pick.position, draftState?.settings.sport)}>
                        {pick.position}
                      </span>
                      <span className="truncate text-sm font-semibold text-white">{pick.playerName}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-white/35">{pick.team || 'FA'} · ADP {pick.adp?.toFixed(1) ?? '\u2014'}</div>
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

  if (!checkpointReady) return <p role="status">Restoring mock draft…</p>
  const content = step === 'entry' ? renderEntry()
    : step === 'league' ? renderLeagueGate()
    : step === 'open' ? renderOpenSetup()
    : step === 'complete' ? renderCompletion() : renderDraftBoard()
  return <>
    {checkpointError ? <p role="alert" className="p-3 text-sm text-amber-200">{checkpointError}</p> : null}
    {content}
  </>
}
