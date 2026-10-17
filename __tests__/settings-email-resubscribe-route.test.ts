// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** PATCH /api/user/settings `{ emailResubscribe: true }` — the Settings "Turn alert emails back on". */

const h = vi.hoisted(() => ({
  userId: 'u-1' as string | null,
  email: 'manager@allfantasy-test.net' as string | null,
  resume: vi.fn(async () => 1),
  save: vi.fn(async () => ({ ok: true })),
}))

vi.mock('next-auth', () => ({ getServerSession: async () => (h.userId ? { user: { id: h.userId } } : null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/user-settings', () => ({
  getSettingsSnapshot: async () => ({ profile: { email: h.email, notificationPreferences: {} }, settings: null }),
  saveSettingsOrchestrated: h.save,
}))
vi.mock('@/lib/email/emailSubscription', () => ({ resumeAlertEmails: h.resume }))

import { PATCH } from '@/app/api/user/settings/route'

const req = (body: unknown) => new Request('https://x.test/api/user/settings', { method: 'PATCH', body: JSON.stringify(body) })

beforeEach(() => {
  h.userId = 'u-1'
  h.email = 'manager@allfantasy-test.net'
  h.resume.mockClear()
  h.resume.mockImplementation(async () => 1)
  h.save.mockClear()
})

describe('PATCH /api/user/settings emailResubscribe', () => {
  it("resumes THIS account's address and saves nothing else", async () => {
    const res = await PATCH(req({ emailResubscribe: true }))
    expect(res.status).toBe(200)
    expect(h.resume).toHaveBeenCalledWith('manager@allfantasy-test.net')
    expect(h.save).not.toHaveBeenCalled()
  })

  it('refuses without a session, and with no address on the account', async () => {
    h.userId = null
    expect((await PATCH(req({ emailResubscribe: true }))).status).toBe(401)
    h.userId = 'u-1'
    h.email = null
    expect((await PATCH(req({ emailResubscribe: true }))).status).toBe(400)
    expect(h.resume).not.toHaveBeenCalled()
  })

  it('a failed write is a 503, not a silent success', async () => {
    h.resume.mockImplementation(async () => {
      throw new Error('db down')
    })
    expect((await PATCH(req({ emailResubscribe: true }))).status).toBe(503)
  })

  it('an ordinary settings save never resubscribes', async () => {
    await PATCH(req({ profile: { bio: 'hi' } }))
    expect(h.resume).not.toHaveBeenCalled()
    expect(h.save).toHaveBeenCalled()
  })
})

describe('the dispatcher sees the state', () => {
  it('getSettingsSnapshot loads the Unsubscribe state onto the profile the dispatcher reads', () => {
    const src = readFileSync(path.join(process.cwd(), 'lib/user-settings/SettingsQueryService.ts'), 'utf8')
    expect(src).toMatch(/emailSubscription:\s*await readEmailSubscription\(bootstrapped\.profile\.email\)/)
  })
})
