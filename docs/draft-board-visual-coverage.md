# Draft board visual coverage

Batch 1 consolidates the active live and mock board presentation around
`components/app/draft-room/DraftBoard.tsx` and `DraftBoardCell.tsx`.
The reference is the supplied v3 NFL/NBA screenshots: flat 50px tiles, filled
position colors, stacked player names, and slate controls. The older square-tile
proposal was superseded by that design.

| Surface | Renderer |
| --- | --- |
| `/drafts/[draftId]`, live snake/linear, every sport and league format | Canonical DraftBoard through DraftRoomPageClient |
| `/draft/[draftId]/auction` | Same canonical board, grouped by purchasing roster |
| `/draft/live/*` and live `/draft/room/*` | Canonical route redirects |
| `/mock-draft`, open or league mock, desktop and phone | DraftBoardPreview adapter into canonical DraftBoard |
| `/draft/mock/[draftId]`, including completed results | DraftBoardPreview adapter |
| Stored mock sessions through `/draft/room/*`, `/draft/[draftId]/snake`, and MockDraftSimulatorWrapper | DraftBoardPreview adapter plus existing session controls and recent picks |
| `/af-legacy` mock tab, desktop and phone | DraftBoardPreview adapter; canonical snake/linear/3RR slot calculation |
| Draft HQ stored board | Shared DraftBoardCell; keeps projection and traded-owner annotations |
| Season history board | Shared DraftBoardCell; displays stored provider IDs without deriving unsupported headshots |
| Lottery | Order selection, then the canonical live room; no separate player-pick board |

The stored history endpoint does not provide player names, positions, or sport
qualified image identities for imported picks. Its tiles therefore remain neutral
and show the IDs actually stored. Columns represent pick order within the round;
they do not claim a fixed manager identity without the original order metadata.

`components/app/draft/LeagueDraftBoard.tsx`, `components/draft/live/DraftBoard.tsx`,
and `app/af-legacy/components/mock-draft/MockDraftBoard.tsx` have no active imports
in the route inventory. They do not serve the current live or mock rooms.

## Verification

- Component regressions cover all seven sports, snake, linear, 3RR, auction,
  empty traded picks, persisted mock recovery, the older mock route and stored history.
- `e2e/draft-board-coverage.spec.ts` exercises the real shared components at
  390px, 1024px and 1580px, including a 360px dock with all seven tabs.
- The existing production mock browser suite covers manual picks, queue ordering,
  pause/resume, reload recovery and elapsed-time autopick.
- The new harness lives below `/e2e`, whose layout returns 404 in production.
