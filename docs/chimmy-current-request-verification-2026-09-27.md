# Chimmy current-request verification — 2026-09-27

## Confirmed live failure

On the selected BB Dynasty League 26! My team page, the dedicated Best Ball review button submitted only a Best Ball roster review. Chimmy correctly described automatic scoring and the selected roster's injuries, but also reopened an earlier KBFL trade screenshot question. The injury tool scanned up to 40 leagues and reported 24 skipped leagues despite the selected-league request. The provider link said “set it” even though Best Ball selects scoring starters automatically.

Shared account-wide history is intentional and remains available. The defect is answer focus, not the presence of old turns in the visible transcript.

## Changes

- Both model paths receive current-request focus instructions outside the shared cached prompt; fallback prompting uses the same policy.
- Injury tools read the selected, membership-authorized current-season roster by default. An explicit scope=all request and the no-selected-league case retain cross-league coverage.
- Provider links say “Review roster” and keep the existing verified platform destination.

## Manual answer checks after deployment

1. Open `/core/my-team`, select BB Dynasty League 26!, and use its dedicated Best Ball review button. Send once. The newest answer should review that roster, explain automatic scoring, and match the visible injury list. It should not grade or ask for the old KBFL trade screenshot, list unrelated KBFL injuries, or report a 40-league coverage cap.
2. Select KBFL and ask: “Check my lineup using Decision OS. Which available bench players can replace unavailable starters before their games lock?” Compare names, eligibility, injuries and kickoff locks against the roster. A missing projection or eligible replacement must be stated as a gap.
3. With KBFL selected, ask: “Who is injured across all my current leagues?” Cross-league results are expected here; a scan cap must be disclosed.
4. Follow up with “Explain that recommendation.” Chimmy should still use prior conversation to resolve the reference. Shared history must remain visible.
5. Switch leagues with an unsent draft. Each scope should preserve its own draft and no request should send automatically. Old transcript turns may remain visible because history is unified; assess the newest answer's current scope.

Record the selected league, prompt, newest answer, checked time and any contradiction. Do not treat a plausible answer as verified without checking its cited roster, scoring and injury facts.

## Release status

Source implementation and focused automated validation are in progress. Live verification of this follow-up is pending deployment.
