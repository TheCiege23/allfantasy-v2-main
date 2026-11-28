/**
 * Redraft snake draft room, Sleeper pass 5 (owner, 2026-11-28: "start with snake for redraft … each draft has its
 * own functions so we have to be very specific"). The simple room is a plain REDRAFT league's snake / linear room
 * only; keeper, best ball, dynasty, devy, auction and specialty rooms keep everything they had.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8')
const pc = read('components/app/draft-room/DraftRoomPageClient.tsx')
const tb = read('components/app/draft-room/DraftTopBar.tsx')
const shell = read('components/app/draft-room/DraftRoomShell.tsx')
const panel = read('components/app/draft-room/PlayerPanel.tsx')

describe('which rooms are simple', () => {
  it('a redraft league\'s snake (or linear) room, read from the league itself', () => {
    expect(pc).toContain("const simpleRoom = presentationVariant === 'redraft_snake' && !isDynasty && String(leagueType ?? '').trim().toLowerCase() === 'redraft'")
    // The route gives every non-dynasty, non-auction snake/linear room `redraft_snake`; the leagueType check narrows it.
    expect(read('app/drafts/[draftId]/page.tsx')).toContain('leagueType={context.leagueType}')
  })
})

describe('what the simple room changes', () => {
  it('top bar: no AI pick chip; music and the settings gear move into the "…" menu', () => {
    expect(pc).toContain('aiRecommendationOverlay={showAiOverlays && !simpleRoom ? recommendationOverlaySummary : null}')
    expect(pc).toContain('extraMenuItems={simpleRoom ? simpleRoomMenuItems : undefined}')
    expect(pc).toMatch(/id: 'draft-settings', label: 'Draft settings'[\s\S]*?id: 'music',[\s\S]*?tab: 'music'/)
    expect(tb).toContain('{simpleRoom ? null : controlsSlot}')
    expect(tb).toContain('{onOpenDraftRoomSettings && !simpleRoom ? (')
  })

  it('player cards: no Compare; the Table/Card switch and Chimmy toggles leave the phone Filters', () => {
    expect(panel).toContain('compareAction={simpleRoom ? undefined :')
    expect(panel).toContain("className={`${simpleRoom ? 'max-md:hidden ' : ''}ml-auto inline-flex")
    expect(panel).toContain('{hasAiOverlaySignals && !simpleRoom ? (')
  })

  it('phone tray: no Chat tab, and the chat bubble is mounted (the draft room never had one)', () => {
    expect(shell).toContain("(tab.id !== 'chat' || !hidePhoneChatTab)")
    expect(pc).toContain('hidePhoneChatTab={simpleRoom}')
    expect(pc).toMatch(/\{simpleRoom && leagueId \? \(\n\s*<div className="md:hidden" data-testid="draft-room-chat-bubble">\n\s*<CommsDock/)
  })

  it('Chimmy tab: the next-pick card, Ask Chimmy, the overlays switch, and everything else under "More from Chimmy"', () => {
    const node = pc.slice(pc.indexOf('const simpleChimmyTabNode = ('), pc.indexOf('const chimmyTabNode = ('))
    expect(node).toContain('{intelPanelNode}')
    expect(node).toContain('data-testid="draft-chimmy-ask"')
    expect(node).toContain('data-testid="draft-chimmy-overlays-toggle"')
    expect(node).toMatch(/More from Chimmy[\s\S]*\{draftIntelSuggestionsNode\}[\s\S]*\{helperPanelNode\}[\s\S]*<DraftTeamPanel/)
  })
})
