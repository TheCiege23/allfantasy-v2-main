// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), commissioner: vi.fn(), league: vi.fn(), update: vi.fn(), registered: vi.fn(),
  privacy: vi.fn(), rateLimit: vi.fn(), client: vi.fn(), send: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: mocks.league, update: mocks.update }, appUser: { findFirst: mocks.registered } } }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: mocks.commissioner }))
vi.mock('@/lib/league-privacy', () => ({ getLeaguePrivacySettings: mocks.privacy }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }))
vi.mock('@/lib/resend-client', () => ({ getResendClient: mocks.client }))
vi.mock('@/lib/league-invite', () => ({
  buildFantasyInviteLink: (code: string, origin: string) => `${origin}/join?code=${encodeURIComponent(code)}`,
  generateInviteToken: () => 'new-invite',
  getDefaultFantasyInviteExpiry: () => '2100-01-01T00:00:00.000Z',
}))

let league: { id: string; name: string; settings: Record<string, unknown> }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('PUBLIC_SITE_URL', 'https://www.allfantasy.ai')
  vi.stubEnv('VERCEL_ENV', 'production')
  league = { id: 'league-1', name: 'Friends league', settings: { inviteCode: 'first-code', inviteExpiresAt: '2100-01-01T00:00:00.000Z' } }
  mocks.session.mockResolvedValue({ user: { id: 'commissioner-1' } })
  mocks.commissioner.mockResolvedValue(undefined)
  mocks.league.mockImplementation(async () => league)
  mocks.update.mockResolvedValue(league)
  mocks.registered.mockResolvedValue(null)
  mocks.privacy.mockResolvedValue({ allowEmailInvite: true, allowUsernameInvite: true })
  mocks.rateLimit.mockReturnValue({ success: true })
  mocks.client.mockReturnValue({ client: { emails: { send: mocks.send } }, fromEmail: 'AllFantasy <noreply@allfantasy.ai>' })
  mocks.send.mockResolvedValue({ data: { id: 'email-id' }, error: null })
})
afterEach(() => vi.unstubAllEnvs())
async function send(body = { type: 'email', email: 'delivered@resend.dev' }) {
  const { POST } = await import('@/app/api/commissioner/leagues/[leagueId]/invite/send/route')
  return POST(new Request('https://www.allfantasy.ai/api/commissioner/leagues/league-1/invite/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-host': 'attacker.invalid' }, body: JSON.stringify(body),
  }) as any, { params: Promise.resolve({ leagueId: league.id }) })
}

describe('commissioner invite email reliability', () => {
  it('sends a regenerated invite to the same recipient with a new provider key', async () => {
    expect((await send()).status).toBe(200)
    league.settings.inviteCode = 'regenerated-code'
    expect((await send()).status).toBe(200)
    const [first, second] = mocks.send.mock.calls
    expect(first[1].idempotencyKey).not.toBe(second[1].idempotencyKey)
    expect(second[0].html).toContain('/join?code=regenerated-code')
    expect(second[1].idempotencyKey).not.toContain('regenerated-code')
    expect(second[1].idempotencyKey).not.toContain('delivered@resend.dev')
  })
  it('deduplicates an exact retry while allowing changed email content', async () => {
    await send(); await send()
    expect(mocks.send.mock.calls[0][1]).toEqual(mocks.send.mock.calls[1][1])
    league.name = 'Renamed friends league'
    await send()
    expect(mocks.send.mock.calls[2][1]).not.toEqual(mocks.send.mock.calls[0][1])
  })
  it.each(['2020-01-01T00:00:00.000Z', 'not-a-date'])('refuses an unusable expiry %s before sending or renewing it', async (expiry) => {
    league.settings.inviteExpiresAt = expiry
    const r = await send()
    expect(r.status).toBe(410)
    expect(await r.json()).toMatchObject({ ok: false, sent: false, code: 'INVITE_EXPIRED' })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('prepares a valid default invite when none exists', async () => {
    league.settings = {}
    const r = await send()
    expect(r.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { settings: { inviteCode: 'new-invite', inviteExpiresAt: '2100-01-01T00:00:00.000Z' } } }))
  })
  it.each(['rejected', 'throw', 'missing-id'])('reports %s as failure and preserves the share link without exposing provider internals', async (mode) => {
    if (mode === 'rejected') mocks.send.mockResolvedValue({ error: { message: 'private provider detail' }, data: null })
    else if (mode === 'throw') mocks.client.mockImplementation(() => { throw Error('private provider detail') })
    else mocks.send.mockResolvedValue({ data: null, error: null })
    const r = await send(), body = await r.json()
    expect(r.status).toBe(502)
    expect(body).toMatchObject({ ok: false, sent: false, code: 'EMAIL_SEND_FAILED', inviteUrl: 'https://www.allfantasy.ai/join?code=first-code' })
    expect(JSON.stringify(body)).not.toContain('private provider detail')
  })
  it('keeps HTML escaping, configured origin, and a one-line subject', async () => {
    league.name = '<a href="https://attacker.invalid">Join</a>\r\nInjected'
    const r = await send()
    expect(r.status).toBe(200)
    const message = mocks.send.mock.calls[0][0]
    expect(message.html).toContain('&lt;a href=')
    expect(message.html).not.toContain('<a href="https://attacker.invalid">')
    expect(message.html).toContain('https://www.allfantasy.ai/join?code=')
    expect(message.subject).not.toMatch(/[\r\n]/)
  })
  it('retains commissioner authorization, privacy controls, and send limits', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await send()).status).toBe(401)
    mocks.commissioner.mockRejectedValueOnce(Error('Forbidden'))
    expect((await send()).status).toBe(403)
    mocks.privacy.mockResolvedValueOnce({ allowEmailInvite: false })
    expect((await send()).status).toBe(403)
    mocks.rateLimit.mockReturnValueOnce({ success: false })
    expect((await send()).status).toBe(429)
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
