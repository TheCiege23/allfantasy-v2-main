import 'server-only'

import { createHash } from 'node:crypto'

import { prisma } from '@/lib/prisma'
import { normalizePhoneE164 } from '@/lib/phone/e164'
import { consumeDailyLimit } from '@/lib/rate-limit-daily'
import { formatProgramSms } from '@/lib/legal/smsProgram'
import { restoreSmsConsentAfterStart } from '@/lib/sms/smsConsent'
import { recordSmsOptOut } from '@/lib/sms/smsOptOut'
import {
  INBOUND_REPLIES_PER_DAY,
  classifyInboundSms,
  memberReplyText,
  strangerReplyText,
  type InboundSmsKind,
} from '@/lib/sms/inboundSms'

/**
 * What happens when someone texts AllFantasy's number (see lib/sms/inboundSms.ts for the why):
 *   STOP  → their SMS consent is withdrawn now, not at the next failed send;
 *   START → a consent they withdrew by texting STOP comes back;
 *   HELP  → nothing of ours; Twilio's own HELP reply answers it;
 *   other → a member gets a link that opens Chimmy with their text already typed; a stranger is told
 *           the number cannot read replies. At most a few of these per number per day.
 *
 * Never stores what they wrote. A row in `AnalyticsEvent` counts that a text came in and what kind.
 */
export type InboundSmsResult = { kind: InboundSmsKind; reply: string | null; knownUser: boolean }

type Deps = {
  db: typeof prisma
  now?: Date
  baseUrl: string
  allowReply?: (phone: string) => Promise<boolean>
}

async function defaultAllowReply(phone: string): Promise<boolean> {
  try {
    const r = await consumeDailyLimit({
      provider: 'sms_inbound_reply',
      endpoint: `sms:${createHash('sha256').update(phone).digest('hex').slice(0, 24)}`,
      callsLimit: INBOUND_REPLIES_PER_DAY,
    })
    return r.success
  } catch {
    // Fail CLOSED here, unlike the outbound cap: a missed courtesy reply costs nothing, a reply loop does.
    return false
  }
}

export async function handleInboundSms(
  msg: { from: string; body: string; optOutType?: string | null },
  deps: Deps,
): Promise<InboundSmsResult> {
  const now = deps.now ?? new Date()
  const phone = normalizePhoneE164(msg.from)
  const kind = classifyInboundSms(msg.body, msg.optOutType)
  if (!phone) return { kind, reply: null, knownUser: false }

  const profiles: Array<{ userId: string; notificationPreferences: unknown }> = await (deps.db as any).userProfile
    .findMany({ where: { phone }, select: { userId: true, notificationPreferences: true } })
    .catch(() => [])
  const knownUser = profiles.length > 0
  let reply: string | null = null

  if (kind === 'stop') {
    await recordSmsOptOut(phone, 'sms_stop')
  } else if (kind === 'start') {
    for (const p of profiles) {
      const restored = restoreSmsConsentAfterStart(p.notificationPreferences, phone, now)
      if (!restored) continue
      await (deps.db as any).userProfile
        .update({ where: { userId: p.userId }, data: { notificationPreferences: restored } })
        .catch((err: unknown) => console.error('[sms-inbound] could not restore consent', err instanceof Error ? err.message : 'unknown'))
    }
  } else if (kind === 'reply') {
    const allowed = await (deps.allowReply ?? defaultAllowReply)(phone)
    if (allowed) reply = formatProgramSms(knownUser ? memberReplyText(deps.baseUrl, msg.body) : strangerReplyText(deps.baseUrl))
  }

  await (deps.db as any).analyticsEvent
    .create({
      data: {
        event: 'sms.inbound_received',
        userId: profiles[0]?.userId ?? null,
        meta: { kind, knownUser, replied: reply != null },
      },
    })
    .catch(() => undefined)

  return { kind, reply, knownUser }
}
