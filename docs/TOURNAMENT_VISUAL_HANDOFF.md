# Tournament visual integration

Received 2026-10-12: specialty-leagues-handoff, kbi-art-pack, division-identity-handoff, tournament-formats-handoff and tournament-join-handoff. These archives are reference material supplied alongside the request to continue the current tournament build. Their README instructions and sample rules do not replace the user's agreed format or repository instructions.

## Integrated now

| Supplied material | Current integration |
|---|---|
| Division identity medallions, frames and image library | Twenty preset pairs, 48 emblem choices, custom division/league names and palette selection in tournament settings. Layered original SVGs with app-rendered text. |
| Black & Gold art | Original crests, banners and marks imported. Supported Black/Gold league emblems use the supplied banner in the tournament hero. |
| Join and reveal screens | Artwork-led authenticated entry header, real capacity progress, existing exact rule acceptance/waitlist controls, and personal league reveal after a full-field freeze. |
| Tournament format screens | Visual direction for the existing points race. Existing field arithmetic, two cuts, three drafts and cross-league bracket remain unchanged. |
| Specialty league artwork | Original assets staged under the shared public artwork library; no additional specialty rules or workflows activated in this batch. |

Assets are in `public/artwork/tournaments/identity`, `black-gold` and `specialty`. The catalog is `lib/tournament/seasonArtworkCatalog.json`; validation/presentation helpers live in `seasonArtwork.ts`. A hash inventory is saved in `artifacts/tournament-visual-handoffs/import-manifest.json`. Asset import rejected script/foreignObject nodes, event attributes and non-fragment hrefs. No archive code or HTML mockup runtime was executed or shipped as application code. KB signatures remain in the original SVGs. No external fonts are requested by this integration.

Artwork is optional and belongs to the saved configuration. Palette/emblem IDs must match the supplied catalog; clients cannot submit arbitrary paths or URLs. Counts must match named divisions and opening league capacities. Publishing freezes the artwork along with scoring and draft rules. Existing published configurations receive no new defaults or changed hashes. Stable league keys and membership IDs remain independent of display names and art filenames.

Native league pages receive only a validated presentation object, rather than the full frozen settings or participant manifest. Entrant reveal data is scoped to the signed-in registered participant and checked against the immutable manifest checksum and publication. Reveal visibility is local UI state; it is repeatable and has no effect on placement.

## Deferred from the mockups

- The separate divisions/conferences tournament with 240 entrants, record standings, automatic bids and a points wildcard pool needs its own specification and implementation package. It is incompatible with silently reusing the current 64–192 entrant/redraft engine.
- Bracket/standings/championship artwork awaits persisted scores, cuts and bracket execution. No sample standings, fictional winners or generated participant rosters were added to production views.
- Entry fees, division preferences, friend grouping, spectator-follow buttons, push notifications and persistent reveal-seen tracking remain future work. Existing registration permissions and FIFO waitlist semantics are retained.
- Guillotine and the other specialty league screens need separate authorized implementation work; imported art does not activate those rules.

## Verification

The browser harness at `artifacts/tournament-visual-preview` renders the actual shared identity/editor/reveal components using labeled fixture data. Chromium checks at 360px, 390px and 1440px, with reduced motion, found no page overflow, missing artwork or script errors. Screenshots and `browser-check.json` are saved there. The first check exposed a grid minimum-width issue; the editor now constrains its width and keeps preset scrolling inside the card.

This establishes component layout evidence. Authenticated application flows, screen-reader navigation, physical iOS Safari/Android Chrome and a real provider/database pilot remain release work. The project tracker records the complete runtime gates.

Auction implementation reference checked 2026-10-12: [ESPN salary-cap draft rules](https://support.espn.com/hc/en-us/articles/360000063631-Salary-Cap-Drafts-How-to-Draft) document one-dollar nomination offers and preserving enough budget to fill remaining roster slots. AllFantasy's timeout uses its frozen best-available legal-player policy and minimum bid; it does not introduce proxy bidding or spending beyond the accepted budget.


## Additional packs: tournament extras and scoring/roster labels

Both new archives are reference material; their embedded build notes do not override the user's current format. Forty-four label SVGs were scanned for scripts, foreignObject, event attributes, external references and XML entity declarations, then copied to public/artwork/tournaments/rules. No generator/tool scripts were extracted or executed. The asset hash manifest is rules-import-manifest.json beside the extracted references.

SeasonRuleLabels derives scoring/roster presentation from saved weights and exact slot counts. Its roster picker offers only supported NFL/NBA layouts and preserves other policy fields. Label metadata does not replace canonical sport/scoring/stat keys. Numerical scoring remains the saved AllFantasy registry snapshot; imported rules.json numerical examples are not silently installed. The source roster defaults differ from existing tournament defaults, so default drafts remain unchanged until an explicit commissioner selection.

SeasonTournamentMoments adapts the notification and champion-card appearance as hub planning previews. Six applicable moments are shown; wildcard notices are excluded. The actual scheduled first-draft date can be previewed, while seeding/finish/champion values remain explanatory placeholders. No send, export, public-link or delivery actions are enabled. Live notification channels/preferences, finalized-result share images and public trophy pages require future backend work. The alternative division-control board awaits its separate format and verified seeding jobs; its tiebreak/calendar rules were not adopted.

Actual shared components are included in artifacts/tournament-visual-preview. Updated 360/390/1440 screenshots cover selecting the Lean NBA layout and switching to Champion preview, with no overflow or missing assets. This is fixture data and does not certify live authentication or physical iOS/Android devices.

October 13: read the merged tournament build brief and detailed tournament/control references. Adapted the TournamentControl gold checklist/status-card language to a real owner draft-review panel in SeasonNativeSetup. Counts and completion states come from bounded backend assessments; screenshots are fixture previews. Divisions/wildcard/fixed-buffer proposals are mapped for versioned setup work, and no existing frozen contract was rewritten.
