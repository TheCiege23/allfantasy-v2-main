// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Plan gates read the LIVE plan (lib/subscription/livePlanFlags.ts), never the
 * UserProfile.afProSub / afCommissionerSub / afWarRoomSub copy. That copy is written only on a
 * Stripe webhook, so it misses admin grants and plans that lapse by date. On production
 * (2026-09-24) one entitled account had no flag and was locked out of all ten gates below.
 *
 * Every gate is tested in both directions a stale flag fails:
 *   STALE-FALSE — the resolver says the plan is live, the flag says no  → must be let in;
 *   STALE-TRUE  — the flag says yes, the resolver says the plan is gone → must be kept out.
 */

const resolver = vi.hoisted(() => ({
  resolveSnapshot: vi.fn(),
  resolveForUser: vi.fn(),
}))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveSnapshot = resolver.resolveSnapshot
    resolveForUser = resolver.resolveForUser
  },
}))

const db = vi.hoisted(() => ({
  userProfile: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  league: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const session = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const openai = vi.hoisted(() => vi.fn())
vi.mock('@/lib/openai-client', () => ({ openaiChatJson: openai }))

import { NO_PLAN_FLAGS, planFlagsFromSnapshot, resolveLivePlanFlags } from '@/lib/subscription/livePlanFlags'
import type { EntitlementStatus, SubscriptionPlanId } from '@/lib/subscription/types'
import { syncUserProfileFromSubscriptions } from '@/lib/subscription/syncBridge'
import { POST as quickCreate } from '@/app/api/league/ai-quick-create/route'
import { generateLeagueNamesWithAi } from '@/lib/tournament/namingEngine'
import { loadWarRoomAiContext } from '@/lib/war-room/war-room-context'
import C2CCampusPage from '@/app/c2c/[leagueId]/campus/page'

const LIVE = (plans: SubscriptionPlanId[], status: EntitlementStatus = 'active') => ({
  plans,
  status,
  currentPeriodEnd: null,
  gracePeriodEnd: null,
})
const NONE = LIVE([], 'none')
/** Every flag set — what a lapsed or never-synced-back profile row can still hold. */
const STALE_TRUE_FLAGS = { afProSub: true, afCommissionerSub: true, afWarRoomSub: true }
const STALE_FALSE_FLAGS = { afProSub: false, afCommissionerSub: false, afWarRoomSub: false }

beforeEach(() => {
  vi.clearAllMocks()
  session.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.test' } })
  db.league.findUnique.mockResolvedValue({ id: 'lg-1', sport: 'NFL', leagueSettings: null })
})

function staleProfile(flags: Record<string, boolean>) {
  db.userProfile.findFirst.mockResolvedValue({ ...flags })
  db.userProfile.findUnique.mockResolvedValue({ ...flags })
}

describe('planFlagsFromSnapshot', () => {
  it('a live plan sets its own family, and Supreme sets all three', () => {
    expect(planFlagsFromSnapshot(LIVE(['pro']))).toEqual({ pro: true, commissioner: false, warRoom: false })
    expect(planFlagsFromSnapshot(LIVE(['commissioner'], 'grace'))).toEqual({ pro: false, commissioner: true, warRoom: false })
    expect(planFlagsFromSnapshot(LIVE(['war_room']))).toEqual({ pro: false, commissioner: false, warRoom: true })
    expect(planFlagsFromSnapshot(LIVE(['supreme']))).toEqual({ pro: true, commissioner: true, warRoom: true })
  })

  it('🛑 a plan that is past due, expired or absent sets nothing', () => {
    for (const status of ['past_due', 'expired', 'none'] as const) {
      expect(planFlagsFromSnapshot(LIVE(['supreme'], status))).toEqual(NO_PLAN_FLAGS)
    }
  })
})

describe('resolveLivePlanFlags', () => {
  it('asks the resolver, passing the email the admin bypass keys on', async () => {
    resolver.resolveSnapshot.mockResolvedValue(LIVE(['commissioner']))
    await expect(resolveLivePlanFlags('u1', 'a@b.test')).resolves.toMatchObject({ commissioner: true })
    expect(resolver.resolveSnapshot).toHaveBeenCalledWith('u1', 'a@b.test')
  })

  it('🛑 fails CLOSED and never throws', async () => {
    resolver.resolveSnapshot.mockRejectedValue(new Error('db down'))
    await expect(resolveLivePlanFlags('u1')).resolves.toEqual(NO_PLAN_FLAGS)
  })
})

describe('syncBridge writes what the live check reads', () => {
  it('the flags it stores are the live flags for the same snapshot', async () => {
    resolver.resolveSnapshot.mockResolvedValue(LIVE(['commissioner']))
    await syncUserProfileFromSubscriptions('u1')
    expect(db.userProfile.upsert.mock.calls[0]![0].update).toEqual({
      afCommissionerSub: true,
      afProSub: false,
      afWarRoomSub: false,
    })
  })
})

describe('AI quick-create (AF Commissioner)', () => {
  const call = () =>
    quickCreate(new Request('http://x.test/api/league/ai-quick-create', { method: 'POST', body: JSON.stringify({ prompt: '12 team NFL dynasty' }) }))

  it('STALE-FALSE: an admin-granted commissioner is let in', async () => {
    staleProfile(STALE_FALSE_FLAGS)
    resolver.resolveSnapshot.mockResolvedValue(LIVE(['commissioner']))
    expect((await call()).status).toBe(200)
  })

  it('🛑 STALE-TRUE: a lapsed commissioner is kept out, and told where to buy', async () => {
    staleProfile(STALE_TRUE_FLAGS)
    resolver.resolveSnapshot.mockResolvedValue(NONE)
    const res = await call()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ upgradePath: '/upgrade?plan=commissioner&feature=ai_quick_create' })
  })
})

describe('Tournament AI naming (AF Commissioner)', () => {
  const args = { userId: 'u1', sport: 'NFL', roundLabel: 'R1', count: 2, avoid: [] }

  it('STALE-FALSE: an entitled commissioner gets the model call', async () => {
    staleProfile(STALE_FALSE_FLAGS)
    resolver.resolveSnapshot.mockResolvedValue(LIVE(['supreme']))
    openai.mockResolvedValue({ ok: true, json: { choices: [{ message: { content: '{"names":["A B","C D"]}' } }] } })
    await expect(generateLeagueNamesWithAi(args)).resolves.toEqual(['A B', 'C D'])
  })

  it('🛑 STALE-TRUE: no plan, no model call', async () => {
    staleProfile(STALE_TRUE_FLAGS)
    resolver.resolveSnapshot.mockResolvedValue(NONE)
    await expect(generateLeagueNamesWithAi(args)).resolves.toBeNull()
    expect(openai).not.toHaveBeenCalled()
  })
})

describe('War Room AI (AF Legacy)', () => {
  it('STALE-FALSE: a live Legacy plan unlocks the personal tools', async () => {
    staleProfile(STALE_FALSE_FLAGS)
    resolver.resolveSnapshot.mockResolvedValue(LIVE(['war_room']))
    expect((await loadWarRoomAiContext('lg-1', 'u1'))?.hasWarRoomSubscription).toBe(true)
  })

  it('🛑 STALE-TRUE: a lapsed Legacy plan does not', async () => {
    staleProfile(STALE_TRUE_FLAGS)
    resolver.resolveSnapshot.mockResolvedValue(NONE)
    expect((await loadWarRoomAiContext('lg-1', 'u1'))?.hasWarRoomSubscription).toBe(false)
  })
})

describe('C2C / devy roster pages (AF Commissioner panel)', () => {
  function hasAfSubProp(node: unknown): boolean | undefined {
    if (!node || typeof node !== 'object') return undefined
    const props = (node as { props?: Record<string, unknown> }).props
    if (!props) return undefined
    if ('hasAfSub' in props) return props.hasAfSub as boolean
    const kids = Array.isArray(props.children) ? props.children : [props.children]
    for (const k of kids) {
      const found = hasAfSubProp(k)
      if (found !== undefined) return found
    }
    return undefined
  }

  it('the page hands the live plan to the roster, both ways', async () => {
    staleProfile(STALE_FALSE_FLAGS)
    resolver.resolveSnapshot.mockResolvedValue(LIVE(['commissioner']))
    expect(hasAfSubProp(await C2CCampusPage({ params: Promise.resolve({ leagueId: 'lg-1' }) }))).toBe(true)

    staleProfile(STALE_TRUE_FLAGS)
    resolver.resolveSnapshot.mockResolvedValue(NONE)
    expect(hasAfSubProp(await C2CCampusPage({ params: Promise.resolve({ leagueId: 'lg-1' }) }))).toBe(false)
  })
})

describe('🛑 nothing reads the profile plan flags any more', () => {
  const root = resolve(__dirname, '..')
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) sourceFiles(full, out)
      else if (/\.(ts|tsx)$/.test(name)) out.push(full)
    }
    return out
  }
  /**
   * The two shapes a flag READ takes: a Prisma select of it, or ANY property read of it —
   * whatever the receiver is called or cast to, since `(p as any)?.afProSub` reads the
   * same stale column. The one exemption is `entitlement.afCommissionerSub`
   * (UnifiedCommissionerSystem → AICommissionerPanel), a field computed from the live
   * resolver. `lib/subscription/syncBridge.ts` writes `afXSub: hasX` and matches neither.
   */
  const FLAG_READ = /\baf(?:Pro|Commissioner|WarRoom)Sub\s*:\s*true\b|(?<!entitlement\??)\.af(?:Pro|Commissioner|WarRoom)Sub\b/

  it('positive control: the pattern catches every shape the old gates used, and spares the live field', () => {
    expect(FLAG_READ.test('select: { afCommissionerSub: true },')).toBe(true)
    expect(FLAG_READ.test('hasAfSub={profile?.afCommissionerSub ?? false}')).toBe(true)
    expect(FLAG_READ.test('hasPremium: Boolean(subscriptionProfile?.afProSub),')).toBe(true)
    expect(FLAG_READ.test('hasPremium: Boolean((row as any)?.afProSub),')).toBe(true)
    expect(FLAG_READ.test('const x = user.afWarRoomSub')).toBe(true)
    expect(FLAG_READ.test('      afCommissionerSub: hasCommissioner,')).toBe(false)
    expect(FLAG_READ.test('!unifiedAssessment?.entitlement.afCommissionerSub')).toBe(false)
  })

  // A full-tree read: 39s once on a loaded dev box, so it gets its own budget.
  it('app/, components/, lib/', () => {
    const hits: string[] = []
    for (const dir of ['app', 'components', 'lib']) {
      for (const file of sourceFiles(join(root, dir))) {
        const text = readFileSync(file, 'utf8')
        // Every match contains "Sub"; most files do not, so they are never split.
        if (!text.includes('Sub')) continue
        text.split(/\r?\n/).forEach((line, i) => {
          if (FLAG_READ.test(line)) hits.push(`${file.slice(root.length + 1)}:${i + 1}: ${line.trim()}`)
        })
      }
    }
    expect(hits).toEqual([])
  }, 120_000)
})
