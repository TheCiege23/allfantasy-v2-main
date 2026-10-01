/** The invitation always joins the league first; focus only chooses the first screen after joining. */
export type LeagueInviteFocus = 'league' | 'rivalry' | 'chat'

export function readLeagueInviteFocus(value: string | null | undefined): LeagueInviteFocus {
  return value === 'rivalry' || value === 'chat' ? value : 'league'
}

export function inviteLinkForFocus(link: string, focus: LeagueInviteFocus): string {
  const url = new URL(link)
  if (focus === 'league') url.searchParams.delete('focus')
  else url.searchParams.set('focus', focus)
  return url.toString()
}

export function joinedLeagueDestination(leagueId: string, focus: LeagueInviteFocus): string {
  const encoded = encodeURIComponent(leagueId)
  if (focus === 'rivalry') return `/core/week?league=${encoded}&view=rivalries`
  if (focus === 'chat') return `/league/${encoded}?tab=league_chat`
  return `/league/${encoded}`
}
