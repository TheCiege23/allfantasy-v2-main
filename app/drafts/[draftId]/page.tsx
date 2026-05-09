/**
 * Canonical full-screen Sleeper-style live draft route.
 *
 * Phase 2A — Commit 9: stand up the new URL without retiring legacy routes.
 *   - Resolves draftId via the existing canonical resolver.
 *   - Mock / auction / lottery delegate to existing routes (do not reimplement here).
 *   - Live snake builds the initial snapshot server-side and seeds the
 *     existing canonical client (`DraftBoard` → `DraftRoomPageClient`) to
 *     eliminate the empty-flash on first paint.
 *
 * Legacy routes (`/draft/[draftId]/snake`, `/draft/room/[draftId]`,
 * dashboard overlay iframe) remain untouched in this commit.
 */

import { getServerSession } from 'next-auth'
import { redirect, notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { resolveDraftRouteContext } from '@/lib/draft/resolve-draft-context'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { buildSessionSnapshot } from '@/lib/live-draft-engine/DraftSessionService'
import { DraftBoard } from '@/components/draft/DraftBoard'

export const dynamic = 'force-dynamic'

export default async function DraftsByIdPage({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  const { draftId } = await params

  if (!userId) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/drafts/${draftId}`)}`)
  }

  const context = await resolveDraftRouteContext(draftId, userId)
  if (!context) notFound()

  // Mock drafts ride a different engine — keep them on their existing URL family.
  if (context.kind === 'mock') {
    redirect(`/mock-draft?draftId=${encodeURIComponent(context.draftId)}`)
  }

  // Auction / lottery have their own dedicated UIs — preserve the existing routes.
  if (context.routeType === 'auction') {
    redirect(`/draft/${encodeURIComponent(context.draftId)}/auction`)
  }
  if (context.routeType === 'lottery') {
    redirect(`/draft/${encodeURIComponent(context.draftId)}/lottery`)
  }

  // Live snake — gate non-members with notFound (do not reveal existence).
  const allowed = await canAccessLeagueDraft(context.leagueId, userId)
  if (!allowed) notFound()

  const initialSnapshot = await buildSessionSnapshot(
    context.leagueId,
    new Date(),
    userId,
  )

  return (
    <div
      className={
        !context.isDynasty &&
        context.routeType === 'snake' &&
        String(context.draftType).toLowerCase() !== 'auction'
          ? 'min-h-screen bg-[radial-gradient(ellipse_100%_60%_at_50%_0%,rgba(34,211,238,0.08),transparent_50%)]'
          : 'min-h-screen'
      }
    >
      <DraftBoard
        kind="live"
        draftId={context.draftId}
        leagueId={context.leagueId}
        leagueName={context.leagueName}
        sport={context.sport}
        isDynasty={context.isDynasty}
        isCommissioner={context.isCommissioner}
        formatType={context.formatType}
        presentationVariant={
          !context.isDynasty &&
          context.routeType === 'snake' &&
          String(context.draftType).toLowerCase() !== 'auction'
            ? 'redraft_snake'
            : 'default'
        }
        initialSnapshot={initialSnapshot}
      />
    </div>
  )
}
