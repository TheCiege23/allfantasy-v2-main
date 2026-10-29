/**
 * The eight Survivor notifications (survivor-core handoff §5, SurvivorNotifications): push copy,
 * the email layout and the trigger for each. Pure; the queue in ./notificationEngine sends them
 * through the shared dispatcher, so in-app, email and push each follow the recipient's own
 * notification settings. There is no second notification system.
 *
 * Never in any copy: who voted for whom, another manager's idols, or a vote tally before the reveal.
 * The idol email never names the idol. Copy only ever names the recipient themselves, except the
 * champion, which goes out after the final reveal has made it public.
 */
import { survivorBackgroundSrc, type SurvivorMood } from './survivorMood'

export const SURVIVOR_NOTIFICATION_KINDS = [
  'votes_close_soon',
  'immunity_won',
  'idol_found',
  'torch_out',
  'tribe_swap',
  'back_from_exile',
  'jury_vote_open',
  'season_champion',
] as const
export type SurvivorNotificationKind = (typeof SURVIVOR_NOTIFICATION_KINDS)[number]

export function isSurvivorNotificationKind(value: unknown): value is SurvivorNotificationKind {
  return typeof value === 'string' && (SURVIVOR_NOTIFICATION_KINDS as readonly string[]).includes(value)
}

export interface SurvivorNotificationSpec {
  trigger: string
  channels: string
  urgency: 'critical' | 'high' | 'medium'
  mood: SurvivorMood
  heroPath: string
  kicker: string
  cta: string
  /** Deep link inside the league. */
  path: (leagueId: string) => string
}

const base = (leagueId: string) => `/survivor/${encodeURIComponent(leagueId)}`

export const SURVIVOR_NOTIFICATION_SPECS: Record<SurvivorNotificationKind, SurvivorNotificationSpec> = {
  votes_close_soon: { trigger: '2h before the deadline, only if the manager has not voted', channels: 'Push, email', urgency: 'high', mood: 'dusk', heroPath: '/survivor/weekly/urn.svg', kicker: 'Tribal Council', cta: 'Cast your vote', path: l => `${base(l)}/tribal` },
  immunity_won: { trigger: 'Immunity winner set', channels: 'Push, email, chat', urgency: 'high', mood: 'dusk', heroPath: '/survivor/weekly/immunity-necklace.svg', kicker: 'Immunity', cta: 'See the tribe race', path: l => base(l) },
  idol_found: { trigger: 'Draft complete and the manager holds an idol', channels: 'Push, email, DM', urgency: 'high', mood: 'night', heroPath: '/survivor/exile/scroll-sealed.svg', kicker: 'Hidden idol', cta: 'Open your vault', path: l => `${base(l)}/chimmy` },
  torch_out: { trigger: 'Voted out and the scroll has been revealed', channels: 'Push, email', urgency: 'high', mood: 'night', heroPath: '/survivor/weekly/torch-out.svg', kicker: 'Tribal Council', cta: 'See what is next', path: l => base(l) },
  tribe_swap: { trigger: '24h before swapAt', channels: 'Push, email', urgency: 'medium', mood: 'day', heroPath: '/survivor/late/buff-merge.svg', kicker: 'Tribe swap', cta: 'Open the island', path: l => `${base(l)}/swap` },
  back_from_exile: { trigger: 'Tokens reach returnTokens', channels: 'Push, email, chat', urgency: 'high', mood: 'exile', heroPath: '/survivor/exile/token-coin-earned.svg', kicker: 'Exile Island', cta: 'Back to the island', path: l => base(l) },
  jury_vote_open: { trigger: 'Final week, recipient is a juror', channels: 'Push, email', urgency: 'critical', mood: 'dusk', heroPath: '/survivor/late/jury-bench.svg', kicker: 'Final Tribal Council', cta: 'Cast your jury vote', path: l => `${base(l)}/jury` },
  season_champion: { trigger: 'Final reveal complete', channels: 'All members', urgency: 'high', mood: 'day', heroPath: '/survivor/late/champion-trophy.svg', kicker: 'Season champion', cta: 'See the season story', path: l => `${base(l)}/story` },
}

export interface SurvivorNotificationCopy { title: string; body: string }

export type SurvivorNotificationInput =
  | { kind: 'votes_close_soon' }
  | { kind: 'immunity_won'; week: number }
  | { kind: 'idol_found' }
  | { kind: 'torch_out'; week: number; next: 'exile' | 'jury' | null }
  | { kind: 'tribe_swap' }
  | { kind: 'back_from_exile' }
  | { kind: 'jury_vote_open' }
  | { kind: 'season_champion'; championName: string; leagueName: string }

/** Push / in-app copy. Every string here is safe to show on a lock screen. */
export function survivorNotificationCopy(input: SurvivorNotificationInput): SurvivorNotificationCopy {
  switch (input.kind) {
    case 'votes_close_soon':
      return { title: 'Votes close in 2 hours', body: 'You have not voted at Tribal Council yet. Your vote stays private until the reveal.' }
    case 'immunity_won':
      return { title: 'You won immunity', body: `Top score in week ${input.week}. Votes against you won't count at Tribal Council.` }
    case 'idol_found':
      return { title: 'You found an idol', body: 'An idol is hidden on your roster. Open your vault to see it, and keep it to yourself.' }
    case 'torch_out':
      return {
        title: 'Your torch is out',
        body: `The tribe voted you out in week ${input.week}.${input.next === 'exile' ? ' Exile Island is open: earn tokens for a way back.' : input.next === 'jury' ? ' You take a seat on the jury.' : ''}`,
      }
    case 'tribe_swap':
      return { title: 'A tribe swap is coming', body: 'The buffs come off when the next lineups lock, and the new tribes are revealed then.' }
    case 'back_from_exile':
      return { title: "You're back from Exile", body: 'You earned enough tokens to return to the island. Your torch is lit again.' }
    case 'jury_vote_open':
      return { title: 'Jury vote is open', body: "You're on the jury. Pick the champion from the finalists before the deadline." }
    case 'season_champion':
      return { title: `${input.championName.trim() || 'Your league'} is the season champion`, body: `The jury has spoken in ${input.leagueName.trim() || 'your Survivor league'}.` }
  }
}

export function escapeEmailHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * The 600px email: mood banner with the hero art, kicker, Cinzel headline, one paragraph, one
 * button and a link to notification settings. Built only from the stored push title/body (already
 * spoiler-safe) plus fixed per-kind art, so the email can never say more than the push.
 */
export function renderSurvivorNotificationEmail(kind: SurvivorNotificationKind, input: { title: string; body: string; leagueId: string; leagueName: string; sport: string | null; baseUrl: string }): { subject: string; html: string } {
  const spec = SURVIVOR_NOTIFICATION_SPECS[kind]
  const root = input.baseUrl.replace(/\/$/, '')
  const href = `${root}${spec.path(input.leagueId)}`
  const settings = `${root}/settings?tab=notifications`
  const bg = `${root}${survivorBackgroundSrc(spec.mood, input.sport)}`
  const hero = `${root}${spec.heroPath}`
  const e = escapeEmailHtml
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#07080d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07080d"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#0b0d14;border:1px solid #1e2333;border-radius:14px;overflow:hidden;font-family:Archivo,Helvetica,Arial,sans-serif;color:#e8eaf2">
<tr><td style="background:#1a1630 url('${e(bg)}') center/cover no-repeat;height:220px;text-align:center;vertical-align:middle"><img src="${e(hero)}" alt="" width="150" height="150" style="display:inline-block;width:150px;height:150px"/></td></tr>
<tr><td style="padding:28px 32px 8px">
<div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#f2c94c">${e(spec.kicker)} · ${e(input.leagueName)}</div>
<h1 style="margin:10px 0 0;font-family:Cinzel,Georgia,serif;font-size:30px;line-height:1.15;color:#f3ead6">${e(input.title)}</h1>
<p style="margin:14px 0 0;font-size:16px;line-height:1.5;color:#d6d9e6">${e(input.body)}</p>
</td></tr>
<tr><td style="padding:20px 32px 28px"><a href="${e(href)}" style="display:inline-block;padding:14px 26px;border-radius:9px;background:#d9b45a;color:#1d1406;font-weight:700;font-size:15px;text-decoration:none">${e(spec.cta)}</a></td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #1e2333;font-size:12px;color:#8d93ad">AllFantasy Survivor · <a href="${e(settings)}" style="color:#a3a9c2">Notification settings</a></td></tr>
</table></td></tr></table></body></html>`
  return { subject: input.title, html }
}
