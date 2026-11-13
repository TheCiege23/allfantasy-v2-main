import { prisma } from '@/lib/prisma'
import { getLiveADP, type ADPEntry } from '@/lib/adp-data'
import { applyRealtimeAdpAdjustments } from '@/lib/mock-draft/adp-realtime-adjuster'
import { buildManagerDNAFromLeague, type ManagerDNA } from '@/lib/mock-draft/manager-dna'

function normalizeName(name: string) {
  return String(name || '')
    .toLowerCase()
    .replace(/[.'-]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getISOWeekNumber(date: Date): [number, number] {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return [d.getUTCFullYear(), weekNum]
}

function getWeekKey(date?: Date): string {
  const [year, week] = getISOWeekNumber(date || new Date())
  return `${year}-W${String(week).padStart(2, '0')}`
}

function getPreviousWeekKey(): string {
  const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  return getWeekKey(d)
}

interface BoardDriftPlayer {
  name: string
  position: string
  team: string | null
  currentAdp: number
  previousAdp: number
  drift: number
  driftDirection: 'rising' | 'falling' | 'stable'
  driftMagnitude: 'major' | 'moderate' | 'minor'
  reasons: string[]
}

interface ManagerTendencyChange {
  manager: string
  archetype: string
  previousArchetype: string | null
  changedSignals: Array<{
    signal: string
    previous: number
    current: number
    direction: 'up' | 'down'
  }>
}

interface NextRoundsImpact {
  round: number
  risersInWindow: Array<{ name: string; position: string; drift: number }>
  fallersInWindow: Array<{ name: string; position: string; drift: number }>
  newEntrants: Array<{ name: string; position: string; adp: number }>
  summary: string
}

interface BoardDriftReport {
  weekLabel: string
  previousWeekLabel: string
  generatedAt: string
  topRisers: BoardDriftPlayer[]
  topFallers: BoardDriftPlayer[]
  managerChanges: ManagerTendencyChange[]
  nextRoundsImpact: NextRoundsImpact[]
  headline: string
  totalPlayersTracked: number
  averageDrift: number
}

type SnapshotEntry = {
  name: string
  position: string
  team: string | null
  adp: number
}

async function saveCurrentSnapshot(
  leagueId: string,
  entries: ADPEntry[],
  managerDna: ManagerDNA[],
  isDynasty: boolean
) {
  const weekKey = getWeekKey()
  const cacheKey = `board-drift-snapshot-${leagueId}-${weekKey}`

  const snapshot = {
    entries: entries.map(e => ({
      name: e.name,
      position: e.position,
      team: e.team,
      adp: e.adp,
    })),
    managerDna: managerDna.map(d => ({
      manager: d.manager,
      archetype: d.overallArchetype,
      reachFrequency: d.reachFrequency,
      rookieAppetite: d.rookieAppetite,
      stackTendency: d.stackTendency,
      panicScore: d.panicScore,
    })),
    isDynasty,
    savedAt: new Date().toISOString(),
  }

  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    update: {
      data: snapshot as any,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    create: {
      cacheKey,
      data: snapshot as any,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })

  return weekKey
}

async function getPreviousSnapshot(leagueId: string) {
  const prevWeek = getPreviousWeekKey()
  const cacheKey = `board-drift-snapshot-${leagueId}-${prevWeek}`

  const cached = await prisma.sportsDataCache.findUnique({
    where: { cacheKey },
  })

  if (!cached) return null

  return {
    weekKey: prevWeek,
    ...(cached.data as any),
  }
}

function classifyDriftReasons(
  player: ADPEntry,
  drift: number,
  newsReasons: string[]
): string[] {
  const reasons: string[] = []

  if (newsReasons.length > 0) {
    reasons.push(...newsReasons)
  }

  if (reasons.length === 0) {
    const absDrift = Math.abs(drift)
    if (absDrift >= 8) {
      reasons.push(drift < 0 ? 'Strong market momentum upward' : 'Market correction downward')
    } else if (absDrift >= 4) {
      reasons.push(drift < 0 ? 'Increased draft demand' : 'Reduced draft interest')
    } else {
      reasons.push('Normal week-to-week fluctuation')
    }
  }

  return reasons.slice(0, 3)
}

export async function computeBoardDrift(
  leagueId: string,
  userId: string,
  userSlot: number,
  teamCount: number,
  isDynasty: boolean
): Promise<BoardDriftReport> {
  const rawPool = await getLiveADP(isDynasty ? 'dynasty' : 'redraft', 200)
  const { entries: currentPool, adjustments } = await applyRealtimeAdpAdjustments(rawPool, { isDynasty })

  const adjustmentMap = new Map<string, { delta: number; reasons: string[] }>()
  for (const adj of adjustments) {
    adjustmentMap.set(normalizeName(adj.name), { delta: adj.delta, reasons: adj.reasons })
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId, userId },
    include: {
      teams: {
        include: {
          performances: { orderBy: { week: 'desc' }, take: 5 },
        },
      },
      rosters: {
        select: { platformUserId: true, playerData: true },
        take: 20,
      },
    },
  })

  let managerDna: ManagerDNA[] = []
  if (league) {
    managerDna = buildManagerDNAFromLeague(
      league.teams as any,
      league.rosters as any,
      currentPool,
      isDynasty,
      teamCount
    )
  }

  const currentWeek = getWeekKey()
  await saveCurrentSnapshot(leagueId, currentPool, managerDna, isDynasty)

  const prevSnapshot = await getPreviousSnapshot(leagueId)

  if (!prevSnapshot) {
    const headline = "First week tracked — your baseline is set. Come back next Monday to see who's moving."

    return {
      weekLabel: currentWeek,
      previousWeekLabel: 'N/A',
      generatedAt: new Date().toISOString(),
      topRisers: [],
      topFallers: [],
      managerChanges: [],
      nextRoundsImpact: [],
      headline,
      totalPlayersTracked: currentPool.length,
      averageDrift: 0,
    }
  }

  const prevEntries: SnapshotEntry[] = prevSnapshot.entries || []
  const prevMap = new Map<string, SnapshotEntry>()
  for (const e of prevEntries) prevMap.set(normalizeName(e.name), e)

  const driftPlayers: BoardDriftPlayer[] = []

  for (const current of currentPool) {
    const key = normalizeName(current.name)
    const prev = prevMap.get(key)
    if (!prev) continue

    const drift = current.adp - prev.adp
    if (Math.abs(drift) < 0.5) continue

    const adjInfo = adjustmentMap.get(key)
    const reasons = classifyDriftReasons(current, drift, adjInfo?.reasons || [])

    const absDrift = Math.abs(drift)
    driftPlayers.push({
      name: current.name,
      position: current.position,
      team: current.team,
      currentAdp: Math.round(current.adp * 10) / 10,
      previousAdp: Math.round(prev.adp * 10) / 10,
      drift: Math.round(drift * 10) / 10,
      driftDirection: drift < -0.5 ? 'rising' : drift > 0.5 ? 'falling' : 'stable',
      driftMagnitude: absDrift >= 8 ? 'major' : absDrift >= 4 ? 'moderate' : 'minor',
      reasons,
    })
  }

  const topRisers = driftPlayers
    .filter(p => p.driftDirection === 'rising')
    .sort((a, b) => a.drift - b.drift)
    .slice(0, 10)

  const topFallers = driftPlayers
    .filter(p => p.driftDirection === 'falling')
    .sort((a, b) => b.drift - a.drift)
    .slice(0, 10)

  const prevDnaList: Array<{
    manager: string
    archetype: string
    reachFrequency: number
    rookieAppetite: number
    stackTendency: number
    panicScore: number
  }> = prevSnapshot.managerDna || []
  const prevDnaMap = new Map(prevDnaList.map(d => [d.manager, d]))

  const managerChanges: ManagerTendencyChange[] = []
  for (const dna of managerDna) {
    const prev = prevDnaMap.get(dna.manager)
    const changedSignals: ManagerTendencyChange['changedSignals'] = []

    const signals = [
      { signal: 'Reach Frequency', current: dna.reachFrequency, previous: prev?.reachFrequency ?? dna.reachFrequency },
      { signal: 'Rookie Appetite', current: dna.rookieAppetite, previous: prev?.rookieAppetite ?? dna.rookieAppetite },
      { signal: 'Stack Tendency', current: dna.stackTendency, previous: prev?.stackTendency ?? dna.stackTendency },
      { signal: 'Panic Score', current: dna.panicScore, previous: prev?.panicScore ?? dna.panicScore },
    ]

    for (const s of signals) {
      const diff = s.current - s.previous
      if (Math.abs(diff) >= 0.05) {
        changedSignals.push({
          signal: s.signal,
          previous: Math.round(s.previous * 100) / 100,
          current: Math.round(s.current * 100) / 100,
          direction: diff > 0 ? 'up' : 'down',
        })
      }
    }

    if (changedSignals.length > 0 || (prev && prev.archetype !== dna.overallArchetype)) {
      managerChanges.push({
        manager: dna.manager,
        archetype: dna.overallArchetype,
        previousArchetype: prev?.archetype || null,
        changedSignals,
      })
    }
  }

  const rounds = 15
  const nextRoundsImpact: NextRoundsImpact[] = []

  for (let lookAhead = 1; lookAhead <= 3; lookAhead++) {
    const roundNum = Math.ceil((userSlot) / teamCount) + lookAhead
    if (roundNum > rounds) continue

    const isOddRound = roundNum % 2 === 1
    const pickInRound = isOddRound ? userSlot : teamCount - userSlot + 1
    const overallPick = (roundNum - 1) * teamCount + pickInRound

    const windowStart = overallPick - Math.floor(teamCount * 0.4)
    const windowEnd = overallPick + Math.floor(teamCount * 0.4)

    const risersInWindow = driftPlayers
      .filter(p => p.driftDirection === 'rising' && p.currentAdp >= windowStart && p.currentAdp <= windowEnd)
      .sort((a, b) => a.drift - b.drift)
      .slice(0, 5)

    const fallersInWindow = driftPlayers
      .filter(p => p.driftDirection === 'falling' && p.currentAdp >= windowStart && p.currentAdp <= windowEnd)
      .sort((a, b) => b.drift - a.drift)
      .slice(0, 5)

    const newEntrants = currentPool
      .filter(p => {
        const key = normalizeName(p.name)
        const prev = prevMap.get(key)
        if (!prev) return false
        return prev.adp > windowEnd && p.adp >= windowStart && p.adp <= windowEnd
      })
      .map(p => ({ name: p.name, position: p.position, adp: Math.round(p.adp * 10) / 10 }))
      .slice(0, 5)

    const parts: string[] = []
    if (risersInWindow.length > 0) {
      parts.push(`${risersInWindow.length} player${risersInWindow.length > 1 ? 's' : ''} rising into your window`)
    }
    if (fallersInWindow.length > 0) {
      parts.push(`${fallersInWindow.length} falling into range`)
    }
    if (newEntrants.length > 0) {
      parts.push(`${newEntrants.length} new entrant${newEntrants.length > 1 ? 's' : ''}`)
    }
    const summary = parts.length > 0 ? parts.join(', ') + '.' : 'No significant movement in your draft window.'

    nextRoundsImpact.push({
      round: roundNum,
      risersInWindow: risersInWindow.map(p => ({ name: p.name, position: p.position, drift: p.drift })),
      fallersInWindow: fallersInWindow.map(p => ({ name: p.name, position: p.position, drift: p.drift })),
      newEntrants,
      summary,
    })
  }

  const totalDrift = driftPlayers.reduce((s, p) => s + Math.abs(p.drift), 0)
  const averageDrift = driftPlayers.length > 0 ? Math.round((totalDrift / driftPlayers.length) * 10) / 10 : 0

  let headline = ''
  if (topRisers.length > 0 && topFallers.length > 0) {
    const bigRiser = topRisers[0]
    const bigFaller = topFallers[0]
    headline = `${bigRiser.name} surges ${Math.abs(bigRiser.drift)} spots while ${bigFaller.name} drops ${bigFaller.drift}. ${driftPlayers.length} players moved this week.`
  } else if (driftPlayers.length === 0) {
    headline = 'Quiet week — no significant board movement detected.'
  } else {
    headline = `${driftPlayers.length} players shifted positions this week. Average drift: ${averageDrift} spots.`
  }

  return {
    weekLabel: currentWeek,
    previousWeekLabel: prevSnapshot.weekKey,
    generatedAt: new Date().toISOString(),
    topRisers,
    topFallers,
    managerChanges,
    nextRoundsImpact,
    headline,
    totalPlayersTracked: currentPool.length,
    averageDrift,
  }
}
