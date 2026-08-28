// @vitest-environment node
/**
 * A CENSUS OF OUTBOUND HOSTS, complementing scripts/check-db-first-api-boundary.mjs.
 *
 * That guard watches DATA_API_HOST_PATTERNS — a list. CLAUDE.md says so in as many
 * words: "The monitored-host list is NOT a census of our providers — check it
 * before you assume a provider is watched." A provider absent from it is invisible
 * to the guard no matter how heavily it is used, which is exactly how CFBD, api-sports
 * and Rolling Insights each stayed unwatched until someone happened to look.
 *
 * This scans instead. Every outbound host literal in lib/ and app/ must fall into a
 * declared category, so a NEW host fails on the commit that introduces it rather than
 * whenever someone next audits by hand.
 *
 * ⚠ IT CLASSIFIES, IT DOES NOT ENFORCE. Deciding a host is a data API that belongs
 * behind the DB-first rule is a real migration with real call-site work; this test's
 * job is to make sure no host is UNEXAMINED. DATA_API_UNMONITORED below is the
 * standing list of ones that are examined and known-unresolved.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const repo = process.cwd()
const ROOTS = ['lib', 'app']
const SKIP_DIR = new Set(['node_modules', '.next', 'dist', 'build', '__tests__', '__mocks__'])

/** Pulled from the guard itself so the two cannot drift apart. */
function monitoredPatterns(): RegExp[] {
  const src = fs.readFileSync(path.join(repo, 'scripts/check-db-first-api-boundary.mjs'), 'utf8')
  const start = src.indexOf('const DATA_API_HOST_PATTERNS = [')
  const block = src.slice(start, src.indexOf('\n]', start))
  return [...block.matchAll(/\/\^?\(?[^\n]*?\/i/g)]
    .map((m) => {
      try {
        return new RegExp(m[0].slice(1, m[0].lastIndexOf('/')), 'i')
      } catch {
        return null
      }
    })
    .filter((r): r is RegExp => r !== null)
}

/**
 * Categories that are NOT data-API reads, with the reason each is exempt.
 * A host matching one of these is examined and dismissed, not ignored.
 */
const CATEGORIES: Array<{ name: string; why: string; test: RegExp }> = [
  { name: 'first-party', why: 'our own origins', test: /(^|\.)allfantasy\.(ai|app|com|io|local)$/i },
  { name: 'first-party', why: 'our own origins', test: /(^|\.)clawship\.ai$/i },
  { name: 'cdn-media', why: 'image/asset host consumed as a src, not a data read', test: /(^|\.)(sleepercdn|espncdn|flagcdn|mlbstatic|nhle|cloudinary)\.com$/i },
  { name: 'cdn-media', why: 'image/asset host', test: /^(cdn\.nba\.com|cdn\.discordapp\.com|media\.api-sports\.io|img\.mlbstatic\.com|assets\.nhle\.com)$/i },
  { name: 'share-link', why: 'a URL we hand the user, never fetched', test: /^(twitter\.com|x\.com|www\.reddit\.com|www\.facebook\.com|www\.linkedin\.com|wa\.me|api\.whatsapp\.com|discord\.gg|www\.youtube\.com|fancred\.app)$/i },
  /*
   * Bare sleeper.com is a DEEP LINK, not a feed — href targets like
   * /leagues/<id>/settings and "Open in Sleeper" buttons. It sat in the
   * data-API ledger below until someone read the call sites; recorded here so
   * it is not re-filed as debt. api.sleeper.com, the stats host, is a genuine
   * feed and is now monitored by the guard.
   */
  { name: 'share-link', why: 'Sleeper deep links handed to the user', test: /^sleeper\.com$/i },
  { name: 'oauth', why: 'authentication endpoint, not a data feed', test: /^(accounts\.spotify\.com|api\.login\.yahoo\.com|oauth2\.googleapis\.com|oauth\.reddit\.com|connect\.facebook\.net|js\.stripe\.com)$/i },
  { name: 'ai-provider', why: 'covered by the AI spend guard, a different boundary', test: /^(api\.openai\.com|api\.anthropic\.com|api\.x\.ai|api\.deepseek\.com|google\.serper\.dev|generativelanguage\.googleapis\.com|api\.groq\.com|openrouter\.ai)$/i },
  { name: 'platform-infra', why: 'email, analytics, media generation, translation', test: /^(api\.resend\.com|www\.googletagmanager\.com|api\.elevenlabs\.io|api\.heygen\.com|api-free\.deepl\.com|translation\.googleapis\.com|api\.spotify\.com|api\.deezer\.com|itunes\.apple\.com|api\.cloudinary\.com)$/i },
  { name: 'gif-picker', why: 'user-facing media search, not a sports data feed', test: /^(giphy\.com|api\.giphy\.com|tenor\.googleapis\.com|api\.klipy\.(com|ai))$/i },
  { name: 'chat-integration', why: 'Discord OAuth, bot API and deep links — a chat platform, not a data feed', test: /^discord\.com$/i },
  { name: 'namespace', why: 'an XML/JSON-LD namespace, never fetched', test: /^(schema\.org|www\.w3\.org|www\.sitemaps\.org)$/i },
  { name: 'geo-ip', why: 'request-time geolocation, not sports data', test: /^(proxycheck\.io|ipapi\.co|ip-api\.com)$/i },
  { name: 'test-fixture', why: 'appears only in fixtures and examples', test: /(^|\.)(example\.(com|org)|example|invalid)$/i },
  { name: 'test-fixture', why: 'fixture host', test: /^(placeholder\.invalid|evil\.example|widgets\.enterprise-demo\.example\.com|raw\.githubusercontent\.com|www\.googleapis\.com)$/i },
]

/**
 * SPORTS/FANTASY DATA HOSTS THAT THE GUARD DOES NOT WATCH — a ratchet, not an allowlist.
 *
 * Each is a real data feed reached from application code while being invisible to
 * check-db-first-api-boundary.mjs. Adding one to DATA_API_HOST_PATTERNS is the fix, and it
 * will report pre-existing violations when you do — that is the guard working, not a
 * regression you caused.
 *
 * RESOLVED, and left here as the worked example: api.sleeper.com is NOT api.sleeper.app.
 * The guard watched the .app host only, so every read of the .com stats host bypassed it —
 * the same near-collision CLAUDE.md records for api-sports.io versus api.sportsdata.io.
 * This census found it, and it is now in DATA_API_HOST_PATTERNS. Bare sleeper.com turned out
 * to be a deep link rather than a feed and was moved to CATEGORIES; that correction only
 * happened because someone read the call sites instead of trusting the hostname.
 *
 * ⚠ STILL OPEN, same shape: lm-api-reads.fantasy.espn.com and fantasy.espn.com are neither
 * api.espn.com nor site.api.espn.com, the two ESPN hosts that ARE monitored.
 *
 * The list may shrink freely. It must not grow.
 */
const DATA_API_UNMONITORED = [
  'api.myfantasyleague.com',
  'www.myfantasyleague.com',
  'bleacherreport.com',
  'lm-api-reads.fantasy.espn.com',
  'fantasy.espn.com',
  'football.fantasysports.yahoo.com',
  'www.fantrax.com',
  'api.clearsportsapi.com',
  'www.fleaflicker.com',
  'www.leaguesafe.com',
  'fantasyfootballcalculator.com',
  'www.theaudiodb.com',
  'openweathermap.org',
  'api.twitter.com',
  'graph.facebook.com',
  'www.mlbstatic.com',
]

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) walk(p, out)
    } else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

type Host = { host: string; files: Set<string>; codeRefs: number }

function findHosts(): Map<string, Host> {
  const hosts = new Map<string, Host>()
  for (const root of ROOTS) {
    for (const abs of walk(path.join(repo, root))) {
      const rel = path.relative(repo, abs).split(path.sep).join('/')
      for (const line of fs.readFileSync(abs, 'utf8').split('\n')) {
        const t = line.trim()
        // A URL inside a comment is documentation, not a call.
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
        for (const m of line.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
          const host = m[1].toLowerCase().replace(/[.,)'"`;]+$/, '')
          const existing = hosts.get(host) ?? { host, files: new Set<string>(), codeRefs: 0 }
          existing.files.add(rel)
          existing.codeRefs += 1
          hosts.set(host, existing)
        }
      }
    }
  }
  return hosts
}

function classify(host: string, monitored: RegExp[]): string | null {
  if (monitored.some((r) => r.test(host))) return 'monitored'
  if (DATA_API_UNMONITORED.includes(host)) return 'data-api-unmonitored'
  const cat = CATEGORIES.find((c) => c.test.test(host))
  return cat ? cat.name : null
}

describe('DB-first boundary — outbound host census', () => {
  it('finds hosts at all (a scan that finds nothing always passes)', () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    const hosts = findHosts()
    expect(hosts.size).toBeGreaterThan(50)
    expect(hosts.has('api.sleeper.app')).toBe(true)
  })

  it('reads the monitored list out of the guard, not a copy', () => {
    // If this drops to zero the guard was renamed or restructured, and every
    // "monitored" classification below would silently become "unclassified".
    expect(monitoredPatterns().length).toBeGreaterThan(5)
  })

  it('every outbound host is classified', () => {
    const monitored = monitoredPatterns()
    const unclassified = [...findHosts().values()]
      .filter((h) => classify(h.host, monitored) === null)
      .map((h) => `${h.host}  (${[...h.files][0]}${h.files.size > 1 ? ` +${h.files.size - 1}` : ''})`)
      .sort()

    expect(
      unclassified,
      'A new outbound host appeared. Classify it: add a CATEGORIES rule if it is not a data ' +
        'read (CDN, share link, OAuth, namespace), or add it to DATA_API_UNMONITORED if it is a ' +
        'data feed. If it belongs behind the DB-first rule, add it to DATA_API_HOST_PATTERNS in ' +
        'scripts/check-db-first-api-boundary.mjs instead — that is the fix, this is the ledger.',
    ).toEqual([])
  })

  it('the unmonitored data-API list has not grown', () => {
    // Shrinks freely — moving a host into DATA_API_HOST_PATTERNS is the intended
    // direction and should lower this number in the same commit.
    expect(DATA_API_UNMONITORED.length).toBeLessThanOrEqual(16)
  })

  it('every unmonitored entry is still referenced, and still unmonitored', () => {
    // A stale entry hides real coverage: it either names a host nobody calls any
    // more, or one that has since been added to the guard.
    const hosts = findHosts()
    const monitored = monitoredPatterns()
    const gone = DATA_API_UNMONITORED.filter((h) => !hosts.has(h))
    const nowMonitored = DATA_API_UNMONITORED.filter((h) => monitored.some((r) => r.test(h)))
    expect(gone, 'listed as unmonitored but no longer referenced — remove it').toEqual([])
    expect(nowMonitored, 'now monitored by the guard — remove it from DATA_API_UNMONITORED').toEqual([])
  })
})
