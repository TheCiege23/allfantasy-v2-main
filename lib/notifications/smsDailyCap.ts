/**
 * Per-recipient daily cap on notification texts.
 *
 * Every SMS is a Twilio charge, and until 2026-09-24 nothing limited how many a user could be
 * sent: NotificationDispatcher texted any verified phone for every event in an SMS-enabled
 * category, and a chatty league (a trade flurry, a waiver run, a commissioner broadcast to
 * several leagues) could text one person dozens of times in a day.
 *
 * This caps the BULK paths (the dispatcher and World Cup notifications). It does NOT cap
 * `sendCriticalSms` — an alert someone opted into as critical must never be silently dropped
 * by a budget. Over the cap the text is skipped; the in-app notification, email and push the
 * dispatcher sends alongside it are unaffected, so nothing is lost, only not texted.
 *
 * Draft alerts use their own larger bucket because four proximity notices per pick can exhaust
 * the general budget before a draft ends. `SMS_DAILY_CAP_PER_USER` and
 * `SMS_DRAFT_DAILY_CAP_PER_USER` override the defaults. Durable (ApiRateLimitRecord), so a deploy
 * does not reset what has been spent. Fails OPEN if the counter is unavailable: a DB blip must
 * not silence notifications.
 */
import 'server-only'

import { createHash } from 'node:crypto'

import { consumeDailyLimit } from '@/lib/rate-limit-daily'

export const DEFAULT_SMS_DAILY_CAP = 15
export const DEFAULT_DRAFT_SMS_DAILY_CAP = 250

export function getSmsDailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.SMS_DAILY_CAP_PER_USER)
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_SMS_DAILY_CAP
}

export function getDraftSmsDailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.SMS_DRAFT_DAILY_CAP_PER_USER)
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_DRAFT_SMS_DAILY_CAP
}

/** Reserve one text for this recipient today. false = over the cap, skip the text. */
export async function reserveSmsToday(recipientKey: string, category?: 'draft_alerts'): Promise<boolean> {
  try {
    const result = await consumeDailyLimit({
      provider: category === 'draft_alerts' ? 'sms_draft_daily' : 'sms_daily',
      endpoint: `sms:${createHash('sha256').update(recipientKey).digest('hex').slice(0, 24)}`,
      callsLimit: category === 'draft_alerts' ? getDraftSmsDailyCap() : getSmsDailyCap(),
    })
    return result.success
  } catch (error) {
    console.error('[sms-daily-cap] counter unavailable; sending anyway', error)
    return true
  }
}
