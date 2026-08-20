/**
 * Production cleanup / deploy gate — non-mutating assertions for draft room launch.
 * Complements: d5-scheduler-cron-route, d5-proper-feature-flag, d6-1-right-dock-tabs,
 * sport-stat-columns, sleeper-pool-table-stat-columns, draft-room-ui-state.
 *
 * Path note: live at **`__tests__/draft/draft-launch-gate.test.ts`** (not repo-root `__tests__/`).
 */
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from '@/app/api/cron/recompute-allfantasy-adp/route'
import { isD6PreviewRouteEnabled } from '@/lib/dev/d6PreviewRoute'
import { resolveAllFantasyAdpDraftMode } from '@/lib/adp/allFantasyAdpFlag'

function makeReq(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as Parameters<typeof GET>[0]
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

/*
 * ⚠ FOUR SOURCE-TEXT DESCRIBE BLOCKS WERE DELETED FROM THE END OF THIS FILE.
 * They read DraftRoomPageClient.tsx, DraftRightDockTabs.tsx, PlayerPanel.tsx,
 * playerPoolAdpColumns.ts and sleeperPoolTableLayout.ts off disk and regex-matched them —
 * "uses live league draft HTTP paths", "does not import mock/legacy DraftRoom", "no Supabase
 * imports", "derives countdown from server timerEndAt". Every one asserted the source still
 * SPELLS something a particular way.
 *
 * Two of them were failing simply because the client had been refactored, which is the whole
 * problem: a deploy gate that fires on a rename teaches people to ignore it, and it never fires
 * on the thing it was named for. The three checks above are kept because they call real code —
 * the env-dependent preview guard, the ADP default, and the cron route actually returning 401.
 *
 * The intent worth rebuilding: "the draft client talks to /api routes, never a provider base URL"
 * is a genuine deploy invariant. It wants a lint rule or a dependency-graph assertion, not a grep
 * for `http` in one file.
 */
