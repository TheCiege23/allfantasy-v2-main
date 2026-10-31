/**
 * Screenshot walkthrough of a finished (or stopped) Survivor rehearsal league, through the real app,
 * against the rehearsal's ISOLATED database. Run by the `walkthrough` job of
 * .github/workflows/survivor-season-rehearsal.yml after the season job; never against production.
 *
 *   SURVIVOR_REHEARSAL_ENDPOINT=ep-xxxx DATABASE_URL=... NEXTAUTH_SECRET=<per-run random> \
 *     npx tsx scripts/survivor-season-rehearsal/walkthrough.ts \
 *       --league-file=rehearsal.log.league --base-url=http://127.0.0.1:3000 --out=walkthrough
 *
 * Sign-in: the app's sessions are next-auth JWTs (lib/auth.ts, `session.strategy: "jwt"`). This mints
 * the same cookie next-auth writes at sign-in — `next-auth/jwt`'s own `encode`, carrying the claims the
 * jwt callback stamps (sub, id, email, name, username, sid) — signed with NEXTAUTH_SECRET, which the
 * workflow generates fresh for each run and hands to the app it starts. No route, flag or bypass is
 * added to the app: the server verifies the cookie exactly as it verifies any other, and the secret
 * dies with the job, so the cookie is worthless anywhere else.
 *
 * 🛑 Refuses unless DATABASE_URL is the rehearsal endpoint (./guard), the base URL is loopback, and
 * NEXTAUTH_SECRET looks per-run random. The browser aborts every request that is not to the app
 * under test, so no third-party script, analytics beacon or absolute production URL is ever reached.
 *
 * `--dry-run=<file.html>` skips the database and sign-in and screenshots that one static page at both
 * sizes: it proves Playwright and the capture loop work without a database.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertIsolatedRehearsalDatabase } from './guard'

const arg = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const LEAGUE_FILE = arg('league-file', 'rehearsal.log.league')
const BASE_URL = arg('base-url', 'http://127.0.0.1:3000').replace(/\/+$/, '')
const OUT = arg('out', 'walkthrough')
const DRY_RUN = arg('dry-run', '')
const NAV_TIMEOUT_MS = Number(arg('nav-timeout-ms', '120000'))
const SETTLE_MS = Number(arg('settle-ms', '1500'))
export const VIEWPORTS = [
  { key: 'desktop', width: 1440, height: 900, isMobile: false, deviceScaleFactor: 1 },
  { key: 'phone', width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
] as const

type Screen = { slug: string; label: string; path: string; commissionerOnly?: boolean }

/** Every Survivor surface, labelled with its Survivor name (lib/core-app/survivorTheme.ts SURVIVOR_NAV_LABELS). */
export function survivorScreens(leagueId: string): Screen[] {
  const q = `?league=${encodeURIComponent(leagueId)}`
  const s = `/survivor/${encodeURIComponent(leagueId)}`
  return [
    { slug: 'core-camp', label: 'Camp (/core?league=)', path: `/core${q}` },
    { slug: 'league-home', label: 'League home', path: `/league/${encodeURIComponent(leagueId)}` },
    { slug: 'core-my-team', label: 'Your shelter', path: `/core/my-team${q}` },
    { slug: 'core-matchup', label: 'Immunity challenge', path: `/core/matchup${q}` },
    { slug: 'core-week', label: 'This episode', path: `/core/week${q}` },
    { slug: 'core-live', label: 'Challenge feed', path: `/core/live${q}` },
    { slug: 'core-standings', label: 'Tribe standings', path: `/core/standings${q}` },
    { slug: 'core-season-outlook', label: 'Island map', path: `/core/season-outlook${q}` },
    { slug: 'core-war-room', label: 'Strategy hut', path: `/core/war-room${q}` },
    { slug: 'core-waivers', label: 'Supply drop', path: `/core/waivers${q}` },
    { slug: 'core-trades', label: 'Beach deals', path: `/core/trades${q}` },
    { slug: 'core-draft-hq', label: 'The marooning', path: `/core/draft-hq${q}` },
    { slug: 'core-players', label: 'Players', path: `/core/players${q}` },
    { slug: 'core-commissioner', label: 'Island control', path: `/core/commissioner${q}`, commissionerOnly: true },
    { slug: 'survivor-hub', label: 'Survivor hub', path: s },
    { slug: 'survivor-tribe', label: 'Tribe', path: `${s}/tribe` },
    { slug: 'survivor-tribal', label: 'Tribal council', path: `${s}/tribal` },
    { slug: 'survivor-challenges', label: 'Challenges', path: `${s}/challenges` },
    { slug: 'survivor-exile', label: 'Exile', path: `${s}/exile` },
    { slug: 'survivor-exile-tokens', label: 'Exile tokens', path: `${s}/exile/tokens` },
    { slug: 'survivor-merge', label: 'Merge', path: `${s}/merge` },
    { slug: 'survivor-jury', label: 'Jury', path: `${s}/jury` },
    { slug: 'survivor-finale', label: 'Finale', path: `${s}/finale` },
    { slug: 'survivor-episodes', label: 'Episodes', path: `${s}/episodes` },
    { slug: 'survivor-story', label: 'Story', path: `${s}/story` },
    { slug: 'survivor-intel', label: 'Intel', path: `${s}/intel` },
    { slug: 'survivor-chat', label: 'Chat', path: `${s}/chat` },
    { slug: 'survivor-chimmy', label: 'Chimmy', path: `${s}/chimmy` },
    { slug: 'survivor-swap', label: 'Tribe swap', path: `${s}/swap` },
    { slug: 'survivor-rules', label: 'Rules', path: `${s}/rules` },
    { slug: 'survivor-commissioner', label: 'Survivor commissioner', path: `${s}/commissioner`, commissionerOnly: true },
    { slug: 'survivor-settings', label: 'Survivor settings', path: `${s}/settings`, commissionerOnly: true },
  ]
}

type Persona = { key: 'castaway' | 'commissioner'; userId: string; username: string; email: string | null; name: string | null; note: string }

type Shot = {
  persona: string; viewport: string; slug: string; label: string; path: string; file: string | null
  status: number | null; finalPath: string | null; title: string | null; consoleErrors: number; signedOut: boolean; error: string | null
}

function assertLoopback(url: string) {
  const host = new URL(url).hostname
  assert.ok(host === '127.0.0.1' || host === 'localhost', `--base-url must be loopback (got ${host}); the walkthrough only drives the app this job started`)
}

function assertPerRunSecret() {
  const secret = process.env.NEXTAUTH_SECRET ?? ''
  assert.ok(/^[0-9a-f]{64}$/.test(secret), 'NEXTAUTH_SECRET must be a per-run `openssl rand -hex 32` value, never a real secret')
}

async function loadPersonas(leagueId: string, markerUserIds: string[]): Promise<Persona[]> {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    const league = await prisma.league.findUniqueOrThrow({ where: { id: leagueId }, select: { userId: true } })
    // The rehearsal's own test users only: a Chimmy seat belongs to an `orphan-` user and is skipped.
    const cast = await prisma.survivorPlayer.findMany({
      where: { leagueId, userId: { in: markerUserIds } },
      select: { userId: true, displayName: true, playerState: true },
      orderBy: { userId: 'asc' },
    })
    const rank = (state: string) => ['active', 'finalist', 'jury', 'exile', 'eliminated'].indexOf(state) >>> 0
    const castaway = cast.filter(c => c.userId !== league.userId).sort((a, b) => rank(a.playerState) - rank(b.playerState))[0]
    assert.ok(castaway, 'no rehearsal castaway other than the commissioner')
    const users = await prisma.appUser.findMany({
      where: { id: { in: [league.userId, castaway.userId] } },
      select: { id: true, username: true, email: true, displayName: true },
    })
    const user = (id: string) => {
      const u = users.find(x => x.id === id)
      assert.ok(u, `app user ${id} not found`)
      assert.ok(markerUserIds.includes(u.id), `refusing to sign in as ${u.id}: not one of this rehearsal's test users`)
      assert.ok(!u.email || u.email.endsWith('@example.invalid'), `refusing to sign in as ${u.id}: not an example.invalid test user`)
      return u
    }
    const c = user(league.userId), k = user(castaway.userId)
    return [
      { key: 'castaway', userId: k.id, username: k.username, email: k.email, name: k.displayName, note: `${castaway.displayName} (${castaway.playerState})` },
      { key: 'commissioner', userId: c.id, username: c.username, email: c.email, name: c.displayName, note: 'league owner' },
    ]
  } finally {
    await prisma.$disconnect()
  }
}

/** The cookie next-auth writes at sign-in, minted with next-auth's own encoder and the per-run secret. */
async function sessionCookieFor(persona: Persona): Promise<string> {
  const { encode } = await import('next-auth/jwt')
  return encode({
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: 6 * 60 * 60,
    token: {
      sub: persona.userId, id: persona.userId, email: persona.email, name: persona.name,
      username: persona.username, picture: null, sid: `walkthrough-${randomUUID()}`,
    },
  })
}

async function main() {
  const { chromium } = await import('@playwright/test')
  mkdirSync(OUT, { recursive: true })

  let screens: Screen[]
  let personas: Array<Persona | { key: 'static'; userId: ''; note: string }>
  let leagueId = ''
  if (DRY_RUN) {
    screens = [{ slug: 'static', label: `Static page ${DRY_RUN}`, path: pathToFileURL(DRY_RUN).href }]
    personas = [{ key: 'static', userId: '', note: 'dry run, no sign-in' }]
  } else {
    assertIsolatedRehearsalDatabase()
    assertLoopback(BASE_URL)
    assertPerRunSecret()
    const file = JSON.parse(readFileSync(LEAGUE_FILE, 'utf8')) as { leagueId: string; userIds: string[] }
    leagueId = file.leagueId
    assert.ok(leagueId && Array.isArray(file.userIds) && file.userIds.length, `${LEAGUE_FILE} holds no league`)
    personas = await loadPersonas(leagueId, file.userIds)
    screens = survivorScreens(leagueId)
  }

  const origin = DRY_RUN ? null : new URL(BASE_URL).origin
  const blockedHosts = new Map<string, number>()
  const shots: Shot[] = []
  const browser = await chromium.launch()
  try {
    for (const persona of personas) {
      const cookie = persona.key === 'static' ? null : await sessionCookieFor(persona as Persona)
      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.isMobile,
          deviceScaleFactor: vp.deviceScaleFactor, timezoneId: 'America/New_York', locale: 'en-US',
        })
        // Only the app under test (and inline data) may load; everything else is aborted and counted.
        await context.route('**/*', route => {
          const url = route.request().url()
          if (url.startsWith('data:') || url.startsWith('blob:') || (DRY_RUN ? url.startsWith('file:') : new URL(url).origin === origin)) return route.continue()
          let host = url
          try { host = new URL(url).host } catch {}
          blockedHosts.set(host, (blockedHosts.get(host) ?? 0) + 1)
          return route.abort('blockedbyclient')
        })
        if (cookie && origin) {
          await context.addCookies([{ name: 'next-auth.session-token', value: cookie, url: origin, httpOnly: true, sameSite: 'Lax' }])
          // Prove the server accepts the session before spending time on screens.
          const res = await context.request.get(`${origin}/api/auth/session`)
          const body = await res.json().catch(() => null) as { user?: { id?: string } } | null
          assert.equal(body?.user?.id, persona.userId, `${persona.key}: the app did not accept the minted session (HTTP ${res.status()})`)
        }
        const page = await context.newPage()
        let consoleErrors = 0
        page.on('console', m => { if (m.type() === 'error') consoleErrors++ })
        page.on('pageerror', () => { consoleErrors++ })
        const dir = join(OUT, persona.key, vp.key)
        mkdirSync(dir, { recursive: true })
        for (const [i, screen] of screens.entries()) {
          if (screen.commissionerOnly && persona.key !== 'commissioner') continue
          const before = consoleErrors
          const file = join(dir, `${String(i + 1).padStart(2, '0')}-${screen.slug}.png`)
          const shot: Shot = {
            persona: persona.key, viewport: vp.key, slug: screen.slug, label: screen.label, path: screen.path,
            file: null, status: null, finalPath: null, title: null, consoleErrors: 0, signedOut: false, error: null,
          }
          try {
            const res = await page.goto(DRY_RUN ? screen.path : `${origin}${screen.path}`, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
            shot.status = res?.status() ?? null
            await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
            await page.waitForTimeout(SETTLE_MS)
            const finalUrl = new URL(page.url())
            shot.finalPath = DRY_RUN ? finalUrl.pathname.split('/').pop() ?? '' : finalUrl.pathname + finalUrl.search
            shot.signedOut = finalUrl.pathname === '/login'
            shot.title = await page.title()
            await page.screenshot({ path: file, fullPage: true, timeout: 60_000 })
            shot.file = file
          } catch (error) {
            shot.error = String((error as Error)?.message ?? error).split('\n')[0].slice(0, 200)
          }
          shot.consoleErrors = consoleErrors - before
          shots.push(shot)
          console.log(`${persona.key}/${vp.key} ${screen.slug}: ${shot.error ? `ERROR ${shot.error}` : `${shot.status} -> ${shot.finalPath}${shot.signedOut ? ' (SIGNED OUT)' : ''}`}`)
        }
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }

  const manifest = { leagueId, baseUrl: DRY_RUN ? null : BASE_URL, personas, viewports: VIEWPORTS, shots, blockedHosts: Object.fromEntries(blockedHosts) }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(OUT, 'summary.md'), summaryMarkdown(manifest))
  const failed = shots.filter(s => s.error || !s.file).length
  console.log(`walkthrough: ${shots.length - failed}/${shots.length} screenshots in ${OUT}; ${blockedHosts.size} external hosts blocked`)
}

function summaryMarkdown(m: { leagueId: string; personas: Array<{ key: string; note: string }>; shots: Shot[]; blockedHosts: Record<string, number> }): string {
  const ok = m.shots.filter(s => s.file && !s.error)
  const lines = [
    `${ok.length}/${m.shots.length} screenshots (desktop 1440x900, phone 390x844)${m.leagueId ? ` of league \`${m.leagueId}\`` : ''}.`,
    `Signed in as: ${m.personas.map(p => `**${p.key}** — ${p.note}`).join('; ')}.`,
    '',
    '| screen | path | ' + [...new Set(m.shots.map(s => `${s.persona}/${s.viewport}`))].join(' | ') + ' |',
    '|---|---|' + [...new Set(m.shots.map(s => `${s.persona}/${s.viewport}`))].map(() => '---').join('|') + '|',
  ]
  const cols = [...new Set(m.shots.map(s => `${s.persona}/${s.viewport}`))]
  for (const slug of [...new Set(m.shots.map(s => s.slug))]) {
    const any = m.shots.find(s => s.slug === slug)!
    const cells = cols.map(col => {
      const s = m.shots.find(x => x.slug === slug && `${x.persona}/${x.viewport}` === col)
      if (!s) return '—'
      if (s.error) return `error: ${s.error.replace(/\|/g, '/').slice(0, 60)}`
      const moved = s.finalPath && s.finalPath !== s.path ? ` → \`${s.finalPath.slice(0, 60)}\`` : ''
      return `${s.status ?? '?'}${s.signedOut ? ' SIGNED OUT' : ''}${moved}${s.consoleErrors ? ` (${s.consoleErrors} console errors)` : ''}`
    })
    lines.push(`| ${any.label} | \`${any.path.replace(/\?league=[^&]+/, '?league=…').replace(/\/survivor\/[^/]+/, '/survivor/…').replace(/\/league\/[^/]+/, '/league/…')}\` | ${cells.join(' | ')} |`)
  }
  const blocked = Object.entries(m.blockedHosts)
  lines.push('', blocked.length ? `External requests blocked in the browser: ${blocked.map(([h, n]) => `${h} (${n})`).join(', ')}.` : 'No external requests were attempted by the browser.')
  return lines.join('\n') + '\n'
}

main().catch(error => {
  console.error(String(error?.stack ?? error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted]'))
  process.exitCode = 1
})
