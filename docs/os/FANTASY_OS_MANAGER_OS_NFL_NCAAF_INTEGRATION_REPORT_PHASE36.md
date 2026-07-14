# NFL/NCAAF Integration Report (Phase 36, Part 2)

## Approach chosen: smallest correct integration, reusing existing components

Built `components/decision-os/UserOsCardConnected.tsx` — a small connector that owns only the fetch (mirroring `LeagueTab.tsx`'s own real `/api/decision-os/user-os` fetch pattern verbatim, including `credentials: 'same-origin'`/`cache: 'no-store'`) and delegates ALL rendering/state logic to the existing `UserOsCard`. No new dashboard, no new visual system, no new intelligence model — the exact same card other sports already use, reused via a thin fetch wrapper.

Inserted into `NflRedraftLeagueHomeDashboard.tsx` at the identified minimally-invasive point (mirroring `ManagerReplayInsightsCard`'s existing self-contained-card placement pattern), unconditionally — both the commissioner and non-commissioner branches reach it, since the underlying API always scopes to the session user's own team regardless of role.

## NFL result

**Reachable.** Confirmed via a static source-scan test (matching this codebase's own established convention for these large dashboard components, which are not fully rendered in tests): `UserOsCardConnected` is imported and rendered unconditionally in `NflRedraftLeagueHomeDashboard.tsx`.

## NCAAF result

**Reachable, automatically, with zero additional engineering.** NCAAF renders the identical `NflRedraftLeagueHomeDashboard` component instance as NFL (confirmed, not a fork), and the underlying Manager OS pipeline has zero sport-specific logic anywhere. The NFL fix is the NCAAF fix.

**Real data disclosure:** `.env.test` has 3 real NCAAF `League` rows, but all are native/`allfantasy`-platform test/smoke-seeded leagues (names like "RWR NCAAF Smoke," "S3B NCAAF FCFS") — no representative real, provider-imported NCAAF league exists to validate against with genuine user activity, matching this project's established honest-disclosure pattern. The wiring CONTRACT itself (the component renders the connector, sport-agnostically) is proven via the static-scan test and the confirmed absence of any sport branching in the pipeline — this is a structural guarantee, not something that requires a real NCAAF league to prove.

## Commissioner-only-see-own-team requirement

Satisfied without any special-casing: `resolveUserOsSnapshot`'s route always resolves the session user's own managerId server-side, so a commissioner viewing this card in their own NFL/NCAAF league sees their own team's Manager OS data — never another manager's — identical to how the card already behaves for every other sport.

## Empty/unavailable states

Unchanged — `UserOsCard`'s existing loading/unavailable/populated states are reused exactly as-is; no new state was introduced by the NFL/NCAAF wiring itself (the `insufficient_data` retention-risk state, covered separately in the Truthfulness Audit, applies identically regardless of which dashboard renders the card).
