/**
 * The chop announcement's words. Pure, so the commissioner's chop preview shows exactly what
 * ./guillotineChat.ts will post.
 */
export function chopAnnouncementText(weekOrPeriod: number, names: readonly string[]): string {
  const list = names.join(', ')
  return names.length > 1
    ? `Week ${weekOrPeriod} — Chopped: ${list}. Their rosters have been released to waivers.`
    : `Week ${weekOrPeriod} — ${list} has been chopped. Their roster has been released to waivers.`
}
