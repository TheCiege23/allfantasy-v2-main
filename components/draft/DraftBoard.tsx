import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import { DraftRoomPageClient } from '@/components/app/draft-room/DraftRoomPageClient'
import { MockDraftSessionBoard } from '@/components/mock-draft/MockDraftSessionBoard'

type LiveDraftBoardProps = {
  kind: 'live'
  draftId: string
  leagueId: string
  leagueName: string
  sport: string
  isDynasty: boolean
  isCommissioner: boolean
  formatType?: string
  /** Snake redraft live room — enables premium chrome from `/draft/[id]/snake`. */
  presentationVariant?: 'default' | 'redraft_snake'
  /**
   * Server-rendered snapshot (built via `buildSessionSnapshot` on the route)
   * used to seed the client's first paint. Omit on legacy routes that fetch
   * client-side.
   */
  initialSnapshot?: DraftSessionSnapshot | null
}

type MockDraftBoardProps = {
  kind: 'mock'
  draftId: string
  canManage?: boolean
}

type DraftBoardProps = LiveDraftBoardProps | MockDraftBoardProps

export function DraftBoard(props: DraftBoardProps) {
  if (props.kind === 'mock') {
    return <MockDraftSessionBoard draftId={props.draftId} canManage={props.canManage} />
  }

  return (
    <DraftRoomPageClient
      draftId={props.draftId}
      leagueId={props.leagueId}
      leagueName={props.leagueName}
      sport={props.sport}
      isDynasty={props.isDynasty}
      isCommissioner={props.isCommissioner}
      formatType={props.formatType}
      presentationVariant={props.presentationVariant ?? 'default'}
      initialSnapshot={props.initialSnapshot ?? null}
    />
  )
}
