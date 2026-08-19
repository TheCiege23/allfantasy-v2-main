# AF League Tycoon Import Adapter — Build Brief

**Status:** ⛔ **BLOCKED on data access** — see §1. Engineering spec is ready; the build can't start until there's a way to read a user's League Tycoon data.
**Prepared:** Jul 15, 2026 · **For:** Claude Code in `F:\allfantasy-v2-main` · plus a decision + outreach from Guap.
**Goal:** Add League Tycoon as a sixth+ import provider so free/trial users can pull their League Tycoon (dynasty) leagues into the AllFantasy command center alongside Sleeper/ESPN/Yahoo/MFL/Fantrax/Fleaflicker.

**Read alongside:** `AF_GATE0_TRIAL_BUILD.md` (League Tycoon shows in the free "connect all platforms" list), `AF_STANDING_REQUIREMENTS.md` (W1 — third-party data compliance).

---

## 1. Research finding — the blocker (read first)

League Tycoon (leaguetycoon.com, by Figment Labs; iOS + Android; dynasty-focused) publishes **no public or developer API, no documented data export, and no third-party integration path.** Unlike Sleeper (public, username → leagues, no auth), there is no sanctioned way to read a user's rosters/matchups/standings/history today.

That means this adapter cannot be built like the Sleeper one. Before any code, we need a **data source**. Options, best to worst:

1. **Official access / partnership (recommended).** Email `support@leaguetycoon.com`, ask for API or a data-sharing agreement / user-authorized export. This is the clean path, it fits AllFantasy's B2B posture, and it satisfies the ToS/legal caution in W1. Slowest to land, safest to ship.
2. **User-provided export.** If League Tycoon offers (or adds) a per-user CSV/JSON export, accept an upload and parse it. Confirm whether any export exists (not found in public docs).
3. **Reverse-engineered mobile/private API.** Technically possible (the app talks to a backend) but **ToS-risky and brittle** — exactly the "get a lawyer" category in W1. **Do not pursue as the default.** If ever considered, counsel reviews first.

**Decision needed from Guap:** which data path (pursue official access / confirm an export exists / hold). Everything below assumes one of these yields a readable source.

---

## 2. Engineering spec (ready once a data source exists)

Grounded in the existing import layer (`lib/league-import/`). Providers already present: `sleeper`, `espn`, `yahoo`, `mfl`, `fantrax`, `fleaflicker`. Each provider is a small folder registered through shared services. Mirror that pattern — do **not** invent a new shape.

**Create `lib/league-import/leaguetycoon/`:**
- `LeagueTycoonLeagueFetchService.ts` — fetch a user's leagues + current rosters/matchups/standings from the chosen source (§1). Mirror `mfl/MflLeagueFetchService.ts` (fetch → preview → commit-ready shape).
- `LeagueTycoonHistoricalBackfillService.ts` — pull prior-season history (dynasty leagues lean heavily on history). Mirror `mfl/MflHistoricalBackfillService.ts`.

**Wire it into the shared layer:**
- Add a mapper under `lib/league-import/mappers/` that normalizes League Tycoon's shape to the canonical import DTO consumed by `canonicalImportNormalizer.ts`.
- Register the provider in `importAdapterRegistry.ts`, `LeagueImportRegistry.ts`, and `ImportProviderResolver.ts`.
- Add UI config in `provider-ui-config.ts` (name "League Tycoon", logo, input type — username/OAuth/upload depending on §1 path).
- Ensure output flows through the existing `ImportedLeagueNormalizationPipeline.ts` → `ImportedLeaguePreviewBuilder.ts` → `ImportedLeagueCommitService.ts` unchanged (canonical path; no per-provider commit logic).
- Dynasty specifics: preserve multi-year keeper/dynasty rosters and draft-pick assets in the mapper — these are League Tycoon's core and the canonical model must not flatten them.

## 3. Build checklist (all seven)
1. **Visual** — League Tycoon appears in the connect list with logo + correct input; import progress + populated leagues on the board.
2. **Backend** — the fetch/backfill services + mapper + registry wiring above.
3. **UI/UX** — honest progress; graceful failure; dynasty rosters render correctly.
4. **Delete old** — none expected (new provider); remove any placeholder League Tycoon stub if one exists.
5. **Fixes/gaps** — ensure the canonical normalizer handles dynasty/keeper/pick assets without loss.
6. **SEO/ASO** — add "League Tycoon" to the platforms listed on the marketing/landing + ASO keywords ("import League Tycoon", "dynasty").
7. **On-brand** — no "AI" in any League Tycoon-facing copy; "see & decide" scope; real data only.

## 4. Compliance (W1 — do not skip)
Reading another platform's league data is governed by its ToS. Secure **written permission or an official/user-authorized path** before shipping, and have counsel confirm what may be stored/displayed. This is the top W1 item; the recommended §1.1 route is the compliant one.

## 5. Acceptance criteria (once unblocked)
- [ ] A user connects League Tycoon via the approved path and their real dynasty leagues import (rosters, matchups, standings, history) with nothing fabricated.
- [ ] Dynasty/keeper rosters + draft-pick assets survive normalization intact.
- [ ] League Tycoon leagues sit on the unified board alongside other platforms and flow through the standard commit pipeline.
- [ ] Data access is documented as compliant (§4).

## 6. Verification
- `npm run build` + `npm run typecheck` clean.
- Provider-parity tests mirroring the MFL/Fantrax import tests, against a real League Tycoon account/sample.
- Manual: connect a real League Tycoon league end-to-end; confirm the board + a dynasty roster render correctly.

## 7. Interim (buildable now, unblocked)
Until §1 is resolved, show **League Tycoon in the free "connect your platforms" list as "Coming soon — request early access"** (capture interest), rather than a broken import. This is a small UI addition to `provider-ui-config.ts` + the connect surface, and it keeps the "all your platforms in one place" story honest.

---

*Sequence: Guap secures a data path (§1) → confirm compliance (§4) → build the adapter (§2) → verify → ship. Interim placeholder (§7) can ship now.*
