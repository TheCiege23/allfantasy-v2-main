import { classifyRiSeasonType } from '@/lib/sports-data/riSeasonType'
import { classifyRiLiveStartState } from './seasonActualStartEvidence'
import { seasonContractHash } from './seasonCalendarVerification'
import type { LockedProviderPair } from './seasonLockedPlayerCoverage'
import type { SeasonOutcomeClaim } from './seasonOutcomeEvidence'
import { seasonOutcomeSubjectKey } from './seasonOutcomeEvidence'

type Candidate = { requestId: string; claim: SeasonOutcomeClaim; artifact: Record<string, unknown> }
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/** Bounded structural observations from a single fresh daily slate. A line's presence never proves participation or a zero score. */
export function planSeasonObservedBoxCandidates(input: {
  sport: 'NBA' | 'NFL'; sourceDate: string; observedAt: string; rawGames: Map<string, Record<string, unknown>>
  lockedPairs: LockedProviderPair[]; maxCandidates?: number; latestObservedArtifacts?: Map<string, string>
  suppressedSubjects?: Set<string>
}) {
  const maxCandidates = input.maxCandidates ?? 25
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sourceDate) || !Number.isFinite(Date.parse(input.observedAt)) ||
    !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 50 || input.lockedPairs.length > 10000) {
    throw new Error('Observed-line candidate plan exceeds its bounded input contract.')
  }
  const candidates: Candidate[] = []
  let unresolvedPairs = 0, missingGamePairs = 0, nonFinalPairs = 0, unverifiedBoxPairs = 0, absentPlayerPairs = 0, unchangedPairs = 0, suppressedPairs = 0
  const boxes = new Map<string, Map<string, { side: 'away_team' | 'home_team'; line: Record<string, unknown> }> | null>()
  const ordered = [...input.lockedPairs].sort((a, b) => `${a.providerGameId}:${a.providerPlayerId}`.localeCompare(`${b.providerGameId}:${b.providerPlayerId}`))
  const seen = new Set<string>()
  for (const pair of ordered) {
    if (!pair.providerGameId || !pair.providerPlayerId) { unresolvedPairs++; continue }
    const key = `${pair.providerGameId}:${pair.providerPlayerId}`
    if (seen.has(key)) throw new Error('Duplicate locked player/game pair in observed-line plan.')
    seen.add(key)
    const raw = input.rawGames.get(pair.providerGameId)
    if (!raw) { missingGamePairs++; continue }
    if (String(raw.game_ID ?? '') !== pair.providerGameId || classifyRiSeasonType(raw.season_type) !== 'regular' ||
      classifyRiLiveStartState(raw.status ?? raw.game_status) !== 'final') { nonFinalPairs++; continue }
    if (!boxes.has(pair.providerGameId)) {
      const box = record(raw.player_box), away = record(box?.away_team), home = record(box?.home_team)
      const lines = new Map<string, { side: 'away_team' | 'home_team'; line: Record<string, unknown> }>()
      let valid = Boolean(away && home && Object.keys(away).length && Object.keys(home).length)
      for (const [side, entries] of [['away_team', away], ['home_team', home]] as const) {
        if (!entries) continue
        for (const [id, value] of Object.entries(entries)) {
          const line = record(value)
          if (!id || id.length > 200 || !line || lines.has(id)) { valid = false; continue }
          lines.set(id, { side, line })
        }
      }
      boxes.set(pair.providerGameId, valid ? lines : null)
    }
    const lines = boxes.get(pair.providerGameId)
    if (!lines) { unverifiedBoxPairs++; continue }
    const match = lines.get(pair.providerPlayerId)
    if (!match) { absentPlayerPairs++; continue }
    const artifact: Record<string, unknown> = { sport: input.sport, providerGameId: pair.providerGameId, providerPlayerId: pair.providerPlayerId,
      gameStatus: raw.status ?? raw.game_status ?? null, seasonType: raw.season_type, gameDigest: seasonContractHash(raw),
      side: match.side, playerLine: match.line }
    const claim: SeasonOutcomeClaim = { subject: { kind: 'player_game', providerGameId: pair.providerGameId, providerPlayerId: pair.providerPlayerId },
      outcome: 'box_line_present', source: { provider: 'rolling_insights',
        reference: `live/${input.sport}/${input.sourceDate}/${pair.providerGameId}/player_box/${match.side}/${pair.providerPlayerId}`,
        artifactDigest: seasonContractHash(artifact), observedAt: input.observedAt, contract: 'unverified' } }
    const subjectKey = seasonOutcomeSubjectKey(claim.subject)
    if (input.suppressedSubjects?.has(subjectKey)) { suppressedPairs++; continue }
    if (input.latestObservedArtifacts?.get(subjectKey) === claim.source.artifactDigest) { unchangedPairs++; continue }
    candidates.push({ requestId: `boxline-${seasonContractHash({ subject: claim.subject, artifact })}`, claim, artifact })
  }
  return { candidates: candidates.slice(0, maxCandidates), deferredByLimit: Math.max(0, candidates.length - maxCandidates),
    unresolvedPairs, missingGamePairs, nonFinalPairs, unverifiedBoxPairs, absentPlayerPairs, unchangedPairs, suppressedPairs,
    contractVerified: false as const, scoringCertified: false as const }
}
