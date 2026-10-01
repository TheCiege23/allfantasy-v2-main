import 'server-only'

import { prisma } from '@/lib/prisma'
import { currentSkill, type GameLogEntry, type ManagerSkill } from '@/lib/rank/skillRating/replay'
import { winProbability } from '@/lib/rank/skillRating/glicko2'
import { percentileRank, readSkillBoard, readSkillLog, type SkillBoardRow } from '@/lib/rank/skillRating/skillRatingStore'
import { MANAGER_CLASS_BAND, SKILL_CLASS_MIN_GAMES, classRangeFor, skillClassFor, skillClassRatingSpan } from '@/lib/league-join/managerClass'

/**
 * The Skill tab of `/core/rankings` — the per-game rating read for one sport.
 *
 * Everything here is read from what `runSkillRatingDaily` stored; nothing is
 * replayed on a page view.
 */

/** Games before a manager appears on the Skill board. Their rating exists from game one. */
export const SKILL_BOARD_MIN_GAMES = 10
const BOARD_LIMIT = 200
const LOG_SHOWN = 25

export type SkillBoardView = {
  userId: string
  rank: number
  handle: string
  level: number | null
  rating: number
  rd: number
  conservative: number
  record: string
  games: number
  percentile: number | null
  /** Skill class (1–25) — what league joins are measured on in this sport. */
  skillClass: number
  isYou: boolean
}

export type SkillLogView = GameLogEntry & {
  opponentLabel: string
  /** `ratingAfter - ratingBefore` — the whole week's move when several games shared it. */
  change: number
}

export type SkillYou = {
  rating: number
  rd: number
  conservative: number
  games: number
  record: string
  /** Share of every rated manager in this sport you are at or above. */
  percentile: number | null
  /** Place among AllFantasy users on this board, if you qualify. */
  boardRank: number | null
  /** Games still needed to appear on the board. */
  gamesToBoard: number
  /** Chance you would beat an average manager (1500, settled deviation). */
  vsAverage: number
  /** Your skill class in this sport, once you have the minimum rated games. */
  skillClass: number | null
  /** The classes you can join leagues in, and the ratings they span. */
  classBand: { min: number; max: number; lo: number; hi: number } | null
}

export type SkillView = {
  sports: string[]
  sport: string | null
  computedAt: string | null
  rated: number
  gamesInSport: number
  board: SkillBoardView[]
  you: SkillYou | null
  log: SkillLogView[]
  /** Board narrowed to your class band (`?class=mine`). Null when you have no class yet. */
  classFilter: { active: boolean; band: number; href: string; offHref: string } | null
  /** Why there is nothing to show, when there is nothing. */
  empty: string | null
}

function record(r: Pick<SkillBoardRow, 'w' | 'l' | 't'>): string {
  return r.t > 0 ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`
}

function toSkill(row: SkillBoardRow): ManagerSkill {
  return {
    key: `af:${row.u}`,
    name: null,
    rating: row.r,
    rd: row.rd,
    volatility: row.v,
    games: row.g,
    wins: row.w,
    losses: row.l,
    ties: row.t,
    lastPeriod: row.lp,
    conservative: row.r - 2 * row.rd,
  }
}

export async function getSkillView(userId: string | null, sportParam: string | null, classParam: string | null = null): Promise<SkillView> {
  const board = await readSkillBoard()
  const sports = board ? Object.keys(board.sports).sort((a, b) => (board.sports[b].games - board.sports[a].games) || a.localeCompare(b)) : []
  const empty: SkillView = {
    sports,
    sport: null,
    computedAt: board?.computedAt ?? null,
    rated: 0,
    gamesInSport: 0,
    board: [],
    you: null,
    log: [],
    classFilter: null,
    empty: board
      ? 'No head-to-head games have been rated yet. Import a league with weekly matchups and your rating appears the next day.'
      : 'Skill ratings are calculated once a day. The first run has not finished yet — check back tomorrow.',
  }
  if (!board || sports.length === 0) return empty

  const wanted = sportParam?.toUpperCase() ?? null
  const sport = wanted && board.sports[wanted] ? wanted : sports[0]
  const sb = board.sports[sport]

  // Ratings as of the sport's latest week: someone idle since last season is less certain today.
  const current = sb.rows.map((row) => ({ row, skill: currentSkill(toSkill(row), sb.latestPeriod) }))
  const mine = userId ? current.find((c) => c.row.u === userId) ?? null : null
  const myClass = mine && mine.row.g >= SKILL_CLASS_MIN_GAMES ? skillClassFor(mine.row.r) : null
  const myBand = myClass != null ? classRangeFor(myClass) : null
  const classMine = myBand != null && classParam === 'mine'

  const qualified = current
    .filter((c) => c.row.g >= SKILL_BOARD_MIN_GAMES)
    .filter((c) => {
      if (!classMine || !myBand) return true
      const cls = skillClassFor(c.row.r)
      return cls >= myBand.min && cls <= myBand.max
    })
    .sort((a, b) => b.skill.conservative - a.skill.conservative)
  const log = userId ? await readSkillLog(userId) : null
  const entries = (log?.sports[sport] ?? []).slice(-LOG_SHOWN).reverse()

  const needIds = new Set<string>()
  for (const c of qualified.slice(0, BOARD_LIMIT)) needIds.add(c.row.u)
  for (const e of entries) if (e.opponent.startsWith('af:')) needIds.add(e.opponent.slice(3))
  const users = needIds.size
    ? await prisma.appUser
        .findMany({
          where: { id: { in: [...needIds] } },
          select: { id: true, username: true, displayName: true, profile: { select: { xpLevel: true, legacyCareerLevel: true } } },
        })
        .catch(() => [])
    : []
  const userById = new Map(users.map((u) => [u.id, u]))
  const handle = (id: string) => {
    const u = userById.get(id)
    return u?.displayName?.trim() || u?.username?.trim() || 'Manager'
  }

  const boardRows: SkillBoardView[] = qualified.slice(0, BOARD_LIMIT).map((c, i) => {
    const u = userById.get(c.row.u)
    return {
      userId: c.row.u,
      rank: i + 1,
      handle: handle(c.row.u),
      level: u?.profile?.xpLevel ?? u?.profile?.legacyCareerLevel ?? null,
      rating: Math.round(c.skill.rating),
      rd: Math.round(c.skill.rd),
      conservative: Math.round(c.skill.conservative),
      record: record(c.row),
      games: c.row.g,
      percentile: percentileRank(sb.percentiles, c.skill.conservative),
      skillClass: skillClassFor(c.row.r),
      isYou: c.row.u === userId,
    }
  })

  let you: SkillYou | null = null
  if (mine) {
    const at = qualified.findIndex((c) => c.row.u === userId)
    you = {
      rating: Math.round(mine.skill.rating),
      rd: Math.round(mine.skill.rd),
      conservative: Math.round(mine.skill.conservative),
      games: mine.row.g,
      record: record(mine.row),
      percentile: percentileRank(sb.percentiles, mine.skill.conservative),
      boardRank: at >= 0 ? at + 1 : null,
      gamesToBoard: Math.max(0, SKILL_BOARD_MIN_GAMES - mine.row.g),
      vsAverage: winProbability(mine.skill, { rating: 1500, rd: 50, volatility: 0.06 }),
      skillClass: myClass,
      classBand: myBand
        ? { min: myBand.min, max: myBand.max, lo: skillClassRatingSpan(myBand.min).lo, hi: skillClassRatingSpan(myBand.max).hi }
        : null,
    }
  }
  const sportQ = `scope=skill&sport=${encodeURIComponent(sport)}`

  return {
    sports,
    sport,
    computedAt: board.computedAt,
    rated: sb.rated,
    gamesInSport: sb.games,
    board: boardRows,
    you,
    log: entries.map((e) => ({
      ...e,
      opponentLabel: e.opponent.startsWith('af:') ? handle(e.opponent.slice(3)) : e.opponentName?.trim() || 'Unknown manager',
      change: e.ratingAfter - e.ratingBefore,
    })),
    classFilter: myBand
      ? {
          active: classMine,
          band: MANAGER_CLASS_BAND,
          href: `/core/rankings?${sportQ}&class=mine`,
          offHref: `/core/rankings?${sportQ}`,
        }
      : null,
    empty: null,
  }
}
