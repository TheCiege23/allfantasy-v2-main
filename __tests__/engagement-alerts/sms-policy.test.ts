import { describe, expect, it, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ profile: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/user-settings', () => ({ getSettingsProfile: h.profile }))
vi.mock('@/lib/twilio-client', () => ({ sendSms: h.send }))
import { sendCriticalSms } from '@/lib/sms-engagement/sendCriticalSms'
beforeEach(() => {
  vi.resetAllMocks()
  h.profile.mockResolvedValue({ phone: '+15555555555', phoneVerifiedAt: new Date(), notificationPreferences: { smsConsent: { phone: '+15555555555', consentedAt: new Date().toISOString() }, globalEnabled: true, categories: { draft_alerts: { enabled: true, sms: true } } } })
  h.send.mockResolvedValue(true)
})
describe('direct engagement text policy', () => {
  it.each(['injury_alerts', 'matchup_results', 'ai_alerts'] as const)('blocks %s before contacting a provider', async category => {
    const result = await sendCriticalSms('u', category, 'Update')
    expect(result.ok).toBe(false)
    expect(h.profile).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })
  it('preserves verified opted-in league draft texts', async () => {
    expect((await sendCriticalSms('u', 'draft_alerts', 'Your pick is in three picks')).ok).toBe(true)
    expect(h.send).toHaveBeenCalledTimes(1)
  })
})
