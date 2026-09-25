import { prisma } from '@/lib/prisma'

/**
 * WHO MAY WRITE OR READ A PRIVATE CHAT ATTACHMENT — one rule, two upload routes.
 *
 * 🛑 THIS LIVED INSIDE `app/api/chat/upload/route.ts` AND ONLY THE DRAWER USED IT.
 * `/api/shared/chat/upload` (the /messages composer) wrote to PUBLIC Blob storage and
 * checked no membership at all, so a photo posted in a DM or a league room was readable
 * by anyone holding the link. Both routes now import these functions; neither holds its
 * own copy. Two copies of a membership rule is how one of them drifts open.
 *
 * Server-only (prisma). Deliberately NOT re-exported from `lib/chat-core/index.ts`, which
 * client components import.
 */

/**
 * Membership of a platform chat thread — the DM and huddle equivalent of
 * `canAccessLeague`.
 *
 * ⚠ WITHOUT THIS, UPLOADS WERE LEAGUE-ONLY. The route required a `leagueId` and
 * 400'd without one, so attaching an image in a DM or a huddle failed with
 * "leagueId required" — a message about a concept those chats do not have. The
 * gate is the same shape as the league one: prove the caller is IN the thread,
 * never just that the thread exists.
 */
export async function canAccessThread(threadId: string, userId: string) {
  const member = await prisma.platformChatThreadMember.findFirst({
    where: { threadId, userId, isBlocked: false },
    select: { id: true },
  })
  return Boolean(member)
}

export async function canAccessLeague(leagueId: string, userId: string) {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      id: true,
      userId: true,
      teams: { select: { claimedByUserId: true } },
    },
  })
  if (!league) return false
  if (league.userId === userId) return true
  return league.teams.some((team) => team.claimedByUserId === userId)
}

/**
 * Membership of a bracket league — the `league:<bracketLeagueId>` room /messages lists for
 * every bracket pool the user belongs to. Same test the room's own POST applies before it
 * accepts a message (`bracketLeagueMember` by league and user), so exactly the people who
 * can read the room can open its photos.
 */
export async function canAccessBracketLeague(leagueId: string, userId: string) {
  const member = await prisma.bracketLeagueMember.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
    select: { id: true },
  })
  return Boolean(member)
}

/** Which chat a private attachment belongs to. Decides both its storage prefix and its reader check. */
export type ChatUploadScope =
  | { kind: 'league'; id: string }
  | { kind: 'thread'; id: string }
  | { kind: 'bracket'; id: string }

export type ChatUploadMedia = 'image' | 'video' | 'voice' | 'file'

/** Ids that can appear in a stored path. Anything else cannot be served back, so it is refused up front. */
export const CHAT_UPLOAD_SCOPE_ID = /^[a-zA-Z0-9_-]+$/

export function chatUploadPrefix(scope: ChatUploadScope): string {
  if (scope.kind === 'thread') return `chat/thread/${scope.id}`
  if (scope.kind === 'bracket') return `chat/bracket/${scope.id}`
  return `chat/${scope.id}`
}

/**
 * The only URL a private attachment is ever handed out as: the authenticated reader in
 * `app/api/chat/upload/route.ts`, never the storage object's own URL.
 */
export function chatUploadReadUrl(pathname: string): string {
  return `/api/chat/upload?path=${encodeURIComponent(pathname)}`
}

const READ_PATH = /^chat\/(?:(thread|bracket)\/)?([a-zA-Z0-9_-]+)\/(image|video|voice|file)\/([a-zA-Z0-9_.-]+)$/

/** Parse a stored attachment path back into the chat it belongs to. `null` for anything malformed. */
export function parseChatUploadPath(path: string): { scope: ChatUploadScope; media: ChatUploadMedia } | null {
  if (!path || path.includes('..')) return null
  const match = READ_PATH.exec(path)
  if (!match) return null
  const kind = match[1] === 'thread' ? 'thread' : match[1] === 'bracket' ? 'bracket' : 'league'
  return { scope: { kind, id: match[2] }, media: match[3] as ChatUploadMedia }
}

/** Is `userId` a member of the chat this attachment belongs to — checked at read time, every time. */
export async function canAccessChatUploadScope(scope: ChatUploadScope, userId: string): Promise<boolean> {
  if (scope.kind === 'thread') return canAccessThread(scope.id, userId)
  if (scope.kind === 'bracket') return canAccessBracketLeague(scope.id, userId)
  return canAccessLeague(scope.id, userId)
}
