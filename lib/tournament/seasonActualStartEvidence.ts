export type GameStartObservation = {
  providerGameId: string
  sport: 'NFL' | 'NBA'
  state: 'not_started' | 'in_progress' | 'final' | 'postponed' | 'canceled' | 'unknown'
  observedAt: string
  scheduledAt: string | null
  rawDigest: string
}

export function classifyRiLiveStartState(status: unknown): GameStartObservation['state'] {
  const value = typeof status === 'string' ? status.trim().toLowerCase() : ''
  if (/^(scheduled|pregame|pre-game|not started)$/.test(value)) return 'not_started'
  if (/^(inprogress|in_progress|in progress|live|halftime)$/.test(value)) return 'in_progress'
  if (/^(final|completed|complete)$/.test(value)) return 'final'
  if (/^(postponed|delayed|suspended)$/.test(value)) return 'postponed'
  if (/^cancell?ed$/.test(value)) return 'canceled'
  return 'unknown'
}

/** Observations bound the start; neither a status nor scheduled game_time supplies exact tipoff. */
export function assessSeasonActualStart(observations: GameStartObservation[], options: {
  providerGameId: string; sport: 'NFL' | 'NBA'; periodStartsAt: string; periodEndsAt: string
  lineupLockedAt?: string; maxGapMinutes?: number
}) {
  const blocked = (reason: string) => ({ verifiedWindow: false as const, startAfter: null, startedBy: null, needsCorrectionReview: true, reason })
  if (!observations.length) return blocked('No fresh live-status observations are saved.')
  if (observations.some(o => o.providerGameId !== options.providerGameId || o.sport !== options.sport || !/^[a-f0-9]{64}$/.test(o.rawDigest) || !Number.isFinite(Date.parse(o.observedAt)))) return blocked('A game-status observation has invalid identity or provenance.')
  const ordered = [...observations].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
  if (ordered.some((o, i) => i > 0 && Date.parse(o.observedAt) === Date.parse(ordered[i - 1]!.observedAt) && (o.state !== ordered[i - 1]!.state || o.rawDigest !== ordered[i - 1]!.rawDigest))) return blocked('Conflicting provider states share an observation time.')
  const firstLive = ordered.find(o => o.state === 'in_progress')
  if (!firstLive) return blocked('No in-progress provider observation proves this game started.')
  const lastPregame = ordered.filter(o => o.state === 'not_started' && Date.parse(o.observedAt) < Date.parse(firstLive.observedAt)).at(-1)
  if (!lastPregame) return blocked('No earlier not-started observation bounds the game start.')
  const after = Date.parse(lastPregame.observedAt), by = Date.parse(firstLive.observedAt)
  if (by - after > (options.maxGapMinutes ?? 10) * 60000) return blocked('The observation gap is too wide to certify a lineup or scoring boundary.')
  if (ordered.some(o => Date.parse(o.observedAt) < by && ['final', 'postponed', 'canceled', 'unknown'].includes(o.state))) return blocked('Provider states before live play conflict with the proposed start window.')
  if (ordered.some(o => Date.parse(o.observedAt) >= by && ['not_started', 'postponed', 'canceled', 'unknown'].includes(o.state))) return blocked('A later provider status contradicts the start window; correction review is required.')
  if (!firstLive.scheduledAt || !Number.isFinite(Date.parse(firstLive.scheduledAt)) || ordered.some(o => Date.parse(o.observedAt) >= after && o.scheduledAt !== firstLive.scheduledAt)) return blocked('The scheduled time changed across observations; postponement review is required.')
  const from = Date.parse(options.periodStartsAt), to = Date.parse(options.periodEndsAt)
  if (!Number.isFinite(from) || !Number.isFinite(to) || after < from || by >= to) return blocked('The possible start crosses a scoring-period boundary.')
  if (options.lineupLockedAt !== undefined && (!Number.isFinite(Date.parse(options.lineupLockedAt)) || Date.parse(options.lineupLockedAt) > after)) return blocked('The lineup lock was not proven to precede the actual start.')
  return { verifiedWindow: true as const, startAfter: lastPregame.observedAt, startedBy: firstLive.observedAt, needsCorrectionReview: false, reason: null }
}
