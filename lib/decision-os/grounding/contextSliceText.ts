/**
 * THE MATCHUP, THE ROSTER AND THE STANDINGS, AS LINES CHIMMY CAN QUOTE (Decision OS hub, serialization, 2026-11-20).
 *
 * 🛑 THE GENERIC RENDERER LOST THE THREE MOST-ASKED FACTS IN THE PACKET. Measured by feeding a 16-player roster, a
 * 12-team table and a week-14 matchup through `serialize.ts`:
 *   - Roster:    "starters: 10 items (not itemised here)" — WHO IS ON THE ROSTER never reached the prompt. The
 *                roster branch of `renderItem` read `playerName`; `RosterPlayerLite` carries `name`.
 *   - Standings: "rows: 12 items (not itemised here)" — no table at all.
 *   - Matchup:   cut at 8 fields with nothing saying so, so `weeksUntilPlayoffs`, the projected margin and who
 *                leads were dropped behind `isPlayoffWeek`.
 * Chimmy could still call a tool, and on the tool-loop path it usually did — which is exactly the cost the packet
 * exists to remove. These render each shape field by field, whole, in the order a manager asks about them.
 *
 * ⚠ NULL IS "UNKNOWN", NEVER ZERO: a missing projection prints as not projected, an unnamed player is counted as
 * unidentified rather than renamed after his id (the 27-of-27 "player 6804" bug `chimmy-context/types.ts` records).
 *
 * PURE: no IO. Structural guards first, so a shape this file has not seen falls back to the generic renderer.
 */

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/* ───────────────────────── matchup ───────────────────────── */

export function isMatchupSlice(v: unknown): v is Obj {
  return isObj(v) && 'week' in v && 'yourProjectedPoints' in v && 'opponentProjectedPoints' in v && 'status' in v
}

export function renderMatchupSlice(m: Obj): string[] {
  const rows: string[] = []
  const week = num(m.week)
  const season = num(m.season)
  const status = str(m.status) ?? 'unknown'
  rows.push(`    ${week != null ? `Week ${week}` : 'Week unknown'}${season != null ? `, ${season}` : ''} — ${status.replace('_', ' ')}`)
  const opp = str(m.opponentTeamName)
  rows.push(`    Opponent: ${opp ?? 'not named in the data'}`)

  const you = num(m.yourProjectedPoints)
  const them = num(m.opponentProjectedPoints)
  const proj = (n: number | null) => (n == null ? 'not projected' : `${fmt(n)}`)
  rows.push(`    Projected: you ${proj(you)}, them ${proj(them)}`)
  const margin = num(m.projectedMargin) ?? (you != null && them != null ? you - them : null)
  const leader = str(m.projectedLeader)
  if (margin != null || (leader && leader !== 'unknown')) {
    const lead = leader === 'you' ? 'you lead' : leader === 'opponent' ? 'they lead' : leader === 'even' ? 'even' : null
    rows.push(`    Projected margin: ${margin != null ? `${margin > 0 ? '+' : ''}${fmt(margin)}` : 'unknown'}${lead ? ` (${lead})` : ''}`)
  }

  const yourActual = num(m.yourActualPoints)
  const theirActual = num(m.opponentActualPoints)
  if (yourActual != null || theirActual != null) {
    rows.push(`    Scored so far: you ${yourActual != null ? fmt(yourActual) : 'unknown'}, them ${theirActual != null ? fmt(theirActual) : 'unknown'}`)
  }

  const playoffStart = num(m.playoffStartWeek)
  const weeksLeft = num(m.weeksUntilPlayoffs)
  if (m.isPlayoffWeek === true) rows.push(`    This is a playoff week${playoffStart != null ? ` (playoffs start week ${playoffStart})` : ''}.`)
  else if (playoffStart != null) {
    rows.push(`    Playoffs start week ${playoffStart}${weeksLeft != null ? ` — ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} away` : ''}.`)
  }

  const urgency = str(m.urgencyLevel)
  if (urgency && urgency !== 'unknown' && urgency !== 'none') {
    const signals = Array.isArray(m.urgencySignals) ? m.urgencySignals.filter((x): x is string => typeof x === 'string') : []
    rows.push(`    Urgency: ${urgency}${signals.length ? ` (${signals.slice(0, 6).join(', ')})` : ''}`)
  }
  return rows
}

/* ───────────────────────── roster ───────────────────────── */

export function isRosterSlice(v: unknown): v is Obj {
  return isObj(v) && Array.isArray(v.starters) && Array.isArray(v.bench)
}

function playerLine(p: unknown): string | null {
  if (!isObj(p)) return null
  const name = str(p.name) ?? str(p.playerName)
  if (!name) return null
  const pos = str(p.position)
  const team = str(p.team)
  const slot = str(p.slot)
  const meta = [pos, team].filter(Boolean).join(', ')
  return `${slot ? `${slot}: ` : ''}${name}${meta ? ` (${meta})` : ''}`
}

function group(label: string, players: unknown[]): string[] {
  const named = players.map(playerLine).filter((l): l is string => Boolean(l))
  const unnamed = players.length - named.length
  if (players.length === 0) return [`    ${label}: none`]
  const tail = unnamed > 0 ? ` (+${unnamed} unidentified — NOT empty slots; their names could not be resolved)` : ''
  return [`    ${label} (${players.length}): ${named.join('; ')}${tail}`]
}

export function renderRosterSlice(r: Obj): string[] {
  const rows = [...group('Starters', r.starters as unknown[]), ...group('Bench', r.bench as unknown[])]
  const total = num(r.starterProjectedTotal)
  if (total != null) rows.push(`    Starters projected: ${fmt(total)} pts`)
  if (isObj(r.byPosition)) {
    const parts = Object.entries(r.byPosition)
      .filter(([, v]) => num(v) != null)
      .map(([k, v]) => `${k} ${fmt(v as number)}`)
    if (parts.length) rows.push(`    Starter projection by position: ${parts.join(', ')}`)
  }
  if (isObj(r.depthByPosition)) {
    const parts = Object.entries(r.depthByPosition)
      .filter(([, v]) => isObj(v))
      .map(([k, v]) => {
        const d = v as Obj
        return `${k} ${num(d.starters) ?? 0}+${num(d.bench) ?? 0}`
      })
    if (parts.length) rows.push(`    Depth (starters+bench): ${parts.join(', ')}`)
  }
  for (const [key, label] of [['weaknessSignals', 'Weak spots'], ['strengthSignals', 'Strengths']] as const) {
    const list = Array.isArray(r[key]) ? (r[key] as unknown[]).filter((x): x is string => typeof x === 'string') : []
    if (list.length) rows.push(`    ${label}: ${list.join(', ')}`)
  }
  // `teamIdentityHint` is documented as always "unknown" until its formula exists: printing it is noise, so it is not.
  return rows
}

/* ───────────────────────── standings ───────────────────────── */

export function isStandingsSlice(v: unknown): v is Obj {
  return isObj(v) && Array.isArray(v.rows) && (v.rows as unknown[]).every((r) => isObj(r) && 'teamId' in r && ('wins' in r || 'rank' in r))
}

/** Every team, by rank. A league is at most a few dozen teams, so the whole table is bounded by construction. */
export function renderStandingsSlice(s: Obj): string[] {
  const rows = (s.rows as Obj[]).slice()
  if (rows.length === 0) return ['    No standings rows yet.']
  rows.sort((a, b) => (num(a.rank) ?? Number.POSITIVE_INFINITY) - (num(b.rank) ?? Number.POSITIVE_INFINITY))
  return rows.map((r, i) => {
    const rank = num(r.rank)
    const w = num(r.wins)
    const l = num(r.losses)
    const t = num(r.ties)
    const record = w != null && l != null ? `${w}-${l}${t ? `-${t}` : ''}` : 'record unknown'
    const pf = num(r.pointsFor)
    const pa = num(r.pointsAgainst)
    const points = [pf != null ? `PF ${fmt(pf)}` : null, pa != null ? `PA ${fmt(pa)}` : null].filter(Boolean).join(', ')
    return `    ${rank != null ? rank : i + 1}. ${str(r.teamName) ?? 'unnamed team'} ${record}${points ? ` (${points})` : ''}`
  })
}
