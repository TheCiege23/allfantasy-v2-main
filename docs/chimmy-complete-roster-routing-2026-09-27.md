# Complete-roster request routing regression

The reported question was: "Count my complete roster by position and explain injury risks using current Decision OS evidence. Respect Best Ball rules and disclose missing data or unverified swap eligibility."

Before the fix, the player-name heuristic extracted `Respect Best Ball`. The shared own-roster injury predicate returned false, and the deterministic dispatcher returned the exact reported cache refusal instead of allowing the authenticated league-analysis path to run. Two regression tests reproduced both failures without external data or AI calls.

Full personal roster analysis now yields before individual player, news or game shortcuts, even when the question also names an athlete or a live game. The shared injury predicate recognizes those reviews so the selected-league injury context can run. Format/product labels are replaced with a non-name marker only for name extraction, preserving genuine athlete names that follow them. Direct named-player injury lookups remain available.

All 130 deterministic-answer tests passed, including 13 new regressions. Validation covers the exact prompt, complete and selected-league roster wording, named athletes inside whole-roster reviews, incidental live-game requests, Best Ball and Decision OS labels, and direct Patrick Mahomes lookups. The standard database guard stays first and data sources are mocked. Hosted validation and release verification are pending.

After deployment, refresh My Team, confirm the intended league in the Chimmy drawer and resend the exact question. Check the newest answer against the current complete roster, including bench/IR/taxi, rather than roster capacity. A generic refusal naming `Respect Best Ball` is a failure. Missing injury evidence should be disclosed without suppressing a verifiable roster count. A full answer must also respect automatic Best Ball scoring and unverified transaction or kickoff locks.
