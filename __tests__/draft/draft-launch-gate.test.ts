/**
 * Production cleanup / deploy gate — non-mutating assertions for draft room launch.
 * Complements: d5-scheduler-cron-route, d5-proper-feature-flag, d6-1-right-dock-tabs,
 * sport-stat-columns, sleeper-pool-table-stat-columns, draft-room-ui-state.
 *
 * Path note: live at **`__tests__/draft/draft-launch-gate.test.ts`** (not repo-root `__tests__/`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from '@/app/api/cron/recompute-allfantasy-adp/route'
import { isD6PreviewRouteEnabled } from '@/lib/dev/d6PreviewRoute'
import { resolveAllFantasyAdpDraftMode } from '@/lib/adp/allFantasyAdpFlag'

const root = resolve(__dirname, '..', '..')

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as Parameters<typeof GET>[0]
}

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('draft launch gate — d6 dev preview', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('isD6PreviewRouteEnabled is false in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    // Re-import would cache module; the function reads process.env at call time
    expect(isD6PreviewRouteEnabled()).toBe(false)
  })

  it('isD6PreviewRouteEnabled is true in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(isD6PreviewRouteEnabled()).toBe(true)
  })

  it('d6 preview page uses shared guard and notFound', () => {
    const page = read('app/dev/d6-preview/page.tsx')
    expect(page).toMatch(/isD6PreviewRouteEnabled/)
    expect(page).toMatch(/notFound\(\)/)
  })
})

describe('draft launch gate — AllFantasy ADP default', () => {
  it('resolveAllFantasyAdpDraftMode defaults to real', () => {
    expect(resolveAllFantasyAdpDraftMode({ env: {} })).toBe('real')
  })
})

describe('draft launch gate — recompute ADP cron rejects unauthenticated calls', () => {
  it('returns 401 when no secret is provided', async () => {
    const res = await GET(makeReq('http://localhost/api/cron/recompute-allfantasy-adp'))
    expect(res.status).toBe(401)
  })
})

describe('draft launch gate — draft-room client has no hardcoded http(s) URLs', () => {
  const rel = 'components/app/draft-room/DraftRoomPageClient.tsx'
  it('DraftRoomPageClient does not embed provider base URLs (use /api routes)', () => {
    const src = read(rel)
    expect(src).not.toMatch(/https?:\/\//)
  })
})

describe('draft launch gate — new dock tabs stay Supabase-free (d6-1 contract)', () => {
  it('matches d6-1: DraftRightDockTabs + PlayerPanel have no Supabase imports', () => {
    const dock = read('components/app/draft-room/DraftRightDockTabs.tsx')
    const panel = read('components/app/draft-room/PlayerPanel.tsx')
    expect(dock).not.toMatch(/supabase|@supabase/)
    expect(panel).not.toMatch(/from\s*['"](?:@|\.).*supabase/i)
  })
})

describe('draft launch gate — production DraftRoom client (MVP API + guards)', () => {
  const client = read('components/app/draft-room/DraftRoomPageClient.tsx')

  it('does not import mock/legacy DraftRoom or mock draft engine entrypoints', () => {
    expect(client).not.toMatch(/af-legacy\/.*mock-draft\/DraftRoom/)
    expect(client).not.toMatch(/mock-draft\/DraftRoom/)
    expect(client).not.toMatch(/['"]@\/lib\/mock-draft\/draft-engine['"]/)
  })

  it('uses live league draft HTTP paths (session, live-sync, pick, queue, pool, chat, AI reorder)', () => {
    expect(client).toMatch(/\/api\/leagues\/\$\{encodeURIComponent\(leagueId\)\}\/draft\/session/)
    expect(client).toMatch(/\/draft\/live-sync/)
    expect(client).toMatch(/\/draft\/pick/)
    expect(client).toMatch(/\/draft\/queue\W/)
    expect(client).toMatch(/\/draft\/queue\/ai-reorder/)
    expect(client).toMatch(/\/draft\/pool/)
    expect(client).toMatch(/\/draft\/chat/)
  })

  it('derives countdown from server timerEndAt (no client clock authority for pick advance)', () => {
    expect(client).toMatch(/timerEndAt/)
    expect(client).toMatch(/mergeDraftSessionSnapshot/)
  })

  it('refetches/merges session on stale or race pick errors', () => {
    expect(client).toMatch(/DRAFT_PICK_STALE_OVERALL/)
    expect(client).toMatch(/DRAFT_PICK_RACE_RETRY/)
  })
})

describe('draft launch gate — ADP / sport stat / queue / NPC modules exist', () => {
  it('exposes separate ADP vs AI ADP column helpers for the pool UI', () => {
    const mod = read('lib/draft-room/playerPoolAdpColumns.ts')
    expect(mod).toMatch(/resolvePlayerPoolAdpColumns/)
    expect(mod).toMatch(/aiAdp/)
    expect(mod).toMatch(/\badp\b/)
  })

  it('wires SleeperPoolTable layout to sport stat columns', () => {
    const layout = read('lib/draft-room/sleeperPoolTableLayout.ts')
    const panel = read('components/app/draft-room/PlayerPanel.tsx')
    expect(layout).toMatch(/buildSleeperPoolStatColumnDefs/)
    expect(panel).toMatch(/sleeperPoolStatOptionsFromPositionFilter/)
    expect(panel).toMatch(/statColumnOptions=\{sleeperStatOpts\}/)
  })

  it('AF Pro queue planner module is present', () => {
    const mod = read('lib/live-draft-engine/draftQueueAiReorder.ts')
    expect(mod).toMatch(/planDraftQueueAiReorder/)
    expect(mod).toMatch(/aiManageDraftQueueEnabled/)
  })

  it('NPC personality assignment exists for deterministic autopick', () => {
    const mod = read('lib/live-draft-engine/npcDraftPersonality.ts')
    expect(mod).toMatch(/assignNpcDraftPersonality/)
  })
})

describe('draft launch gate — AI ADP cron auth wiring', () => {
  const cronRoute = read('app/api/cron/recompute-allfantasy-adp/route.ts')
  const auth = read('app/api/cron/_auth.ts')

  it('cron route delegates auth to requireCronAuth before work', () => {
    expect(cronRoute).toMatch(/requireCronAuth/)
  })

  it('cron secret env includes CRON_SECRET (among other allowed secrets)', () => {
    expect(auth).toMatch(/CRON_SECRET/)
  })
})

describe('draft launch gate — live draft engine map documents MVP + known gaps', () => {
  const doc = read('docs/live-draft-engine-map.md')

  it('mentions MVP-ready production draft path and DraftRoom routes', () => {
    expect(doc).toMatch(/MVP-ready/)
    expect(doc).toMatch(/draft\/session/)
    expect(doc).toMatch(/PickSubmissionService/)
  })

  it('documents web push and DraftQueueEntry / typecheck as non-blocking follow-ups', () => {
    expect(doc).toMatch(/web push/i)
    expect(doc).toMatch(/DraftQueueEntry|draft_queue_entries/i)
    expect(doc).toMatch(/typecheck/i)
  })
})
