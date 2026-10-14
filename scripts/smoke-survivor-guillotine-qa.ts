/** Authenticated release smoke on an isolated Neon branch. No real addresses or outbound messages. */
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { defaultSGConfig } from '../lib/survivor-guillotine/config'
import { getEffectiveLeagueRosterTemplate, starterEligiblePlayerPositionsFromTemplate } from '../lib/league/getEffectiveLeagueRosterTemplate'
import { rosterFingerprintFromEligible } from '../lib/draft-room/draft-pool-eligible-positions'
import { identifyTarget } from './db-target-identity.cjs'

const endpoint = new URL(process.env.DATABASE_URL ?? '').hostname.split('.')[0].replace(/-pooler$/, '')
const sport = process.env.SG_QA_SPORT === 'NBA' ? 'NBA' : 'NFL'
if (!process.env.SG_QA_ENDPOINT || endpoint !== process.env.SG_QA_ENDPOINT ||
    identifyTarget(process.env.DATABASE_URL ?? '').kind === 'production') {
  throw new Error('An explicitly named, nonproduction QA database branch is required.')
}

const base = 'http://127.0.0.1:3249'
const marker = `sg-qa-${randomUUID()}`
const password = randomUUID() + randomUUID()
const users: { id: string; email: string }[] = []
const leagues: string[] = []

function browser() {
  const cookies = new Map<string, string>()
  return async (path: string, init: RequestInit = {}) => {
    const response = await fetch(base + path, {
      ...init, redirect: 'manual', signal: AbortSignal.timeout(180_000),
      headers: { ...Object.fromEntries(new Headers(init.headers)),
        cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
    })
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]
      const index = pair.indexOf('=')
      cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    return response
  }
}

async function login(index: number) {
  const user = await prisma.appUser.create({ data: {
    username: `${marker}-${index}`, email: `${marker}-${index}@example.invalid`,
    emailVerified: new Date(), passwordHash: await bcrypt.hash(password, 6),
  } })
  users.push({ id: user.id, email: user.email! })
  const request = browser()
  const csrf = await (await request('/api/auth/csrf')).json() as { csrfToken: string }
  const response = await request('/api/auth/callback/credentials', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken: csrf.csrfToken, login: user.email!, password,
      callbackUrl: base, json: 'true' }).toString(),
  })
  if (response.status >= 400) throw new Error(`Login ${index} failed: ${response.status}`)
  const session = await (await request('/api/auth/session')).json() as { user?: { id?: string } }
  if (session.user?.id !== user.id) throw new Error(`Account ${index} did not receive its own session`)
  return request
}

async function json(request: ReturnType<typeof browser>, path: string, init: RequestInit = {}) {
  const response = await request(path, init)
  const body = await response.json() as Record<string, unknown>
  return { response, body }
}

async function seedQADraftPool(leagueId: string) {
  const template = await getEffectiveLeagueRosterTemplate(leagueId)
  const eligible = starterEligiblePlayerPositionsFromTemplate(template.template)
  const allowed = eligible.size ? eligible : new Set(template.allowedPositions)
  const position = sport === 'NFL' ? 'WR' : 'PG'
  if (!allowed.has(position)) throw new Error(`QA draft position ${position} is not eligible`)
  const candidates = await prisma.player.findMany({ where: { sport, position }, take: 150,
    select: { id: true, name: true, position: true, team: true } })
  const seenNames = new Set<string>()
  const players = candidates.filter(player => {
    const key = player.name.trim().toLowerCase()
    if (!key || seenNames.has(key)) return false
    seenNames.add(key)
    return true
  }).slice(0, 22)
  if (players.length < 22) throw new Error('QA branch lacks 22 real draft players')
  const entries = players.map((player, index) => ({ playerId: player.id, name: player.name,
    position: player.position, team: player.team, adp: index + 1,
    display: { playerId: player.id, displayName: player.name, sport,
      assets: { headshotUrl: null, teamLogoUrl: null },
      team: { teamId: player.team ?? 'FA', abbreviation: player.team ?? 'FA',
        displayName: player.team ?? 'Free Agent', sport, logoUrl: null },
      stats: { adp: index + 1, primaryStatLabel: 'ADP', primaryStatValue: index + 1 },
      metadata: { position: player.position, teamAbbreviation: player.team ?? 'FA',
        byeWeek: null, injuryStatus: null, sport } } }))
  const fingerprint = `${template.hasPersistedRosterSchema ? 'cfg' : 'nocfg'}:starters:${rosterFingerprintFromEligible(allowed)}`
  await prisma.draftPoolCache.create({ data: { leagueId, cacheKey: `sg-qa:${leagueId}`,
    sourceFingerprint: fingerprint, entryCount: entries.length, sport, poolType: 'pro',
    expiresAt: new Date(Date.now() + 60 * 60_000),
    payload: { entries, sport, count: entries.length, rosterConfigurationIncomplete: false } } })
}

async function main() {
  try {
    const [commissioner, memberOne, memberTwo, memberThree] = await Promise.all([0, 1, 2, 3].map(login))
    const config = { ...defaultSGConfig(sport), tribeCount: 4 }
    const created = await json(commissioner, '/api/leagues', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ concept: 'redraft', sport, scoringPreset: sport === 'NFL' ? 'fb_half_ppr' : 'nba_points',
        teamCount: 22, draftType: 'snake', leagueName: marker,
        timezone: 'America/New_York', conceptSetup: { visibility: 'private', isPublic: false } }),
    })
    const id = (created.body.league as { id?: string } | undefined)?.id
    if (!created.response.ok || !id) throw new Error(`Create failed: ${created.response.status} ${String(created.body.error ?? '')}`)
    leagues.push(id)
    const saved = await json(commissioner, `/api/leagues/${id}/survivor-guillotine`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'rules', config }),
    })
    if (!saved.response.ok) throw new Error(`Rules failed: ${saved.response.status} ${String(saved.body.error ?? '')}`)
    const league = await prisma.league.findUniqueOrThrow({ where: { id } })
    if (league.leagueVariant !== 'survivor_guillotine' || league.waiverType !== 'faab' ||
        await prisma.roster.count({ where: { leagueId: id } }) !== 22) {
      throw new Error('Created league did not retain its Survivor variant, FAAB, and 22 seats')
    }
    const invite = await json(commissioner, `/api/leagues/join?leagueId=${id}`)
    const inviteCode = invite.body.inviteCode
    if (!invite.response.ok || typeof inviteCode !== 'string' || !inviteCode) throw new Error('Invite lookup failed')
    for (const request of [memberOne, memberTwo, memberThree]) {
      const joined = await json(request, '/api/leagues/join', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: inviteCode }) })
      if (!joined.response.ok) throw new Error(`Invite join failed: ${joined.response.status} ${String(joined.body.error ?? '')}`)
      const view = await json(request, `/api/leagues/${id}/survivor-guillotine`)
      if (!view.response.ok || !view.body.season) throw new Error('Joined manager cannot open Survivor league')
      const forbidden = await json(request, `/api/leagues/${id}/survivor-guillotine`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'rules', config }),
      })
      if (forbidden.response.status !== 403) throw new Error('Noncommissioner could edit Survivor rules')
    }
    const joined = await prisma.leagueTeam.count({ where: { leagueId: id, claimedByUserId: { not: null } } })
    if (joined < 3) throw new Error(`Only ${joined} invite seats were claimed`)
    // Complete a real one-round native draft through the same endpoints managers use.
    // This proves the draft-completion hook seeds concealed player-bound idols.
    const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId: id },
      orderBy: { createdAt: 'desc' } })
    await prisma.draftSession.update({ where: { id: draft.id }, data: { rounds: 1, timerSeconds: 3600 } })
    await seedQADraftPool(id)
    const pool = await json(commissioner, `/api/leagues/${id}/draft/pool?limit=100`, {})
    let started = await json(commissioner, `/api/leagues/${id}/draft/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    })
    for (let attempt = 0; attempt < 5 && started.response.status === 409 &&
        String(started.body.error ?? '').includes('Preparing player pool'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      await json(commissioner, `/api/leagues/${id}/draft/pool?limit=100`, {})
      started = await json(commissioner, `/api/leagues/${id}/draft/session`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
    }
    if (!started.response.ok) throw new Error(`Draft start failed: ${started.response.status} ${String(started.body.error ?? '')}`)
    const entries = (pool.body.entries ?? []) as { playerId?: string; name: string; position: string; team?: string | null }[]
    if (!pool.response.ok || entries.filter(row => row.playerId).length < 22) throw new Error('Draft pool lacks 22 identified players')
    for (let overall = 1; overall <= 22; overall++) {
      const player = entries.filter(row => row.playerId)[overall - 1]
      const picked = await json(commissioner, `/api/leagues/${id}/draft/pick`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerName: player.name, position: player.position,
          playerId: player.playerId, team: player.team, source: 'commissioner', expectedOverall: overall }),
      })
      if (!picked.response.ok) throw new Error(`Draft pick ${overall} failed: ${picked.response.status} ${String(picked.body.error ?? '')}`)
    }
    if ((await prisma.draftSession.findUniqueOrThrow({ where: { id: draft.id } })).status !== 'completed') {
      throw new Error('Native draft did not complete')
    }
    const draftIdols = await prisma.survivorGuillotinePower.count({ where: { leagueId: id, binding: 'player' } })
    if (draftIdols < 1) throw new Error('Draft completion did not seed hidden player-bound idols')
    console.log(JSON.stringify({ target: 'isolated Neon branch', sport, created: true, ruleSave: true,
      variant: league.leagueVariant, rosterSeats: 22, inviteJoins: 3, managerRead: true,
      memberRulesDenied: true, nativeDraftPicks: 22, draftIdols }))
  } finally {
    for (const id of leagues) {
      await prisma.draftPoolCache.deleteMany({ where: { leagueId: id } })
      await prisma.league.deleteMany({ where: { id } })
    }
    const ids = users.map(user => user.id)
    if (ids.length) {
      await prisma.analyticsEvent.deleteMany({ where: { userId: { in: ids } } })
      await prisma.appUser.deleteMany({ where: { id: { in: ids } } })
    }
    console.log(JSON.stringify({ cleanup: { leagues: leagues.length, accounts: users.length } }))
    await prisma.$disconnect()
  }
}

main().catch(error => { console.error('Survivor QA failed:', error instanceof Error ? error.message.slice(0, 250) : String(error)); process.exitCode = 1 })
