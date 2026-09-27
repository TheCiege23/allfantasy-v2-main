# Testing Chimmy from My team

Open https://www.allfantasy.ai/core/my-team using your usual account. Select one league, refresh its lineup, and note the displayed week, scoring rules, injuries and missing-data notices before testing. Use the latest answer after clicking Send; older conversation answers can describe older data.

## 1. Verify the action and league scope

Click that league's **Ask Chimmy** action. The drawer should open with the matching league selected and an unsent question. Nothing should be submitted until you click **Send to Chimmy**. If a draft is already present, keep or replace it deliberately rather than assuming the action erased it.

For **BB Dynasty League 26!**, send:

> Review my roster for this selected league using Decision OS. This is Best Ball: explain current injury risks, roster depth and missing data. The provider automatically selects my scoring starters.

A passing answer recognizes Best Ball even though the name includes Dynasty, uses this league's roster and treats injuries as availability/depth risks. It does not issue manual scoring-starter swaps or treat “Dynasty League” as a player. If Omar Cooper is still shown IR in the latest roster read, it must respect that designation. It should disclose dated or missing evidence rather than guarantee that every report is current.

## 2. Test a conventional lineup

Select **KBFL** and use its lineup-check action. Send:

> Run a start/sit check for my selected league using Decision OS. Compare eligible bench replacements under this league's scoring, check injuries and byes, exclude players whose games have started, and identify missing projections or platform locks I must verify.

A passing answer names the selected league, uses its roster slots and scoring, excludes unavailable or already-started replacements, and explains any unfilled slot. An unknown projection must remain unknown. Verify suggested players and eligibility against the current roster and provider; these can change after sync or kickoff. Earlier audit examples included Juwan Johnson marked Out and Jeremy Ruckert as a possible eligible comparison; use those only if the refreshed page still shows those facts.

## 3. Test a bench comparison

Use a visible bench comparison button, or send this after verifying both players belong to the selected team:

> Compare Jeremy Ruckert with Juwan Johnson for my selected league this week. Is a change still allowed, and what injury, projection or scoring evidence supports it?

A passing answer checks eligibility and game timing before recommending a change, respects the current injury report, and states which point estimates are available. If the game has started, it should explain the lock rather than suggest an actionable swap. If the players are absent or data is missing, it should say so.

## 4. Verify league isolation and draft behavior

Type a short unsent draft, then switch leagues using the drawer's **League scope** selector. Confirm the new league's conversation appears without copying the previous league's unsent question into it. Return to the original league and confirm its draft is preserved. Click the new league's My team action and inspect both the selected league and question before sending.

Ask:

> Which selected league and team are you using? Summarize my roster's main availability risks and explain whether this league uses automatic Best Ball scoring.

The answer must match the currently selected league. Do not judge it against a different league's scoring, roster or prior conversation.

## 5. Verify honesty about missing data

For a league with a missing-lineup warning, ask:

> Review my lineup for this selected league. What can you verify, what data is missing, and what should I do next?

It must disclose the missing starting lineup instead of inventing starters or saying everything is set. A repeated sync should not be presented as a guaranteed repair when the provider data remains unavailable. Missing IDP or other point estimates must not become fabricated zeros.

## 6. Separate projections from live scores

Ask:

> Explain the difference between my current fantasy score, the published weekly baseline projection and my league-scored lineup projection. Identify unavailable players and any missing projections; do not describe the baseline minus current score as guaranteed remaining points.

It should keep actual scores and forecasts distinct, identify the relevant week and scoring context, and avoid invented precision. Compare numbers only when the same week, starters, scoring and availability apply. Best Ball scoring and provider-selected starters can change as games are played.

## Recording a failure

Keep the league name, selected week, exact prompt, newest answer, test time, refreshed roster evidence and the specific contradiction. A screenshot of the league selector and relevant answer helps distinguish wrong scope from an outdated conversation. Record one of: **pass**, **fail**, or **cannot verify because source data is missing**. Missing data alone is not a correct reason for Chimmy to fabricate an answer.

Repeat scope selection, action buttons and chat input on desktop, tablet and phone. Ensure the drawer scrolls, Send remains reachable, and no control requires horizontal page scrolling.
