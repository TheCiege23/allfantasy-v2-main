/**
 * A thrown Error the chat sheets can show as it is: the server's words when it
 * gave any. Shared by ThreadPanel (DMs, huddles) and LeagueConversation (league
 * chat) so Report and Block fail the same way everywhere.
 */
export async function chatFailure(res: Response, prefix: string, fallback: string): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown }
  const said = typeof data.error === 'string' && data.error.trim() ? data.error.trim() : null
  return new Error(said ? `${prefix}: ${said.replace(/\.$/, '')}.` : fallback)
}
