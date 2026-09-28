import { prisma } from '@/lib/prisma'
import { runBestBallOptimizer } from './optimizer'
import { rankBestBallEntries, selectBestBallAdvancers } from './advancementRanking'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** Assign shuffled entries into pods of `contest.podSize`. */
export async function assignEntriesToPods(contestId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    const contest = await tx.bestBallContest.findUnique({ where: { id: contestId } })
    if (!contest) throw new Error('Contest not found')
    if (await tx.bestBallPod.count({ where: { contestId, roundNumber: 1 } })) return
    if (contest.status === 'complete' || contest.podSize < 1) throw new Error('Contest cannot form pods')
    const entries = await tx.bestBallEntry.findMany({ where: { contestId, currentRound: 1, isEliminated: false } })
    if (!entries.length) throw new Error('Contest has no entries')
    if (contest.rounds === 1 && entries.length > contest.podSize) throw new Error('Multiple pods require an advancement round')
    if (entries.some(entry => entry.podId != null)) throw new Error('Entries already assigned; recovery required')
    const ordered = shuffle(entries)
    for (let offset = 0; offset < ordered.length; offset += contest.podSize) {
      const pod = await tx.bestBallPod.create({ data: {
        contestId, roundNumber: 1, podNumber: Math.floor(offset / contest.podSize) + 1,
        status: 'forming', advancers: [],
      } })
      for (const entry of ordered.slice(offset, offset + contest.podSize)) {
        await tx.bestBallEntry.update({ where: { id: entry.id }, data: { podId: pod.id } })
      }
    }
  }, { isolationLevel: 'Serializable', timeout: 30_000 })
}

/** Advance a completed scoring round and form its next pods atomically. */
export async function advancePodWinners(
  contestId: string,
  roundNumber: number,
  tieRule: 'points_for' | 'max_week' | 'advance_all' = 'advance_all',
): Promise<void> {
  if (!Number.isInteger(roundNumber) || roundNumber < 1) throw new Error('Invalid round number')
  await prisma.$transaction(async tx => {
    const contest = await tx.bestBallContest.findUnique({ where: { id: contestId } })
    if (!contest) throw new Error('Contest not found')
    if (roundNumber > contest.rounds) throw new Error('Round exceeds contest rounds')
    if (contest.status === 'complete') return
    if (contest.advancersPerPod < 1 || contest.podSize < 1) throw new Error('Invalid advancement settings')
    const pods = await tx.bestBallPod.findMany({
      where: { contestId, roundNumber }, include: { entries: true }, orderBy: { podNumber: 'asc' },
    })
    if (!pods.length) throw new Error('Round has no pods')
    if (pods.every(pod => pod.status === 'complete')) return
    if (pods.some(pod => pod.status === 'complete')) throw new Error('Round is partially advanced; recovery required')
    const finalists = [] as typeof pods[number]['entries']
    for (const pod of pods) {
      if (!pod.entries.length || pod.entries.some(entry => !Array.isArray(entry.weeklyScores) || !entry.weeklyScores.length)) {
        throw new Error('Round scoring is incomplete')
      }
      const sorted = rankBestBallEntries(pod.entries, tieRule)
      const finalRound = roundNumber === contest.rounds
      const advance = selectBestBallAdvancers(sorted, finalRound ? 1 : contest.advancersPerPod, tieRule)
      const ids = new Set(advance.map(entry => entry.id))
      for (let index = 0; index < sorted.length; index++) {
        const entry = sorted[index]!
        await tx.bestBallEntry.update({ where: { id: entry.id }, data: {
          podRank: index + 1,
          hasAdvanced: !finalRound && ids.has(entry.id),
          isEliminated: !ids.has(entry.id),
          currentRound: finalRound ? roundNumber : ids.has(entry.id) ? roundNumber + 1 : roundNumber,
          ...(finalRound ? { overallRank: tieRule === 'advance_all' ? sorted.findIndex(row => row.totalPoints === entry.totalPoints) + 1 : index + 1 } : {}),
        } })
      }
      await tx.bestBallPod.update({ where: { id: pod.id }, data: { advancers: advance.map(entry => entry.id), status: 'complete' } })
      finalists.push(...advance)
    }
    if (roundNumber === contest.rounds) {
      if (pods.length !== 1) throw new Error('Final round must contain one pod')
      await tx.bestBallContest.update({ where: { id: contestId }, data: { status: 'complete' } })
      return
    }
    const ordered = rankBestBallEntries(finalists, tieRule)
    // The final field shares one pod; earlier rounds use the configured pod size.
    const size = roundNumber + 1 === contest.rounds ? ordered.length : contest.podSize
    for (let offset = 0; offset < ordered.length; offset += size) {
      const pod = await tx.bestBallPod.create({ data: {
        contestId, roundNumber: roundNumber + 1, podNumber: Math.floor(offset / size) + 1,
        status: 'active', advancers: [],
      } })
      for (const entry of ordered.slice(offset, offset + size)) {
        await tx.bestBallEntry.update({ where: { id: entry.id }, data: {
          podId: pod.id, podRank: null,
          ...(contest.resetBetweenRounds ? { totalPoints: 0, weeklyScores: [] } : {}),
        } })
      }
    }
  }, { isolationLevel: 'Serializable', timeout: 30_000 })
}

export async function finalizeContest(contestId: string): Promise<void> {
  const contest = await prisma.bestBallContest.findUnique({ where: { id: contestId } })
  if (!contest) throw new Error('Contest not found')
  await advancePodWinners(contestId, contest.rounds)
}

export async function calculateContestScores(contestId: string, week: number): Promise<void> {
  const contest = await prisma.bestBallContest.findFirst({ where: { id: contestId } })
  if (!contest) throw new Error('Contest not found')

  const entries = await prisma.bestBallEntry.findMany({
    where: { contestId, isEliminated: false },
  })

  for (const e of entries) {
    await runBestBallOptimizer({
      entryId: e.id,
      leagueId: null,
      week,
      sport: contest.sport,
    })

    const row = await prisma.bestBallOptimizedLineup.findFirst({
      where: { contestId, entryId: e.id, week },
    })
    const quality = row?.optimizerLog as { dataQuality?: { status?: string } } | null
    if (!row?.isFinalized || quality?.dataQuality?.status !== 'AVAILABLE' || !Number.isFinite(row.totalPoints)) {
      throw new Error('Contest scoring is incomplete')
    }
    const pts = row.totalPoints
    const prev = (e.weeklyScores as { week: number; points: number }[] | null) ?? []
    const nextScores = [...prev.filter((x) => x.week !== week), { week, points: pts }]
    const totalPoints = contest.cumulativeScoring
      ? nextScores.reduce((s, x) => s + x.points, 0)
      : pts

    await prisma.bestBallEntry.update({
      where: { id: e.id },
      data: {
        totalPoints,
        weeklyScores: nextScores as object,
      },
    })
  }
}

export type WeeklyWinnerResult = { entryId: string; points: number; week: number }

export async function resolveWeeklyWinners(contestId: string, week: number): Promise<WeeklyWinnerResult[]> {
  await calculateContestScores(contestId, week)
  const entries = await prisma.bestBallEntry.findMany({ where: { contestId } })
  const withWeek = entries.map((e) => ({
    e,
    w: (e.weeklyScores as { week: number; points: number }[] | null)?.find((x) => x.week === week)?.points ?? 0,
  }))
  withWeek.sort((a, b) => b.w - a.w)
  const top = withWeek[0]?.w ?? 0
  return withWeek.filter((x) => x.w === top).map((x) => ({ entryId: x.e.id, points: x.w, week }))
}

export async function finalizeSitAndGo(podId: string): Promise<void> {
  const pod = await prisma.bestBallPod.findFirst({
    where: { id: podId },
    include: { entries: true },
  })
  if (!pod) throw new Error('Pod not found')
  const sorted = [...pod.entries].sort((a, b) => b.totalPoints - a.totalPoints)
  let rank = 1
  for (const e of sorted) {
    await prisma.bestBallEntry.update({
      where: { id: e.id },
      data: { podRank: rank, overallRank: rank },
    })
    rank++
  }
  await prisma.bestBallPod.update({
    where: { id: podId },
    data: { status: 'complete' },
  })
}
