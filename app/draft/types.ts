import type { DraftPickOrderSlot } from '@/lib/draft/pick-order'

export type DraftMode = 'mock' | 'live'

export type DraftPickOrderEntry = DraftPickOrderSlot

export type DraftStatePayload = {
  id: string
  mode: string
  status: string
  currentPick: number
  currentRound: number
  currentTeamIndex: number
  timerEndsAt: string | null
  timerPaused: boolean
  pickOrder: DraftPickOrderEntry[] | null
  leagueId: string | null
  roomId: string | null
  numTeams: number
  numRounds: number
  timerSeconds: number
  updatedAt: string
}

export type DraftPickRecord = {
  id: string
  round: number
  pickNumber: number
  overallPick: number
  originalOwnerId: string
  currentOwnerId: string
  pickedById?: string | null
  playerId: string | null
  playerName: string | null
  position: string | null
  team: string | null
  isTraded: boolean
  autopicked: boolean
  timestamp: string
}

export type DraftPlayerRow = {
  id: string
  name: string
  position: string
  team: string
  imageUrl?: string | null
  /** Sleeper/RI injury/availability code (e.g. "Questionable", "IR", "Out"). */
  status?: string | null
  /**
   * Real consensus ADP, or NULL when the market has not priced this player.
   *
   * Nullable deliberately: /api/draft/players used to send the row's ALPHABETICAL index here
   * (`adp: i + 1` over `orderBy: name asc`), which the pool rendered under an ADP column. A
   * missing ADP has to be expressible, or the only way to fill the field is to invent one.
   */
  adp: number | null
  /**
   * Projected points, or NULL when unknown — which is currently always.
   *
   * Same reasoning as `adp` above: /api/draft/players sent a literal `0`, asserting that every
   * player in the pool would score nothing. `fantasy_projections` exists but holds week-1
   * weekly rows, and a weekly number is not a draft projection.
   */
  proj: number | null
  bye: number | null
  keyStat: string
}
