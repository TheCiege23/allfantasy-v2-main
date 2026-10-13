/**
 * One way to build a native league's invite link and the messages that share it.
 *
 * Before this, the three surfaces a commissioner sees right after creating a league each built the
 * link themselves: the settings Invite panel used `${origin}/join?code=`, the Draft tab hard-coded
 * `https://allfantasy.ai/join?code=…&leagueId=…` (wrong host on any preview or local server), and
 * the welcome sheet had none. `/join` resolves the code alone.
 */

type InviteRow = { token?: string | null; isActive?: boolean | null }

/**
 * The code `/join?code=` resolves for a league hosted here: `settings.inviteCode`, which create
 * writes from the league's first invite token, else the newest active invite's token.
 */
export function nativeLeagueInviteCode(settings: unknown, invites?: readonly InviteRow[] | null): string {
  const root = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const fromSettings = typeof root.inviteCode === 'string' ? root.inviteCode.trim() : ''
  if (fromSettings) return fromSettings
  const active = invites?.find((invite) => invite.isActive !== false && typeof invite.token === 'string' && invite.token.trim())
  return active?.token?.trim() ?? ''
}

function currentOrigin(): string {
  return typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://allfantasy.ai'
}

/** `${origin}/join?code=<code>`, or '' when there is no code to share. */
export function leagueJoinUrl(code: string, origin: string = currentOrigin()): string {
  const trimmed = code.trim()
  if (!trimmed) return ''
  return `${origin.replace(/\/$/, '')}/join?code=${encodeURIComponent(trimmed)}`
}

/** The sentence that goes in front of the link in a text, a WhatsApp message or the share sheet. */
export function inviteShareMessage(leagueName: string | null | undefined): string {
  const name = typeof leagueName === 'string' ? leagueName.trim() : ''
  return name ? `Join my fantasy league "${name}" on AllFantasy:` : 'Join my fantasy league on AllFantasy:'
}

/**
 * A text-message link with the invite filled in. `sms:?&body=` is the form both iOS and Android
 * Messages accept (iOS ignores the `?`, Android ignores the `&`).
 */
export function smsInviteHref(message: string, url: string): string {
  return `sms:?&body=${encodeURIComponent(`${message} ${url}`)}`
}

export function whatsAppInviteHref(message: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`
}

/** Manager seats a person has actually claimed — never placeholder slots made at create. */
export function countClaimedSeats(teams: readonly { claimedByUserId?: string | null }[] | null | undefined): number {
  return (teams ?? []).filter((team) => Boolean(team.claimedByUserId)).length
}
