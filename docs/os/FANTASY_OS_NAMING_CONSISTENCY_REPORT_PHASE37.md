# Naming Consistency Report (Phase 37, Part 3)

Customer-facing wording only — no code renamed, per this phase's explicit guardrail.

## Real naming collisions found

| Term used | Real, distinct meanings found | Where each appears |
|---|---|---|
| "Manager Intelligence" | (a) A static, entitlement-gated teaser tile on NFL/NCAAF league home (no live data). (b) A nav link on `LeagueTab.tsx` pointing to `/league/[leagueId]/intelligence` (a Commissioner-scoped page despite the "Manager" name). (c) Loosely, the general concept behind Manager OS/`UserOsCard`. | 3 different real surfaces, only loosely related |
| "League Intelligence" | (a) A static teaser tile on NFL/NCAAF league home. (b) `LeagueTab.tsx`'s own nav link, same target as above. (c) The `CommissionerIntelligenceHub` page's own self-description (`/league/[leagueId]/intelligence` — titled "Commissioner Intelligence" internally despite being reached via a "League Intelligence" link). | Same URL, 3 different labels used to describe reaching it |
| "Manager Hub" vs "Manager OS" | "Manager OS" is the internal/architectural name (`lib/decision-os/userOs.ts`'s own header comment, prior phase docs); "Manager Hub" is the real, customer-facing route/page title. Not truly a collision — a real internal/external naming split, which is appropriate as long as "Manager OS" never leaks to a customer-facing surface (spot-checked: it does not, in every real component reviewed). | — |
| "Commissioner Hub" vs "Commissioner OS" vs "Commissioner Intelligence" | "Commissioner Hub" (`/commissioner-hub`, real, live) and "Commissioner Intelligence" (`CommissionerIntelligenceHub.tsx`, the internal component name for `/league/[leagueId]/intelligence`) are two different real pages a commissioner could easily conflate. "Commissioner OS" (the `lib/shared-services/commissioner/` shadow module) never surfaces to customers — confirmed, not a real collision risk today. | — |
| "League Health" | Three independent numeric/qualitative computations (see Intelligence Capability Map) all use this exact customer-facing phrase. | `/dashboard`, `/commissioner-hub`, `/league/[leagueId]/intelligence` |
| "Mission Control" | Internal Decision OS name that DOES leak to the customer-facing `MissionControlCard.tsx`'s card title (confirmed real, shown on `/commissioner-hub`) — an internal-sounding term reaching real users. | `/commissioner-hub` only |

## Internal-only wording (confirmed does not leak to customers)

"Decision OS," "Manager OS," "Commissioner OS," "Game Day OS," "Behavioral Intelligence," "Retention Risk" (the raw field name — the rendered UI label is "Retention risk" in plain title case, and now correctly shows "Insufficient data" rather than the raw enum, per Phase 36) — all confirmed confined to code/docs/component names, not customer-facing copy, in every surface reviewed this phase.

## Recommended consistent customer-facing vocabulary (recommendation only, not implemented — naming changes to live, shipped UI text are a real, visible product change requiring explicit sign-off beyond this phase's "smallest possible changes" mandate)

- Use **"League Health"** for exactly one, clearly-labeled concept per surface — if multiple real computations must coexist (a real, disclosed architectural fact, not fixed this phase), each should carry a distinct qualifier a user can learn to recognize (e.g., "League Health (Commissioner HQ)" vs "League Health (Detailed Report)") rather than the identical bare phrase in all three places.
- Reserve **"Mission Control"** for internal use only, or rename its customer-facing card title to something in the existing "Hub"/"Focus"/"Overview" vocabulary already used elsewhere (`/commissioner-hub`, "League Focus," "Multi-League Overview").
- Standardize the "___ Intelligence" pattern: pick either "Manager Intelligence" (member-facing) or "Commissioner Intelligence" (commissioner-facing) consistently for the SAME real destination (`/league/[leagueId]/intelligence`) rather than both labels pointing at content that's internally titled a third way.

None of the above were implemented this phase — they are flagged recommendations for a future, explicitly-scoped copy/IA phase, consistent with the guardrail to separate observations from recommendations and not redesign pages.
