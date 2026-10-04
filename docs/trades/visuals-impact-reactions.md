# Trade visuals, Impact now and Chimmy reactions

## Shipped behavior

- The generic analyzer shows each team's received market value. The league analyzer separates its price balance from the optimized weekly lineup and roster depth. All bars start at zero and retain numeric labels.
- Verified NFL players in the league trade builder open the shared player card. Its history chart supports lines, bars, capture weeks and season closing prices. It reads the league's FantasyCalc book, or the named universal reference book, with the existing player-depth entitlement enforced on the server.
- Missing captures remain gaps. History starts with the earliest stored price. Calendar capture weeks are explicitly distinguished from NFL scoring weeks; January and February belong to the previous NFL season. A closing price from an incomplete season is not a season average or a performance result.
- Completed trades offer **Impact now** for participants. Requests use stored references, authenticate league membership and reject pending trades. The current asset-price grade is separate from an explicit hypothetical undo against today's roster. The original grade stays visible and is never overwritten.
- If acquired players moved away or sent players returned, the hypothetical undo is withheld and the affected players are named. Other subsequent acquisitions stay on the roster. Current roster sync freshness is disclosed. Picks and FAAB are outside weekly lineup calculations; subsequent pick outcomes and transaction descendants are not undone.
- Optional device-local Chimmy reactions attach an emoji and a short phrase to each team's value grade. Completed trades get a brief looping animation. Motion stops under `prefers-reduced-motion`; reactions default off. No external GIF service, tracking request or third-party media license is introduced.

## Limits and next data work

Weekly lineup projections use persisted component statistics rescored under the league rules. They currently require NFL Sleeper/native roster identities, known starting slots, a matching projection season and projections for the traded players. Unsupported feeds are refused rather than substituted with generic PPR points. This feature does not calculate realized fantasy points earned since the trade, causal wins, championship probability or a calibrated confidence interval.

The focus selector explains how to weigh weekly impact versus current asset value; it does not invent a new price grade. Full transaction-lineage attribution, actual started points since completion, multi-sport weekly feeds and externally curated GIF collections remain separate enhancements. Cached tenure production is described below.

## Decision summaries, package costs and production receipts

- Generic and league results explain why to consider accepting, why to hesitate, and what evidence or edits could change the assessment. The deterministic summary uses the shared price grade, quote evidence, and observed weekly lineup signal. It never changes the price letter or estimates acceptance probability. Both teams can improve their lineups.
- League analysis compares active occupancy with recorded roster capacity, excluding IR/taxi occupants. New players are assumed active; IR/taxi eligibility is not guessed. Packages requiring drops retain a clearly provisional before-drops lineup graph. Retained starters displaced by the incoming package are named. Independent one-player cut scenarios show marginal weekly starter points lost, including zero and unknown values. Multiple-drop costs cannot be added; dynasty price, usable depth and execution rules are not certified by this calculation.
- Existing shortlisted counteroffers explain the price-gap change and active-slot consequences, then ask the manager to add and reanalyze the edited package. The shortlist is not a proof of the globally smallest fair change.
- Impact now includes a receipt with preserved value assessment, current quoted value, and cached tenure production. A frozen assessment's timestamp is shown; a later preservation date is not described as trade-day knowledge. Stored Sleeper outcomes match the exact provider league, transaction and authenticated participant owner. No live provider calls or expensive ledger rebuilds occur in the request.
- Production counts league-scored points generated during recorded first tenure, including bench points. Sent-player totals are their receiving teams' tenure, not a hypothetical outcome on the viewer's team. Drafted pick outcomes are displayed where stored; pending/rerouted picks remain unknown. Missing ledger data withholds aggregates. Cache age and partial seasons are visible. Negative production remains signed. Full re-trade proceeds, actual started points and causal wins remain outside this receipt.
- Focused regressions cover mismatched participant/cache identities, withheld incomplete aggregates, signed production, stale ledgers, reserve occupancy, unknown projections and roster capacity, price/lineup disagreement, original preservation and counter rationale.

Research basis: [FantasyPros trade analyzer](https://www.fantasypros.com/nfl/myplaybook/trade-analyzer.php) already offers team-impact analysis; [KeepTradeCut FAQ](https://keeptradecut-prod-linux.azurewebsites.net/frequently-asked-questions?open=liquidity) explains package adjustments for stars and depth. This build focuses on visible assumptions, usable roster consequences and separately attributed historical outcomes rather than claiming these broad categories are unique. Checked October 3, 2026.

## Verification

Regression coverage checks missing history weeks, NFL season boundaries, current-roster undo semantics, foreign identity refusal, season mismatch, league membership, completed-party restrictions, preserved original evaluations, exact numeric graph labels, player-depth suppression and reaction opt-in. Repository CI remains the deployment gate.

## English and Spanish verification

The new trade panels and older picker, finder, partner suggestions, offer strip, competitive-edge and saved-evaluation panels use the current language context to translate labels, deterministic explanations, chart titles and accessible text, evidence notices, roster consequences, receipts and optional Chimmy phrases. Language switching re-renders cached evaluations without regrading. Numbers and dates use the selected locale. Spanish draft-pick descriptions are accepted by the generic analyzer. The Chimmy prompt requests Spanish while keeping the canonical asset sentence its parser consumes.

Downloaded share cards render their embedded text in the language selected at download time. Player identities, photographs, logos and uploaded screenshots remain original; neutral chart shapes and emojis require no separate translated image.

The server-generated proposed-trade PNG accepts a bounded language field, and the completed-trade PNG reads the explicit language parameter or language-preference cookie. Both translate embedded headings and explanatory labels; manager and player identities remain original. These routes retain their authentication and league-membership checks.

See [the real completed-trade audit](completed-trade-audit-2026-10-03.md) for consistency results and the failed candidate market-estimator calibration gate. No production data was changed by that audit.

Tests exercise the real language provider through English → Spanish → English, including downloaded canvas text, cached evaluation persistence and Spanish pick parsing. Chromium fixture checks cover 390, 412, 768, 1024 and 1366-pixel layouts with expanded Spanish content and reduced motion. These checks do not certify signed-in production, Safari or native Android behavior. Older screens and arbitrary source or AI prose are not certified as fully translated by this coverage; Spanish support remains partial across the application. Production verification follows the PR's CI and deployment gates.

## Freeform explanation translation

The owner approved explanation translation after the additional data destination was disclosed. Unbundled explanatory prose in the analyzers, finder, partner evidence, saved evaluations and Impact now can use the existing `/api/i18n/translations` route's authenticated POST handler. It accepts at most 24 strings and 8,000 text characters per request, with 12 requests per minute per account. Fixed labels stay bundled locally. The handler bounds incoming bytes and rejects reserved-token input.

Names from the trade/roster context, proper names, identifiers, numbers, grades and sport abbreviations become opaque tokens before the Google request. A response with missing, duplicated or altered tokens, or additional numeric claims, is withheld. Restored prose is display-only: no original text, grades, quote values or saved evaluation records are changed. It has no shared server cache, persistence or text logging. Rendered text uses normal React escaping. A component-local bounded cache avoids repeated requests; switching language aborts outstanding display requests and rejects late responses.

Loading, automatic-translation and partial-translation statuses are visible. Provider failures retain the source text and expose a retry action. English engine prose returns exactly to its original wording when switching back to English. Spanish source notes recognized by the display hook can request English translation. This is not certification that every imported language or every application surface is translated.

The Google path uses `GOOGLE_TRANSLATE_API_KEY` and the documented [Cloud Translation Basic text endpoint](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate). Production service metadata did not list that credential during this release check. Configuration or a separately approved existing-provider alternative is required before claiming live freeform translation. Missing configuration explicitly returns an incomplete translation response.
