import { describe, it, expect, vi } from 'vitest'
import {
  storyTypesHandler,
  storyPreviewHandler,
  STORY_ACCESS,
  type StoryApiDeps,
  type StoryPreviewDTO,
  type StoryTypeDescriptor,
} from '@/lib/story/api/handlers'
import { ALL_STORY_TYPES, STORY_TYPES } from '@/lib/story/types'
import type { IStoryFeatureGate } from '@/lib/story/featureGate'

const SECRET_USER_ID = 'usr_secret_1234567890'

// A fake engine that returns a privacy-safe draft (mirrors generateStoryDraft output shape).
function fakeDraft(type: string, empty = false) {
  return {
    type, status: empty ? ('empty' as const) : ('ok' as const),
    title: 'Title', headline: 'A headline', sections: [{ heading: 'H', body: 'B' }],
    bullets: ['A headline'], text: 'Title\n\nA headline', empty,
    generatedAt: '2026-06-28T00:00:00.000Z', sourceFreshness: empty ? null : '2026-06-26T00:00:00.000Z',
  }
}

function makeDeps(over: Partial<StoryApiDeps> = {}): StoryApiDeps {
  return {
    getUserId: vi.fn(async () => 'u1'),
    assertMember: vi.fn(async () => ({ ok: true as const })),
    assertCommissioner: vi.fn(async () => ({ ok: true as const })),
    engine: { generateStory: vi.fn(async ({ type }: { type: string }) => fakeDraft(type)) } as never,
    ...over,
  }
}

describe('G15.13 Story API — types endpoint', () => {
  it('lists all supported story types with access levels (member-readable)', async () => {
    const r = await storyTypesHandler('L', makeDeps())
    expect(r.status).toBe(200)
    const types = (r.body as { data: StoryTypeDescriptor[] }).data
    expect(types.map((t) => t.type).sort()).toEqual([...ALL_STORY_TYPES].sort())
    expect(types.find((t) => t.type === STORY_TYPES.HEALTH_NARRATIVE)?.access).toBe('commissioner')
    expect(types.find((t) => t.type === STORY_TYPES.WHAT_HAPPENED_RECENTLY)?.access).toBe('member')
  })

  it('401 unauthenticated, 403 non-member', async () => {
    expect((await storyTypesHandler('L', makeDeps({ getUserId: vi.fn(async () => null) }))).status).toBe(401)
    expect((await storyTypesHandler('L', makeDeps({ assertMember: vi.fn(async () => ({ ok: false, status: 403 })) }))).status).toBe(403)
  })
})

describe('G15.13 Story API — preview endpoint', () => {
  it('200 successful preview returns a privacy-safe DTO', async () => {
    const r = await storyPreviewHandler('L', STORY_TYPES.ACTIVITY_REPORT, makeDeps())
    expect(r.status).toBe(200)
    const dto = (r.body as { data: StoryPreviewDTO }).data
    expect(dto.type).toBe(STORY_TYPES.ACTIVITY_REPORT)
    expect(dto.title.length).toBeGreaterThan(0)
    expect(dto.summary.length).toBeGreaterThan(0)
    expect(dto.sections.length).toBeGreaterThan(0)
    expect(dto.safetyNote).toMatch(/not accusations|observations/i)
    expect(dto.generatedAt).toBeTruthy()
    expect(dto).toHaveProperty('sourceFreshness')
    // DTO is allow-listed — no raw payload/meta/text fields leak through
    expect(Object.keys(dto).sort()).toEqual(
      ['empty', 'generatedAt', 'safetyNote', 'sections', 'sourceFreshness', 'status', 'summary', 'title', 'type'].sort(),
    )
  })

  it('400 for an unknown / missing story type', async () => {
    expect((await storyPreviewHandler('L', 'not_a_type', makeDeps())).status).toBe(400)
    expect((await storyPreviewHandler('L', null, makeDeps())).status).toBe(400)
  })

  it('empty-state preview still returns 200 with empty=true', async () => {
    const deps = makeDeps({ engine: { generateStory: vi.fn(async ({ type }: { type: string }) => fakeDraft(type, true)) } as never })
    const r = await storyPreviewHandler('L', STORY_TYPES.WEEKLY_RECAP, deps)
    expect(r.status).toBe(200)
    expect((r.body as { data: StoryPreviewDTO }).data.empty).toBe(true)
  })

  it('member-readable types do NOT require commissioner', async () => {
    const deps = makeDeps({ assertCommissioner: vi.fn(async () => ({ ok: false, status: 403 })) })
    for (const type of ALL_STORY_TYPES.filter((t) => STORY_ACCESS[t] === 'member')) {
      expect((await storyPreviewHandler('L', type, deps)).status).toBe(200)
    }
  })

  it('commissioner-only types require commissioner (403 for non-commissioner member)', async () => {
    const deps = makeDeps({ assertCommissioner: vi.fn(async () => ({ ok: false, status: 403 })) })
    for (const type of ALL_STORY_TYPES.filter((t) => STORY_ACCESS[t] === 'commissioner')) {
      expect((await storyPreviewHandler('L', type, deps)).status).toBe(403)
    }
  })

  it('401 unauthenticated for preview', async () => {
    expect((await storyPreviewHandler('L', STORY_TYPES.ACTIVITY_REPORT, makeDeps({ getUserId: vi.fn(async () => null) }))).status).toBe(401)
  })

  it('feature-gate: deny → 403, upgrade_required → 402', async () => {
    const denyGate: IStoryFeatureGate = { decide: () => 'deny' }
    const upgradeGate: IStoryFeatureGate = { decide: () => 'upgrade_required' }
    expect((await storyPreviewHandler('L', STORY_TYPES.ACTIVITY_REPORT, makeDeps({ gate: denyGate }))).status).toBe(403)
    const up = await storyPreviewHandler('L', STORY_TYPES.ACTIVITY_REPORT, makeDeps({ gate: upgradeGate }))
    expect(up.status).toBe(402)
    expect((up.body as { error: string }).error).toBe('feature_unavailable')
  })

  it('feature-gate default (no gate supplied) allows', async () => {
    expect((await storyPreviewHandler('L', STORY_TYPES.ACTIVITY_REPORT, makeDeps())).status).toBe(200)
  })

  it('privacy: a private user id never appears in the response body', async () => {
    // even if the engine somehow returned an id-bearing field, the DTO mapping drops it
    const leaky = makeDeps({
      engine: { generateStory: vi.fn(async ({ type }: { type: string }) => ({ ...fakeDraft(type), leakedMeta: { managerKeys: [SECRET_USER_ID] } })) } as never,
    })
    const r = await storyPreviewHandler('L', STORY_TYPES.WEEKLY_RECAP, leaky)
    expect(JSON.stringify(r.body)).not.toContain(SECRET_USER_ID)
  })

  it('does not query raw events/providers — engine.generateStory is the only data call', async () => {
    const generateStory = vi.fn(async ({ type }: { type: string }) => fakeDraft(type))
    const deps = makeDeps({ engine: { generateStory } as never })
    await storyPreviewHandler('L', STORY_TYPES.ACTIVITY_REPORT, deps)
    expect(generateStory).toHaveBeenCalledTimes(1)
  })
})
