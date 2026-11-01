import RedraftChatHarnessClient from './RedraftChatHarnessClient'

/**
 * DB-free render of a native redraft league's chat tab for visual review
 * (scripts/redraft-chat-visual-capture.mjs). Production is refused by app/e2e/layout.tsx. Mode comes
 * from the real `af_mode` cookie the root layout reads, like /e2e/redraft-identity.
 *
 *   /e2e/redraft-league/chat?sport=NBA[&score=0]
 *
 * The workspace chrome and the whole chat stack (LeagueChatSurface → LeagueChatPanel →
 * LeagueConversation → ChatMessageList, the real composer) are the shipped components. Only the
 * network is a fixture: the client answers the chat routes from fixture messages carrying every
 * event kind, so no request reaches a route that reads the database.
 */
export default async function RedraftChatHarnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  return <RedraftChatHarnessClient sport={sp.sport ?? 'NFL'} withScore={sp.score !== '0'} />
}
