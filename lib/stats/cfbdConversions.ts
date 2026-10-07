import type { CfbdGameLogRow } from './cfbdGameLogs'

const nameKey = (s: unknown) => String(s ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')
export type ConversionEvidence = { playerId: string; gameId: string; key: 'conversions.PASS' | 'conversions.RUSH' | 'conversions.REC'; playId: string; source: 'espn-summary' }

/** Exact game, team, athlete ID and full-name agreement across the two providers. */
export function extractEspnConversions(summary: any, gameId: string, rows: readonly CfbdGameLogRow[]): { evidence: ConversionEvidence[]; gaps: string[] } {
  const id = gameId.replace(/^cfbd:/, '')
  if (String(summary?.header?.id) !== id || !Array.isArray(summary?.scoringPlays)) return { evidence: [], gaps: ['summary game/scoring evidence missing'] }
  const schools = new Map<string, string>((summary.header.competitions?.[0]?.competitors ?? []).map((c: any) => [String(c.team?.id), nameKey(c.team?.location)]))
  const athletes = (summary.boxscore?.players ?? []).flatMap((team: any) => (team.statistics ?? []).flatMap((s: any) => (s.athletes ?? []).map((a: any) => ({ id: String(a.athlete?.id), name: nameKey(a.athlete?.displayName), school: schools.get(String(team.team?.id)) }))))
  const evidence: ConversionEvidence[] = [], gaps: string[] = []; const seen = new Map<string, string>()
  for (const play of summary.scoringPlays) {
    const text = String(play.text ?? '')
    if (!/two[- ]point conversion/i.test(text) || /conversion failed/i.test(text)) continue
    // A defensive try is not an offensive conversion. Only explicit successful parenthesized tries.
    const pass = /\(([^()]+?) Pass to ([^()]+?) for Two-Point Conversion\)/i.exec(text)
    const run = /\(([^()]+?) Run for Two-Point Conversion\)/i.exec(text)
    if (!pass && !run) { gaps.push(`unrecognized conversion play ${play.id}`); continue }
    const playId = String(play.id ?? '')
    if (!playId) { gaps.push('conversion without play ID'); continue }
    if (seen.has(playId)) { if (seen.get(playId) !== text) return { evidence: [], gaps: ['conflicting duplicate play ID'] }; continue }
    seen.set(playId, text)
    const school = schools.get(String(play.team?.id)); if (!school) { gaps.push(`missing school ${playId}`); continue }
    const roles: Array<[string, ConversionEvidence['key']]> = pass ? [[pass[1]!, 'conversions.PASS'], [pass[2]!, 'conversions.REC']] : [[run![1]!, 'conversions.RUSH']]
    for (const [name, key] of roles) {
      const candidates = [...new Set(athletes.filter((a: any) => a.school === school && a.name === nameKey(name)).map((a: any) => a.id))]
      const row = candidates.length === 1 ? rows.find(r => r.gameId === gameId && r.playerId === candidates[0] && nameKey(r.statPayload.name) === nameKey(name) && nameKey(r.statPayload._team) === school) : null
      if (!row) { gaps.push(`unmatched conversion athlete ${playId}:${key}`); continue }
      evidence.push({ playerId: row.playerId, gameId, key, playId, source: 'espn-summary' })
    }
  }
  return { evidence, gaps }
}

/** Pure enrichment; an unavailable endpoint never creates a conversion or a verified zero. */
export function applyConversionEvidence(rows: readonly CfbdGameLogRow[], evidence: readonly ConversionEvidence[], verifiedGames: readonly string[] = []): CfbdGameLogRow[] {
  return rows.map(row => {
    const matches = evidence.filter(e => e.playerId === row.playerId && e.gameId === row.gameId)
    if (!matches.length && !(verifiedGames.includes(row.gameId) && row.statPayload._conversionSource === 'espn-summary')) return row
    const statPayload = { ...row.statPayload }
    // Remove only our own previous evidence when a complete refresh corrects a play.
    if (verifiedGames.includes(row.gameId) && statPayload._conversionSource === 'espn-summary') {
      for (const key of ['conversions.PASS', 'conversions.RUSH', 'conversions.REC', '_conversionSource', '_conversionPlayIds']) delete statPayload[key]
    }
    if (!matches.length) return { ...row, statPayload }
    for (const key of ['conversions.PASS', 'conversions.RUSH', 'conversions.REC'] as const) {
      const count = new Set(matches.filter(e => e.key === key).map(e => e.playId)).size
      if (count) statPayload[key] = count // Replace evidence-derived count on refresh; never increment stored counts.
    }
    statPayload._conversionSource = 'espn-summary'
    statPayload._conversionPlayIds = [...new Set(matches.map(e => e.playId))].sort().join(',')
    return { ...row, statPayload }
  })
}

/** Box-score XP deficits identify games to probe; the deficit itself is NEVER a stat. */
export function conversionCandidateGames(rows: readonly CfbdGameLogRow[]): string[] {
  const teams = new Map<string, { gameId: string; touchdowns: number; attempts: number }>()
  for (const r of rows) {
    const key = `${r.gameId}:${r.statPayload._team}`
    const t = teams.get(key) ?? { gameId: r.gameId, touchdowns: 0, attempts: 0 }
    t.touchdowns += Number(r.statPayload['passing.TD'] ?? 0) + Number(r.statPayload['rushing.TD'] ?? 0)
    t.attempts += Number(r.statPayload['kicking.XPA'] ?? 0)
    teams.set(key, t)
  }
  return [...new Set([...teams.values()].filter(t => t.touchdowns > t.attempts).map(t => t.gameId).concat(rows.filter(r => r.statPayload._conversionSource === 'espn-summary').map(r => r.gameId)))].sort()
}

export async function enrichCfbdConversions(rows: CfbdGameLogRow[], fetchSummary: (id: string) => Promise<unknown>, maxGames = 16): Promise<{ rows: CfbdGameLogRow[]; evidence: ConversionEvidence[]; gaps: string[]; verifiedGames: string[] }> {
  const candidates = conversionCandidateGames(rows), evidence: ConversionEvidence[] = [], gaps: string[] = [], verifiedGames: string[] = []
  if (candidates.length > maxGames) gaps.push(`${candidates.length - maxGames} conversion candidate games deferred`)
  // Bounded batches: at most 16 calls, four at a time, within the collector's cron budget.
  for (let i = 0; i < Math.min(candidates.length, maxGames); i += 4) {
    await Promise.all(candidates.slice(i, Math.min(i + 4, maxGames)).map(async gameId => {
      try {
        const summary = await fetchSummary(gameId.replace(/^cfbd:/, ''))
        const parsed = extractEspnConversions(summary, gameId, rows)
        evidence.push(...parsed.evidence)
        // A live or incomplete summary may add explicit evidence, but cannot retract a prior try.
        if (!parsed.gaps.length && (summary as any)?.header?.competitions?.[0]?.status?.type?.completed === true) verifiedGames.push(gameId)
        gaps.push(...parsed.gaps.map(g => `${gameId}: ${g}`))
      }
      catch { gaps.push(`${gameId}: conversion summary unavailable`) }
    }))
  }
  return { rows: applyConversionEvidence(rows, evidence, verifiedGames), evidence, gaps, verifiedGames }
}
