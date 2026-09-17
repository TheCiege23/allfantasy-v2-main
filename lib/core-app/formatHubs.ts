import 'server-only'
import { prisma } from '@/lib/prisma'
import { readCommissionerTemplatePin } from '@/lib/commissioner-os/profile/templatePin'
import { getTradesBoard } from './tradesBoard'
import { resolveCurrentWeek } from './currentWeek'

/**
 * Multi-league format hubs — /core/hubs/<format>.
 *
 * Six hubs, one loader. Each gathers every league of ONE format that the reader
 * is in (imported or claimed) and summarises it with a number the format really
 * has on file.
 *
 * ⚠ THE DESIGN'S METERS WERE RENAMED WHERE THE PRODUCT HAS NO SUCH SIGNAL. The
 * handoff drew "Tribal Loyalty", "Chop Risk" and "Dynasty Power" percentages.
 * None is stored anywhere, and the Guillotine danger engine resolves display names
 * through `AppUser.email` as a fallback, so it cannot be surfaced as-is. Each meter
 * below is a real ratio with its real name: teams remaining, players still in the
 * game, your standing. A percentage with no source is the one thing this surface
 * must not draw (user decision B, 2026-09-13: real rows only, honest empty states).
 *
 * ⚠ C2C IS CAMPUS-TO-CANTON, NOT A CROSS-PLATFORM MERGE (user decision A). The
 * handoff's "Sleeper + Fantrax pair" model does not exist; `C2CLeague` is one league
 * with a college side and a pro side.
 *
 * ⚠ NO NEW LINK TABLE. A hub is "the leagues of this format you are in", derived on
 * read. Connecting a league means importing or creating it — there is nothing to
 * pair, so there is no pairing to store.
 */

export const HUB_FORMATS = ['zombie', 'tournament', 'survivor', 'c2c', 'guillotine', 'efl'] as const
export type HubFormat = (typeof HUB_FORMATS)[number]

export function parseHubFormat(raw: unknown): HubFormat | null {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return (HUB_FORMATS as readonly string[]).includes(v) ? (v as HubFormat) : null
}

const EFL_TEMPLATE_ID = 'efl_promotion_relegation_dynasty'
/** Cards drawn per hub. The stat strip still counts every league. */
const CARD_CAP = 12

/*
 * The service runs against a database in another region, so a read that stalls
 * has no natural end — and a hub read had none. `getFormatHub` was awaited with
 * `.catch(() => null)` on the page and every read here went through `soft`, which
 * caught rejections but never a read that simply never returns. A single hung
 * query therefore held the whole /core render open with nothing painted (measured
 * at /core/hubs/efl, still on the skeleton 27 minutes after the click).
 *
 * Every read now has a deadline. A guarded read that passes it degrades to its
 * fallback and marks the hub partial; the membership read that everything else
 * depends on rejects, which the page's own `.catch` turns into the honest "could
 * not read your leagues" panel. A bounded failure is what makes the screen paint.
 */
const HUB_READ_TIMEOUT_MS = 8_000

function withTimeout<T>(label: string, run: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)
  })
  return Promise.race([run, deadline]).finally(() => clearTimeout(timer))
}

export type HubTone = 'good' | 'warn' | 'bad' | 'accent' | 'muted'
export type HubMeter = { pct: number; value: string; tone: HubTone }
export type HubLeagueCard = {
  leagueId: string
  name: string
  platform: string
  sub: string
  meter: HubMeter | null
  detail: string | null
  status: string
  statusTone: HubTone
  href: string
  youCommission: boolean
}
export type HubStat = { value: string; label: string; tone: 'accent' | 'good' | 'bad' | 'plain' }
export type HubTradeRow = { id: string; title: string; detail: string }
export type HubMention = { id: string; author: string; leagueName: string; at: string; text: string }

export type FormatHubData = {
  format: HubFormat
  /** Leagues per format, for the switcher. */
  counts: Record<HubFormat, number>
  leagues: HubLeagueCard[]
  totalLeagues: number
  stats: HubStat[]
  trades: { pending: HubTradeRow[]; completed: HubTradeRow[] } | null
  mentions: HubMention[] | null
  /** Leagues where a broadcast will be accepted — the owner check the route applies. */
  broadcastLeagueIds: string[]
  /** True when one of the per-format reads failed and a count may be low. */
  partial: boolean
}

type MemberLeague = {
  id: string
  name: string | null
  platform: string
  platformLeagueId: string
  leagueSize: number | null
  userId: string
  leagueType: string | null
  guillotineMode: boolean | null
  lastSyncedAt: Date | null
  syncStatus: string | null
}

const PLATFORM_LABEL: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MFL',
  fleaflicker: 'Fleaflicker',
  cbs: 'CBS',
}

function platformLabel(p: string): string {
  const key = String(p ?? '').toLowerCase()
  return PLATFORM_LABEL[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'AllFantasy')
}

function managersLabel(n: number | null): string {
  return n && n > 0 ? `${n} managers` : 'size not on file'
}

function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)))
}

function agoLabel(hours: number): string {
  if (hours < 1) return 'under an hour ago'
  if (hours < 48) return `${Math.round(hours)}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function titleCase(slug: string): string {
  return slug
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** A read that may hit a table production has not migrated yet. Logged, never thrown. */
async function soft<T>(label: string, run: () => Promise<T>, fallback: T, flags: { partial: boolean }): Promise<T> {
  try {
    return await withTimeout(label, run(), HUB_READ_TIMEOUT_MS)
  } catch (err) {
    flags.partial = true
    console.warn(`[formatHubs] ${label} read failed`, err instanceof Error ? err.message : err)
    return fallback
  }
}

export async function getFormatHub(userId: string, requested: HubFormat | null): Promise<FormatHubData> {
  const flags = { partial: false }

  /*
   * Same membership rule `leagueNameForTitle` uses on the page: the importer's
   * own row, or a league where this reader has claimed a team. A hub must never
   * list a league the reader could not open.
   */
  const members: MemberLeague[] = await withTimeout(
    'members',
    prisma.league.findMany({
      where: { OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] },
      select: {
        id: true,
        name: true,
        platform: true,
        platformLeagueId: true,
        leagueSize: true,
        userId: true,
        leagueType: true,
        guillotineMode: true,
        lastSyncedAt: true,
        syncStatus: true,
      },
    }),
    HUB_READ_TIMEOUT_MS,
  )
  const ids = members.map((m) => m.id)

  const [guillotineRows, c2cRows, zombieRows, survivorRows, tournamentRows, eflRows] =
    ids.length === 0
      ? [[], [], [], [], [], []]
      : await Promise.all([
          soft('guillotine', () => prisma.guillotineLeagueConfig.findMany({ where: { leagueId: { in: ids } }, select: { leagueId: true } }), [] as { leagueId: string }[], flags),
          soft('c2c', () => prisma.c2CLeague.findMany({ where: { leagueId: { in: ids } }, select: { leagueId: true } }), [] as { leagueId: string }[], flags),
          soft('zombie', () => prisma.zombieLeague.findMany({ where: { leagueId: { in: ids } }, select: { leagueId: true } }), [] as { leagueId: string }[], flags),
          soft('survivor', () => prisma.survivorGameState.findMany({ where: { leagueId: { in: ids } }, select: { leagueId: true } }), [] as { leagueId: string }[], flags),
          soft(
            'tournament',
            () =>
              prisma.tournamentLeague.findMany({
                where: { leagueId: { in: ids } },
                select: { leagueId: true },
              }) as Promise<{ leagueId: string | null }[]>,
            [] as { leagueId: string | null }[],
            flags,
          ),
          /*
           * The pin lives in League.settings JSON at one of two paths — see
           * readCommissionerTemplatePin. Filtered in Postgres so a 600-league account
           * does not ship every settings blob to find two pins, then re-read through
           * the canonical reader so a half-written pin does not count.
           */
          soft(
            'efl',
            () =>
              prisma.league.findMany({
                where: {
                  id: { in: ids },
                  OR: [
                    { settings: { path: ['conceptRules', 'extensions', 'commissionerTemplate', 'id'], equals: EFL_TEMPLATE_ID } },
                    { settings: { path: ['conceptRules', 'commissionerTemplate', 'id'], equals: EFL_TEMPLATE_ID } },
                  ],
                },
                select: { id: true, settings: true },
              }),
            [] as { id: string; settings: unknown }[],
            flags,
          ),
        ])

  const eflPins = new Map<string, string>()
  for (const row of eflRows) {
    const pin = readCommissionerTemplatePin(row.settings)
    if (pin?.id === EFL_TEMPLATE_ID) eflPins.set(row.id, pin.version)
  }

  const setOf = (rows: { leagueId: string | null }[]) =>
    new Set(rows.map((r) => r.leagueId).filter((v): v is string => typeof v === 'string'))
  const byType = (t: string) => members.filter((m) => (m.leagueType ?? '').toLowerCase() === t).map((m) => m.id)

  const formatIds: Record<HubFormat, Set<string>> = {
    guillotine: new Set([
      ...setOf(guillotineRows),
      ...members.filter((m) => m.guillotineMode === true).map((m) => m.id),
      ...byType('guillotine'),
    ]),
    c2c: new Set([...setOf(c2cRows), ...byType('c2c')]),
    zombie: new Set([...setOf(zombieRows), ...byType('zombie')]),
    survivor: new Set([...setOf(survivorRows), ...byType('survivor')]),
    tournament: setOf(tournamentRows),
    efl: new Set(eflPins.keys()),
  }

  const counts = Object.fromEntries(HUB_FORMATS.map((f) => [f, formatIds[f].size])) as Record<HubFormat, number>

  // With no format in the URL, open the first hub the reader actually has leagues in.
  const format: HubFormat = requested ?? HUB_FORMATS.find((f) => counts[f] > 0) ?? 'guillotine'

  const inFormat = members
    .filter((m) => formatIds[format].has(m.id))
    .sort((a, b) => {
      const ownA = a.userId === userId ? 0 : 1
      const ownB = b.userId === userId ? 0 : 1
      return ownA - ownB || (a.name ?? '').localeCompare(b.name ?? '')
    })
  const shown = inFormat.slice(0, CARD_CAP)
  const allIds = inFormat.map((m) => m.id)
  const shownIds = shown.map((m) => m.id)

  const base = (m: MemberLeague) => ({
    leagueId: m.id,
    name: m.name?.trim() || 'Unnamed league',
    platform: String(m.platform ?? '').toLowerCase(),
    href: `/core?league=${encodeURIComponent(m.id)}`,
    youCommission: m.userId === userId,
  })

  let leagues: HubLeagueCard[] = []
  let stats: HubStat[] = []

  if (inFormat.length > 0) {
    const built = await buildFormat(format, { userId, inFormat, shown, allIds, shownIds, eflPins, base, flags })
    leagues = built.leagues
    stats = built.stats
  }

  const [trades, mentions] =
    inFormat.length === 0
      ? [null, null]
      : await Promise.all([
          soft<FormatHubData['trades']>('trades', () => readTrades(userId, inFormat), null, flags),
          soft<FormatHubData['mentions']>('mentions', () => readMentions(userId, inFormat), null, flags),
        ])

  return {
    format,
    counts,
    leagues,
    totalLeagues: inFormat.length,
    stats,
    trades,
    mentions,
    broadcastLeagueIds: inFormat.filter((m) => m.userId === userId).map((m) => m.id),
    partial: flags.partial,
  }
}

type BuildInput = {
  userId: string
  inFormat: MemberLeague[]
  shown: MemberLeague[]
  allIds: string[]
  shownIds: string[]
  eflPins: Map<string, string>
  base: (m: MemberLeague) => Pick<HubLeagueCard, 'leagueId' | 'name' | 'platform' | 'href' | 'youCommission'>
  flags: { partial: boolean }
}

async function buildFormat(
  format: HubFormat,
  input: BuildInput,
): Promise<{ leagues: HubLeagueCard[]; stats: HubStat[] }> {
  switch (format) {
    case 'guillotine':
      return buildGuillotine(input)
    case 'c2c':
      return buildC2C(input)
    case 'zombie':
      return buildZombie(input)
    case 'survivor':
      return buildSurvivor(input)
    case 'tournament':
      return buildTournament(input)
    case 'efl':
      return buildEfl(input)
  }
}

async function buildGuillotine({ inFormat, shown, allIds, base, flags }: BuildInput) {
  const states = await soft(
    'guillotine states',
    () =>
      prisma.guillotineRosterState.findMany({
        where: { leagueId: { in: allIds } },
        select: { leagueId: true, choppedAt: true },
      }),
    [] as { leagueId: string; choppedAt: Date | null }[],
    flags,
  )
  const periods = await soft(
    'guillotine periods',
    () =>
      prisma.guillotinePeriodScore.groupBy({
        by: ['leagueId'],
        where: { leagueId: { in: allIds } },
        _max: { weekOrPeriod: true },
      }),
    [] as { leagueId: string; _max: { weekOrPeriod: number | null } }[],
    flags,
  )

  const chopped = new Map<string, number>()
  const tracked = new Map<string, number>()
  for (const s of states) {
    tracked.set(s.leagueId, (tracked.get(s.leagueId) ?? 0) + 1)
    if (s.choppedAt) chopped.set(s.leagueId, (chopped.get(s.leagueId) ?? 0) + 1)
  }
  const latestPeriod = Math.max(0, ...periods.map((p) => p._max.weekOrPeriod ?? 0))
  const totalChopped = [...chopped.values()].reduce((a, b) => a + b, 0)

  const leagues: HubLeagueCard[] = shown.map((m) => {
    const size = m.leagueSize ?? tracked.get(m.id) ?? 0
    const cut = chopped.get(m.id) ?? 0
    const left = Math.max(0, size - cut)
    return {
      ...base(m),
      sub: `${platformLabel(m.platform)} · ${managersLabel(m.leagueSize)}`,
      meter: size > 0 ? { pct: pct(left, size), value: `${left} of ${size} left`, tone: 'accent' } : null,
      detail: size > 0 ? null : 'Team count not on file yet',
      status: cut === 0 ? 'No chops yet' : left <= 2 ? 'Final stretch' : `${cut} chopped`,
      statusTone: cut === 0 ? 'muted' : left <= 2 ? 'bad' : 'warn',
    }
  })

  return {
    leagues,
    stats: [
      { value: String(inFormat.length), label: inFormat.length === 1 ? 'league live' : 'leagues live', tone: 'accent' },
      { value: String(totalChopped), label: 'teams chopped so far', tone: 'bad' },
      latestPeriod > 0
        ? { value: `Wk ${latestPeriod}`, label: 'latest scored period', tone: 'plain' }
        : { value: '—', label: 'no period scored yet', tone: 'plain' },
    ] satisfies HubStat[],
  }
}

async function buildC2C({ inFormat, shown, shownIds, base, flags }: BuildInput) {
  const configs = await soft(
    'c2c configs',
    () =>
      prisma.c2CLeague.findMany({
        where: { leagueId: { in: shownIds } },
        select: { leagueId: true, campusScoreWeight: true, cantonScoreWeight: true },
      }),
    [] as { leagueId: string; campusScoreWeight: number; cantonScoreWeight: number }[],
    flags,
  )
  const byLeague = new Map(configs.map((c) => [c.leagueId, c]))
  const now = Date.now()

  const leagues: HubLeagueCard[] = shown.map((m) => {
    const cfg = byLeague.get(m.id)
    const hours = m.lastSyncedAt ? (now - m.lastSyncedAt.getTime()) / 3_600_000 : null
    const failed = (m.syncStatus ?? '').toLowerCase().includes('fail')
    const tone: HubTone = hours == null ? 'muted' : failed || hours >= 72 ? 'bad' : hours >= 24 ? 'warn' : 'good'
    const split = cfg
      ? `campus ${Math.round(cfg.campusScoreWeight * 100)}% · canton ${Math.round(cfg.cantonScoreWeight * 100)}%`
      : managersLabel(m.leagueSize)
    return {
      ...base(m),
      sub: `${platformLabel(m.platform)} · ${split}`,
      /* Freshness over a 72-hour window: a league read an hour ago is full, one read three days ago is empty. */
      meter: { pct: hours == null ? 0 : Math.max(0, Math.round(100 - (hours / 72) * 100)), value: hours == null ? 'never read' : agoLabel(hours), tone },
      detail: null,
      status: failed ? 'Sync failed' : hours == null ? 'Never read' : hours < 24 ? 'Synced' : hours < 72 ? 'Stale' : 'Needs a sync',
      statusTone: tone,
    }
  })

  const managers = inFormat.reduce((sum, m) => sum + (m.leagueSize ?? 0), 0)
  const freshest = inFormat
    .map((m) => m.lastSyncedAt?.getTime() ?? 0)
    .reduce((a, b) => Math.max(a, b), 0)

  return {
    leagues,
    stats: [
      { value: String(inFormat.length), label: inFormat.length === 1 ? 'C2C league' : 'C2C leagues', tone: 'accent' },
      { value: managers > 0 ? String(managers) : '—', label: 'managers across them', tone: 'plain' },
      freshest > 0
        ? { value: agoLabel((now - freshest) / 3_600_000).replace(' ago', ''), label: 'since the freshest sync', tone: 'good' }
        : { value: '—', label: 'never synced', tone: 'plain' },
    ] satisfies HubStat[],
  }
}

async function buildZombie({ shown, allIds, base, flags }: BuildInput) {
  const groups = await soft(
    'zombie teams',
    () =>
      prisma.zombieLeagueTeam.groupBy({
        by: ['leagueId', 'status'],
        where: { leagueId: { in: allIds } },
        _count: { _all: true },
      }),
    [] as { leagueId: string; status: string; _count: { _all: number } }[],
    flags,
  )
  const totals = new Map<string, { all: number; zombies: number; survivors: number }>()
  for (const g of groups) {
    const t = totals.get(g.leagueId) ?? { all: 0, zombies: 0, survivors: 0 }
    t.all += g._count._all
    if (g.status === 'Zombie') t.zombies += g._count._all
    if (g.status === 'Survivor') t.survivors += g._count._all
    totals.set(g.leagueId, t)
  }

  const leagues: HubLeagueCard[] = shown.map((m) => {
    const t = totals.get(m.id)
    const spread = t && t.all > 0 ? pct(t.zombies, t.all) : 0
    const tone: HubTone = !t || t.all === 0 ? 'muted' : spread < 34 ? 'good' : spread < 67 ? 'warn' : 'bad'
    return {
      ...base(m),
      sub: `${platformLabel(m.platform)} · ${managersLabel(m.leagueSize)}`,
      meter: t && t.all > 0 ? { pct: spread, value: `${spread}%`, tone } : null,
      detail: t && t.all > 0 ? null : 'Zombie teams not set up yet',
      status: !t || t.all === 0 ? 'Not set up' : t.zombies === 0 ? 'No outbreak' : spread < 50 ? 'Contained' : 'Outbreak',
      statusTone: tone,
    }
  })

  const all = [...totals.values()]
  return {
    leagues,
    stats: [
      { value: String(all.filter((t) => t.zombies > 0).length), label: 'leagues infected', tone: 'accent' },
      { value: String(all.reduce((s, t) => s + t.zombies, 0)), label: 'zombies roaming', tone: 'bad' },
      { value: String(all.reduce((s, t) => s + t.survivors, 0)), label: 'survivors left', tone: 'plain' },
    ] satisfies HubStat[],
  }
}

async function buildSurvivor({ shown, allIds, base, flags }: BuildInput) {
  const states = await soft(
    'survivor states',
    () =>
      prisma.survivorGameState.findMany({
        where: { leagueId: { in: allIds } },
        select: {
          leagueId: true,
          phase: true,
          activeTribeCount: true,
          activePlayerCount: true,
          exilePlayerCount: true,
          tribalDeadline: true,
        },
      }),
    [] as {
      leagueId: string
      phase: string
      activeTribeCount: number
      activePlayerCount: number
      exilePlayerCount: number
      tribalDeadline: Date | null
    }[],
    flags,
  )
  const byLeague = new Map(states.map((s) => [s.leagueId, s]))

  const leagues: HubLeagueCard[] = shown.map((m) => {
    const s = byLeague.get(m.id)
    const size = m.leagueSize ?? 0
    const phase = (s?.phase ?? '').toLowerCase()
    const late = /merge|jury|final/.test(phase)
    const done = /complete/.test(phase)
    return {
      ...base(m),
      sub: `${platformLabel(m.platform)} · ${managersLabel(m.leagueSize)}`,
      meter:
        s && size > 0
          ? { pct: pct(s.activePlayerCount, size), value: `${s.activePlayerCount} of ${size}`, tone: 'accent' }
          : null,
      detail: !s ? 'Game state not started' : s.exilePlayerCount > 0 ? `${s.exilePlayerCount} on Exile Island` : null,
      status: s ? titleCase(s.phase) : 'Not started',
      statusTone: !s || done ? 'muted' : late ? 'warn' : 'good',
    }
  })

  const now = Date.now()
  const nextCouncil = states
    .map((s) => s.tribalDeadline?.getTime() ?? 0)
    .filter((t) => t > now)
    .sort((a, b) => a - b)[0]

  return {
    leagues,
    stats: [
      { value: String(states.reduce((sum, s) => sum + s.activeTribeCount, 0)), label: 'tribes active', tone: 'accent' },
      { value: String(states.reduce((sum, s) => sum + s.exilePlayerCount, 0)), label: 'stranded on Exile Island', tone: 'bad' },
      nextCouncil
        ? {
            value: new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', timeZone: 'America/New_York' })
              .format(new Date(nextCouncil)),
            label: 'next tribal council (ET)',
            tone: 'plain',
          }
        : { value: '—', label: 'no council scheduled', tone: 'plain' },
    ] satisfies HubStat[],
  }
}

async function buildTournament({ shown, allIds, base, flags }: BuildInput) {
  const rows = await soft(
    'tournament leagues',
    () =>
      prisma.tournamentLeague.findMany({
        where: { leagueId: { in: allIds } },
        select: {
          leagueId: true,
          status: true,
          tournamentId: true,
          tournament: { select: { name: true } },
          round: { select: { id: true, roundLabel: true, status: true, weekStart: true, weekEnd: true } },
        },
      }),
    [] as {
      leagueId: string | null
      status: string
      tournamentId: string
      tournament: { name: string }
      round: { id: string; roundLabel: string; status: string; weekStart: number; weekEnd: number }
    }[],
    flags,
  )
  const byLeague = new Map(rows.filter((r) => r.leagueId).map((r) => [r.leagueId as string, r]))

  const leagues: HubLeagueCard[] = shown.map((m) => {
    const r = byLeague.get(m.id)
    const status = (r?.status ?? '').toLowerCase()
    return {
      ...base(m),
      sub: r ? r.tournament.name : platformLabel(m.platform),
      meter: null,
      detail: r ? `${r.round.roundLabel} · weeks ${r.round.weekStart}–${r.round.weekEnd}` : null,
      status: r ? titleCase(r.status) : 'Unlinked',
      statusTone: !r || /complete/.test(status) ? 'muted' : /active|progress|live/.test(status) ? 'good' : 'warn',
    }
  })

  const live = rows.filter((r) => !/complete/.test(r.status.toLowerCase()))
  const liveRounds = new Set(rows.filter((r) => /active|progress|live/.test(r.round.status.toLowerCase())).map((r) => r.round.id))
  return {
    leagues,
    stats: [
      { value: String(new Set(rows.map((r) => r.tournamentId)).size), label: 'brackets you play in', tone: 'accent' },
      { value: String(live.length), label: 'leagues still in play', tone: 'good' },
      { value: String(liveRounds.size), label: liveRounds.size === 1 ? 'round underway' : 'rounds underway', tone: 'plain' },
    ] satisfies HubStat[],
  }
}

async function buildEfl({ userId, inFormat, shown, allIds, eflPins, base, flags }: BuildInput) {
  const teams = await soft(
    'efl teams',
    () =>
      prisma.leagueTeam.findMany({
        where: { leagueId: { in: allIds }, claimedByUserId: userId },
        select: { leagueId: true, currentRank: true },
      }),
    [] as { leagueId: string; currentRank: number | null }[],
    flags,
  )
  const rankByLeague = new Map(teams.map((t) => [t.leagueId, t.currentRank]))

  const leagues: HubLeagueCard[] = shown.map((m) => {
    const rank = rankByLeague.get(m.id) ?? null
    const size = m.leagueSize ?? 0
    const standing = rank && size > 0 ? pct(size - rank + 1, size) : null
    const tone: HubTone = standing == null ? 'muted' : standing >= 67 ? 'good' : standing >= 34 ? 'warn' : 'bad'
    return {
      ...base(m),
      sub: `${platformLabel(m.platform)} · ${managersLabel(m.leagueSize)}`,
      meter: standing != null && rank ? { pct: standing, value: `#${rank} of ${size}`, tone } : null,
      detail: standing == null ? 'No standing on file yet' : null,
      status: `Rules v${eflPins.get(m.id) ?? '?'}`,
      statusTone: 'accent',
    }
  })

  const ranks = inFormat.map((m) => rankByLeague.get(m.id)).filter((r): r is number => typeof r === 'number' && r > 0)
  const versions = [...new Set(inFormat.map((m) => eflPins.get(m.id)).filter(Boolean))]
  return {
    leagues,
    stats: [
      { value: String(inFormat.length), label: inFormat.length === 1 ? 'dynasty on EFL rules' : 'dynasties on EFL rules', tone: 'accent' },
      ranks.length > 0
        ? { value: `#${Math.min(...ranks)}`, label: 'your best standing', tone: 'good' }
        : { value: '—', label: 'no standing on file', tone: 'plain' },
      { value: versions.length === 1 ? `v${versions[0]}` : `${versions.length}`, label: versions.length === 1 ? 'rules version pinned' : 'rules versions pinned', tone: 'plain' },
    ] satisfies HubStat[],
  }
}

async function readTrades(userId: string, inFormat: MemberLeague[]) {
  const week = await resolveCurrentWeek(inFormat.map((m) => m.platformLeagueId)).catch(() => null)
  const board = await getTradesBoard(userId, week?.week ?? null)
  const inHub = new Set(inFormat.map((m) => m.id))

  const pending: HubTradeRow[] = board.pending
    .filter((p) => inHub.has(p.leagueId))
    .slice(0, 6)
    .map((p) => ({
      id: p.id,
      title: `${p.youProposed ? 'You proposed' : 'Offered to you'} · ${p.items.length} ${p.items.length === 1 ? 'asset' : 'assets'}`,
      detail: p.expiresAt
        ? `${p.leagueName} · expires ${new Date(p.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : p.leagueName,
    }))

  const completed: HubTradeRow[] = board.windows
    .filter((w) => inHub.has(w.leagueId) && w.latest)
    .slice(0, 6)
    .map((w) => {
      const t = w.latest!
      const when = [t.week != null ? `Wk ${t.week}` : null, t.season != null ? String(t.season) : null].filter(Boolean).join(' ')
      return {
        id: `${w.leagueId}:${t.transactionId}`,
        title: `${t.fromName} ⇄ ${t.toName}`,
        detail: [w.leagueName, when || null, t.letter ? `graded ${t.letter}` : null].filter(Boolean).join(' · '),
      }
    })

  return { pending, completed }
}

async function readMentions(userId: string, inFormat: MemberLeague[]): Promise<HubMention[]> {
  const nameById = new Map(inFormat.map((m) => [m.id, m.name?.trim() || 'Unnamed league']))
  const rows = await prisma.leagueChatMessage.findMany({
    where: {
      leagueId: { in: inFormat.map((m) => m.id) },
      mentionedUserIds: { has: userId },
      // A private @chimmy reply is only ever the asker's.
      OR: [{ isPrivate: false }, { visibleToUserId: userId }],
    },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: {
      id: true,
      leagueId: true,
      message: true,
      createdAt: true,
      // ⚠ displayName and username only — never email, which some name fallbacks in this repo reach for.
      user: { select: { displayName: true, username: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    author: r.user?.displayName?.trim() || (r.user?.username ? `@${r.user.username}` : 'A manager'),
    leagueName: nameById.get(r.leagueId) ?? 'Your league',
    at: r.createdAt.toISOString(),
    text: r.message.length > 240 ? `${r.message.slice(0, 237)}…` : r.message,
  }))
}
