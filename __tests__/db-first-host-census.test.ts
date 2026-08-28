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
/*
 * ⚠ `server/` IS A THIRD SOURCE TREE OF LIVE REQUEST PATHS.
 * `app/api/legacy/[...path]/route.ts` is a dispatcher that lazily imports handlers
 * from `server/api-route-modules/`, so a provider call there is as reachable as one
 * in `app/api` while being invisible to any `app/**` glob.
 *
 * The enforcing guard already walks it — it scans from the repo root — and reports
 * three violations there today. This census did not, which is the asymmetry worth
 * removing: the thing that CLASSIFIES saw less of the repo than the thing that
 * ENFORCES, so a genuinely new host could have landed in `server/` already
 * triaged-looking.
 *
 * Adding the root finds nothing today: `server/` names 7 hosts and all 7 are already
 * classified from their `lib`/`app` call sites. That is the intended outcome for a
 * preventive change — recorded here so the next reader does not mistake a quiet scan
 * for an unnecessary one. The same blind spot DID cost real coverage twice on
 * 2026-08-27: an api.sleeper.com caller in this tree, and two unguarded AI provider
 * calls found by the sibling spend census.
 */
const ROOTS = ['lib', 'app', 'server', 'scripts']
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
  /*
   * ⚠ `cloudinary` WAS IN THIS ALTERNATION and matched api.cloudinary.com, which is an
   * upload API — lib/world-cup/worldCupChatImageUpload.ts POSTs to
   * /v1_1/<cloud>/image/upload. It is already listed under platform-infra below; the
   * only thing this rule did was win on ORDER and attach the wrong reason to it
   * ("consumed as a src, not a data read" — it is neither).
   *
   * The host was in the right bucket by luck and the wrong one by rule. Safe to remove:
   * api.cloudinary.com is the ONLY cloudinary host in the tree, so this alternation had
   * no other work to do.
   */
  { name: 'cdn-media', why: 'image/asset host consumed as a src, not a data read', test: /(^|\.)(sleepercdn|espncdn|flagcdn|mlbstatic|nhle)\.com$/i },
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
  { name: 'platform-infra', why: 'email, analytics, media generation, translation, search and publishing', test: /^(api\.resend\.com|www\.googletagmanager\.com|api\.elevenlabs\.io|api\.heygen\.com|api-free\.deepl\.com|translation\.googleapis\.com|api\.spotify\.com|api\.deezer\.com|itunes\.apple\.com|api\.cloudinary\.com|www\.googleapis\.com)$/i },
  { name: 'gif-picker', why: 'user-facing media search, not a sports data feed', test: /^(giphy\.com|api\.giphy\.com|tenor\.googleapis\.com|api\.klipy\.(com|ai))$/i },
  { name: 'chat-integration', why: 'Discord OAuth, bot API and deep links — a chat platform, not a data feed', test: /^discord\.com$/i },
  { name: 'namespace', why: 'an XML/JSON-LD namespace, never fetched', test: /^(schema\.org|www\.w3\.org|www\.sitemaps\.org)$/i },
  { name: 'geo-ip', why: 'request-time geolocation, not sports data', test: /^(proxycheck\.io|ipapi\.co|ip-api\.com)$/i },
  { name: 'test-fixture', why: 'appears only in fixtures and examples', test: /(^|\.)(example\.(com|org)|example|invalid)$/i },
  /*
   * ⚠ raw.githubusercontent.com WAS IN THIS LIST and did not belong. It is not a
   * fixture host: lib/trade-intel/dynastyProcessSync.ts reads DynastyProcess player
   * values and id mappings from it through a sportsDataCache read-through, and
   * scripts/ingest-coaches-nflverse.ts pulls nflverse games.csv. It has moved to the
   * unmonitored data-API ledger below.
   *
   * Worth noting HOW it hid: the misclassification predates the scripts/ root — the
   * lib/ call site was always in scope. A wrong category is more durable than a
   * missing one, because the host reads as examined.
   */
  /*
   * ⚠ www.googleapis.com WAS IN THIS LIST TOO — the SECOND wrong entry in this one
   * rule, found by re-deriving the claims instead of checking for gaps.
   * lib/autocoach/status-sources/GoogleSearchAdapter.ts does a live fetch to
   * /customsearch/v1 with GOOGLE_SEARCH_API_KEY, and YouTubePublishProvider.ts uses it
   * as the YouTube API base. Neither is a fixture. Moved to platform-infra: it is a
   * search/publishing API, not a sports data feed, so the DB-first rule is not what
   * governs it.
   *
   * That two of this rule's entries were wrong is the argument for the enforcement
   * test below. Prose "why" fields do not fail when they stop being true.
   */
  { name: 'test-fixture', why: 'fixture host', test: /^(placeholder\.invalid|evil\.example|widgets\.enterprise-demo\.example\.com)$/i },
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
  /*
   * ADDED 2026-08-28 BY WIDENING COVERAGE, NOT BY NEW DEBT — the distinction the
   * bound below depends on. Two came into view with the scripts/ root and one was
   * sitting in the wrong category all along. No new unguarded code shipped.
   *
   * nflverse release downloads — play-by-play, weekly player stats, players.csv.
   * Reached only from ingestion scripts, which the DB-first rule permits; listed
   * because the HOST is still an unwatched data feed, and a directory is not a
   * classification.
   */
  'github.com',
  /* DynastyProcess values/ids (lib, via sportsDataCache) and nflverse games.csv. */
  'raw.githubusercontent.com',
  /* MCP endpoint behind scripts/ingest-coaches-coaching-tree.ts — head-coach history. */
  'coaching-tree.app',
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

type Host = { host: string; files: Set<string>; codeRefs: number; fetchedAt: Set<string> }

/**
 * A URL sitting inside (or just below) a call expression is being FETCHED, as opposed
 * to rendered into an `<img src>`, returned as an href, or used as an XML namespace.
 * Looked for across a small window because the URL is usually the argument on the line
 * after `await fetch(`.
 */
const FETCH_CONTEXT = /\bfetch\s*\(|axios\.|\bgot\s*\(|new Request\s*\(|\.post\s*\(|\.get\s*\(/

function findHosts(): Map<string, Host> {
  const hosts = new Map<string, Host>()
  for (const root of ROOTS) {
    for (const abs of walk(path.join(repo, root))) {
      const rel = path.relative(repo, abs).split(path.sep).join('/')
      const lines = fs.readFileSync(abs, 'utf8').split('\n')
      lines.forEach((line, i) => {
        const t = line.trim()
        // A URL inside a comment is documentation, not a call.
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        for (const m of line.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
          const host = m[1].toLowerCase().replace(/[.,)'"`;]+$/, '')
          const existing =
            hosts.get(host) ?? { host, files: new Set<string>(), codeRefs: 0, fetchedAt: new Set<string>() }
          existing.files.add(rel)
          existing.codeRefs += 1
          if (FETCH_CONTEXT.test(lines.slice(Math.max(0, i - 3), i + 1).join('\n'))) {
            existing.fetchedAt.add(`${rel}:${i + 1}`)
          }
          hosts.set(host, existing)
        }
      })
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

    /*
     * TWO separate failures to catch, and one assertion does not cover both.
     *
     * 1. A root that is listed but yields nothing — tree renamed, walk broken.
     *    The per-root check below catches that. It is asserted on call-site
     *    PATHS rather than on a named host, so migrating any single host away
     *    does not falsely trip it.
     */
    const scanned = new Set<string>()
    for (const h of hosts.values()) for (const f of h.files) scanned.add(f.split('/')[0])
    for (const root of ROOTS) {
      expect(scanned, `no host found under ${root}/ — is that root still being scanned?`).toContain(
        root.split('/')[0],
      )
    }

    /*
     * 2. A root DELETED from ROOTS. The loop above shrinks along with the list,
     *    so it would stay green — the deletion has to be pinned against a literal.
     *    `server` is spelled out because it is the one that was missing, and the
     *    one whose absence has already cost coverage twice.
     */
    expect(
      ROOTS,
      'a source tree was dropped from the census — see the note on ROOTS before changing this',
    ).toEqual(['lib', 'app', 'server', 'scripts'])
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

  it('categories that claim a host is NEVER FETCHED are telling the truth', () => {
    /*
     * THE POINT OF THIS TEST. Three of these categories rest on a claim that code can
     * falsify — "never fetched", "only in fixtures" — and a prose `why:` field does not
     * fail when it stops being true. Two entries in the test-fixture rule alone turned
     * out to be wrong, each found only because a human happened to re-read the call
     * sites: raw.githubusercontent.com (DynastyProcess values, read from lib/ through a
     * sportsDataCache) and www.googleapis.com (a live Google Custom Search fetch).
     *
     * Both had been "examined". That is the failure mode a gap check cannot catch: a
     * host in the WRONG category reads as settled, so nobody looks again. This asserts
     * the claim instead of restating it.
     */
    const NEVER_FETCHED = new Set(['share-link', 'namespace', 'test-fixture'])
    const monitored = monitoredPatterns()
    const violations: string[] = []

    for (const h of findHosts().values()) {
      const cat = classify(h.host, monitored)
      if (!cat || !NEVER_FETCHED.has(cat)) continue
      if (h.fetchedAt.size) violations.push(`${h.host} [${cat}] fetched at ${[...h.fetchedAt].join(', ')}`)
    }

    expect(
      violations,
      'A host classified as never-fetched is being fetched. Its category is wrong — move it ' +
        'to the category that matches what the code does, or to DATA_API_UNMONITORED if it is ' +
        'a data feed. Do NOT relax this test: the claim is the whole reason the category exempts ' +
        'the host from the DB-first rule.',
    ).toEqual([])
  })

  it('the unmonitored data-API list has not grown', () => {
    /*
     * Shrinks freely — moving a host into DATA_API_HOST_PATTERNS is the intended
     * direction and should lower this number in the same commit.
     *
     * 16 → 19 on 2026-08-28. THE ONLY LEGITIMATE REASON TO RAISE THIS IS WIDER
     * COVERAGE, and it applied here: adding the scripts/ root brought github.com and
     * coaching-tree.app into view, and raw.githubusercontent.com moved out of a
     * test-fixture category it never belonged in. No new unguarded code shipped —
     * the repo did not get worse, the census got bigger.
     *
     * If you are raising this number for any other reason, you are recording new
     * debt as though it were new visibility. Say so in the commit, or do not raise it.
     */
    expect(DATA_API_UNMONITORED.length).toBeLessThanOrEqual(19)
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
