/**
 * Texts people send BACK to AllFantasy's number (owner's call 2026-11-15: "start on texting").
 *
 * Until now nothing received them. The app learned someone had texted STOP only when its next text
 * failed with Twilio error 21610, START never turned texts back on, and any other reply vanished.
 * `app/api/webhooks/twilio/sms` receives them now; this file holds the decisions, with no I/O.
 *
 * ⚠ TWILIO ANSWERS THE KEYWORDS ITSELF. With Twilio's opt-out handling (on by default for US numbers,
 * and what the A2P campaign registered), STOP / START / HELP get Twilio's own reply and Twilio blocks or
 * unblocks the number. The webhook still receives the message, so our job there is only to bring OUR
 * records in line: we never send a second reply to a keyword. Only an ordinary reply gets an answer
 * from us, and only a few a day per number, so two auto-responders can never text each other forever.
 *
 * Pure: imported by the webhook and the tests.
 */

export type InboundSmsKind = 'stop' | 'start' | 'help' | 'reply'

/** Twilio's standard opt-out words, plus the two CTIA added in 2025. Matched as the WHOLE message. */
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'STOP ALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT', 'REVOKE'])
const START_WORDS = new Set(['START', 'YES', 'UNSTOP'])
const HELP_WORDS = new Set(['HELP', 'INFO'])

/**
 * What a message is. Twilio's own verdict (`OptOutType`, sent when its opt-out handling acted) wins;
 * otherwise the whole message, trimmed and case-folded, is compared with the keyword lists — the way
 * Twilio matches them, so "Stop." opts out and "stop texting me about waivers" is an ordinary reply.
 */
export function classifyInboundSms(body: string | null | undefined, optOutType?: string | null): InboundSmsKind {
  const verdict = (optOutType ?? '').trim().toUpperCase()
  if (verdict === 'STOP') return 'stop'
  if (verdict === 'START') return 'start'
  if (verdict === 'HELP') return 'help'
  const word = (body ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (STOP_WORDS.has(word)) return 'stop'
  if (START_WORDS.has(word)) return 'start'
  if (HELP_WORDS.has(word)) return 'help'
  return 'reply'
}

/** How many of our answers one number can get in a UTC day. Three is a conversation; more is a loop. */
export const INBOUND_REPLIES_PER_DAY = 3

/** The longest question carried into Chimmy's box. A text is short; this keeps the link short too. */
export const CHIMMY_PROMPT_MAX = 120

/**
 * The answer to a member's ordinary text: a link that opens Chimmy with what they wrote already typed,
 * one tap from an answer. Nobody reads this number, and the reply says so rather than pretending.
 * `sendSms`-style branding and the STOP line are added by the webhook (formatProgramSms).
 */
export function memberReplyText(baseUrl: string, body: string): string {
  const prompt = body.trim().replace(/\s+/g, ' ').slice(0, CHIMMY_PROMPT_MAX)
  const link = prompt
    ? `${baseUrl}/chimmy/chat?${new URLSearchParams({ prompt }).toString()}`
    : `${baseUrl}/chimmy/chat`
  return `This number only sends alerts, so a person won't see your text. Chimmy can answer it in the app: ${link}`
}

/** The answer to a number that is not on any account. */
export function strangerReplyText(baseUrl: string): string {
  return `This number sends league alerts to AllFantasy members and can't read replies. Questions: ${baseUrl}/contact`
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** The TwiML Twilio expects back. No message = an empty `<Response/>`, which sends nothing. */
export function twimlResponse(message: string | null): string {
  const inner = message ? `<Message>${escapeXml(message)}</Message>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`
}

/**
 * The addresses Twilio may have signed. Twilio signs the exact URL configured in its console, while the
 * app runs behind Cloudflare and Railway and sees its own internal address — so the public address is
 * rebuilt from the forwarded host. `TWILIO_INBOUND_WEBHOOK_URL`, when set, is the configured URL itself
 * and is tried first. Each is tried; a request passes only if one of them verifies.
 */
export function signedUrlCandidates(args: {
  configured?: string | null
  forwardedHost?: string | null
  host?: string | null
  forwardedProto?: string | null
  appBaseUrl?: string | null
  pathAndQuery: string
}): string[] {
  const out: string[] = []
  const add = (u: string | null | undefined) => {
    const v = u?.trim()
    if (v && !out.includes(v)) out.push(v)
  }
  add(args.configured)
  const proto = (args.forwardedProto?.split(',')[0]?.trim() || 'https').toLowerCase()
  const fwd = args.forwardedHost?.split(',')[0]?.trim()
  if (fwd) add(`${proto}://${fwd}${args.pathAndQuery}`)
  if (args.host) add(`https://${args.host.trim()}${args.pathAndQuery}`)
  if (args.appBaseUrl) add(`${args.appBaseUrl.replace(/\/$/, '')}${args.pathAndQuery}`)
  return out
}
