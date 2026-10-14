# Survivor Guillotine launch checks

The guarded QA scripts require `SG_QA_ENDPOINT` to match the nonproduction Neon endpoint in `DATABASE_URL`. They reject production databases and remove their test leagues and accounts. Do not use real member email addresses for these rehearsals.

- `scripts/smoke-survivor-guillotine-qa.ts` exercises private league creation, three invite joins, manager access checks, a 22-pick native draft, and hidden player-bound idol seeding. Its draft pool fixture uses real QA player records and unique player names. The live draft-pool endpoint is still called; the fixture isolates the draft engine from slow third-party pool generation.
- `scripts/smoke-survivor-guillotine-season-qa.ts` exercises the full 22-manager NFL/NBA season, including scores, chops, powers, waivers, auction, and correction paths. It uses synthetic scoring rows and does not replace a live provider pilot.
- `scripts/audit-survivor-guillotine-qa-data.ts` checks real NBA game rows across both halves of a two-week window and runs the same capped-game calculation used by the league.

For a controlled production pilot, create a private league with test managers, use the normal invite and draft screens, and verify the tribe vote, lineup lock, score finalization, and Chop Night with actual schedule dates. Keep the pilot league separate from customer leagues. A prior full-season synthetic rehearsal and the isolated QA pilot cover logic and integration; they do not prove the production account and provider path end to end.

Older stat corrections are reviewed in commissioner control. The audit shows the played chop and the corrected projection. The commissioner can record a reasoned decision to keep the played result or flag manual follow-up. Later drafts, claims, and chops are deliberately preserved; a flagged case is not an automatic historical rewind.
