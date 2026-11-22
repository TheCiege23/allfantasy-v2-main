import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/draft-war-room/route'

/*
 * /api/draft-war-room ran a second, independent draft ranker. It was retired 2026-11-14 in favour of
 * the one draft engine; it must answer 410 with a pointer, never compute a pick.
 */
describe('POST /api/draft-war-room (retired)', () => {
  it('answers 410 and points at the unified draft engine', async () => {
    const res = await POST()
    expect(res.status).toBe(410)
    const body = (await res.json()) as { code: string; error: string }
    expect(body.code).toBe('DRAFT_WAR_ROOM_RETIRED')
    expect(body.error).toContain('/api/draft/recommend')
  })
})
