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

The focus selector explains how to weigh weekly impact versus current asset value; it does not invent a new price grade. Full transaction-lineage attribution, actual points since completion, multi-sport weekly feeds and externally curated GIF collections remain separate enhancements.

## Verification

Regression coverage checks missing history weeks, NFL season boundaries, current-roster undo semantics, foreign identity refusal, season mismatch, league membership, completed-party restrictions, preserved original evaluations, exact numeric graph labels, player-depth suppression and reaction opt-in. Repository CI remains the deployment gate.
