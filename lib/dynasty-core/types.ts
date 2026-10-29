/**
 * [NEW] lib/dynasty-core/types.ts
 * DTOs and shapes for Dynasty settings (roster, scoring, playoff, rookie draft).
 */

export interface DynastyRosterPresetDto {
  id: string
  label: string
  formatType: string
  /** Starter slots: slotName -> count */
  starterSlots: Record<string, number>
  benchCount: number
  irCount: number
  taxiCount: number
  superflexOn: boolean
  kickerOn: boolean
  defenseOn: boolean
  idpOn: boolean
}

export interface DynastyScoringPresetDto {
  id: string
  label: string
  formatType: string
  /** Summary for display */
  summary: string
}

export interface DynastyPlayoffPresetDto {
  playoffTeamCount: number
  label: string
  firstRoundByes: number
  playoffWeeks: number
  /**
   * Suggested start week. NFL only — null for every other sport, whose season length differs, so
   * callers keep the league's existing start week instead of overwriting it.
   */
  playoffStartWeek: number | null
}

export interface DynastyLeagueConfigDto {
  leagueId: string
  regularSeasonWeeks: number
  rookiePickOrderMethod: string
  useMaxPfForNonPlayoff: boolean
  rookieDraftRounds: number
  rookieDraftType: string
  divisionsEnabled: boolean
  tradeDeadlineWeek: number | null
  waiverTypeRecommended: string
  futurePicksYearsOut: number
  taxiSlots: number
  taxiEligibilityYears: number
  taxiLockBehavior: string
  taxiInSeasonMoves: boolean
  taxiPostseasonMoves: boolean
  taxiScoringOn: boolean
  taxiDeadlineWeek: number | null
  taxiPromotionDeadlineWeek: number | null
}

export interface DynastySettingsEffectiveDto {
  /** From League.settings + League */
  leagueSize: number | null
  rosterFormatType: string
  scoringFormatType: string
  playoffTeamCount: number
  playoffStructure: Record<string, unknown>
  regularSeasonWeeks: number
  /** From DynastyLeagueConfig or defaults */
  rookiePickOrderMethod: string
  useMaxPfForNonPlayoff: boolean
  rookieDraftRounds: number
  rookieDraftType: string
  divisionsEnabled: boolean
  tradeDeadlineWeek: number | null
  waiverTypeRecommended: string
  futurePicksYearsOut: number
  /** Resolved roster slot summary for display */
  rosterSummary: { slotName: string; count: number }[]
  /** Resolved scoring preset name */
  scoringPresetName: string
  /** Taxi squad settings (PROMPT 3/5) */
  taxiSlots: number
  taxiEligibilityYears: number
  taxiLockBehavior: string
  taxiInSeasonMoves: boolean
  taxiPostseasonMoves: boolean
  taxiScoringOn: boolean
  taxiDeadlineWeek: number | null
  taxiPromotionDeadlineWeek: number | null
  /** Open the rookie draft automatically when its window opens (`rookieDraftCalendar.ts`). */
  rookieDraftAutoOpen: boolean
  /** Why auto-open is what it is: the commissioner's switch, or the plan default (`resolveRookieDraftAutoOpen`). */
  rookieDraftAutoOpenSource: 'commissioner' | 'plan_default' | 'plan_default_predates' | 'free_default'
  /** `YYYY-MM-DD` overriding the sport's window for one offseason; null = sport default. */
  rookieDraftCustomOpenDate: string | null
  /** Days after an automatic open that the rookie draft starts by itself; null = the commissioner presses Start. */
  rookieDraftAutoStartDays: 3 | 7 | 14 | null
  /** The sport's default window in words ("May", "November–January"); null when the sport has none. */
  rookieDraftWindowLabel: string | null
}

export interface DynastyDraftOrderAuditEntryDto {
  id: string
  season: number
  userId: string
  reason: string | null
  createdAt: string
}
