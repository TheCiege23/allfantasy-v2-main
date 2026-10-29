/**
 * The seven tournament notification moments and their default channels
 * (TournamentNotifications.png). Managers can switch any channel off through
 * their notification settings; these are only the defaults per moment.
 *
 * Copy rules: push titles stay under ~40 characters, and payloads never carry a
 * secret or a provider URL — only app-relative links.
 */
import type { NotificationCategoryId } from '@/lib/notification-settings/types'

export type MomentId = 'league_revealed' | 'draft_scheduled' | 'made_the_cut' | 'eliminated' | 'wildcard_clinched' | 'on_the_bubble' | 'champion'
export type Channel = 'push' | 'inApp' | 'email' | 'leagueChat'

export type MomentContext = {
  tournament: string
  league?: string
  division?: string
  teams?: number
  draftAt?: string
  seedLine?: number
  rank?: number
  round?: string
  nextRound?: string
  line?: number
  week?: number
  opponent?: string
}

export type Moment = {
  id: MomentId
  label: string
  trigger: string
  category: NotificationCategoryId
  defaults: Record<Channel, boolean>
  title: (c: MomentContext) => string
  body: (c: MomentContext) => string
  /** League chat line, for moments posted there. */
  chat?: (c: MomentContext) => string
}

const ALL_ON = { push: true, inApp: true, email: true, leagueChat: true }
const NO_CHAT = { push: true, inApp: true, email: true, leagueChat: false }

export const MOMENTS: Moment[] = [
  {
    id: 'league_revealed', label: 'League revealed', trigger: 'Registration closes', category: 'league_announcements', defaults: ALL_ON,
    title: c => `You’re in ${c.league}`,
    body: c => `Meet your ${Math.max(0, (c.teams ?? 1) - 1)} league-mates in ${c.tournament}.${c.draftAt ? ` Your draft is ${c.draftAt}.` : ''}`,
    chat: c => `${c.league} is set: ${c.teams} teams in the ${c.division} division. One draft, no redrafts — the team you build is the team you ride.`,
  },
  {
    id: 'draft_scheduled', label: 'Draft scheduled', trigger: 'Commissioner sets the time', category: 'draft_alerts', defaults: ALL_ON,
    title: c => `Draft set · ${c.draftAt}`,
    body: c => `Your ${c.tournament} draft is set for ${c.draftAt}. Rosters carry into the bracket.`,
    chat: c => `Draft time set: ${c.draftAt}.`,
  },
  {
    id: 'made_the_cut', label: 'Made the cut', trigger: 'Seeding or a round advances', category: 'bracket_updates', defaults: NO_CHAT,
    title: c => c.nextRound ? `You’re through to the ${c.nextRound}` : `You made the bracket · #${c.seedLine} seed`,
    body: c => c.nextRound ? `You won your ${c.round} game in ${c.tournament}. Next up: the ${c.nextRound}.` : `You’re a ${c.seedLine} seed in the ${c.division} bracket. Round one starts week ${c.week}.`,
  },
  {
    id: 'eliminated', label: 'Eliminated', trigger: 'Seeding or a round advances', category: 'bracket_updates', defaults: NO_CHAT,
    title: c => c.round ? `Your run ends in the ${c.round}` : 'Your season ends here',
    body: c => c.round ? `You went out in the ${c.round} of ${c.tournament}. Follow the bracket to the championship.` : `You finished #${c.rank} in ${c.division} and missed the bracket in ${c.tournament}.`,
  },
  {
    id: 'wildcard_clinched', label: 'Wildcard clinched', trigger: 'Seeding locks', category: 'bracket_updates', defaults: ALL_ON,
    title: c => `Wildcard clinched · #${c.seedLine} seed`,
    body: c => `Your points carried you into the ${c.division} bracket as a ${c.seedLine} seed.`,
    chat: c => `Wildcard clinched in ${c.division}: a #${c.seedLine} seed from this league.`,
  },
  {
    id: 'on_the_bubble', label: 'On the bubble', trigger: 'One week before seeding', category: 'bracket_updates', defaults: { push: true, inApp: true, email: false, leagueChat: false },
    title: () => 'One week left on the bubble',
    body: c => `You’re #${c.rank} in ${c.division}. The wildcard line is ${c.line?.toFixed(1)} points — seeding locks after week ${c.week}.`,
  },
  {
    id: 'champion', label: 'Champion', trigger: 'Final whistle', category: 'bracket_updates', defaults: ALL_ON,
    title: c => `${c.tournament} champion`,
    body: c => `You won the championship${c.opponent ? ` over ${c.opponent}` : ''}. Share your title card.`,
    chat: c => `${c.tournament} has a champion from this league.`,
  },
]

export const momentById = (id: MomentId) => MOMENTS.find(m => m.id === id)!

/** Channels a dispatch should skip, from the moment's defaults. Manager settings still apply on top. */
export function skipChannelsFor(id: MomentId): { push?: boolean; email?: boolean; sms: true } {
  const d = momentById(id).defaults
  return { ...(d.push ? {} : { push: true }), ...(d.email ? {} : { email: true }), sms: true }
}
