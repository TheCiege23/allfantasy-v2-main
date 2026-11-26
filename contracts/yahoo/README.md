# Yahoo Fantasy API Contract — READ THIS FIRST

> ### 🛑 Rule for all agents and developers
>
> **Never call the Yahoo Fantasy API to find out what a resource returns.**
>
> The resource list is in `ENDPOINTS.yaml`. Captured response bodies belong in `fixtures/`
> (none yet). If the answer is not in those two places it is a gap for `GAPS.md`, not a reason to
> probe.

## Why this contract is different

Every Yahoo fantasy resource needs a user's OAuth token, so there is no `scripts/probe.sh` here:
a probe script would need a credential on a developer's machine. Instead (owner decision
2026-11-25) captures are made by the **owner-only capture button** on the admin page:

1. Connect Yahoo in AllFantasy as a normal user (League Sync).
2. Admin → **Data & reliability** → **Provider contract capture** (`/admin#contract-capture`). Pick one of your own Yahoo NFL leagues and a
   FINISHED week, then **Download capture**.
3. The server reads the resources below with your stored token, redacts the bodies
   (`lib/admin/contractCapture/redactContractCapture.ts` — refuses to return anything if an original
   name, id, league key or credential survives) and returns ONE JSON file. Nothing is stored.
4. Review the file, trim it if large (`contracts/fleaflicker/scripts/trim-fixture.mjs`), commit it
   to `fixtures/`, and move the resource in `ENDPOINTS.yaml` from `not_yet_captured` to `captured`
   in the same change.

The token never leaves the server and is never in the file, a log line, or a response header.

## Runtime

| File | Role |
|---|---|
| `lib/league-import/yahoo/YahooLeagueFetchService.ts` | The single Yahoo adapter; holds the only base-URL literal. `buildYahooContractCapturePath` is the capture allowlist. |
| `lib/admin/contractCapture/contractCaptureService.ts` | Owner-only capture: own credential, own league, fixed request set |
| `app/api/admin/contract-capture/route.ts` | Admin route (`requireAdmin` + the app session's own user id) |

## Privacy

Pending trade offers: AllFantasy may read them but keeps and shows **only offers the signed-in
user sent or received** (`GAPS.md` Y-03). Manager names, nicknames, guids, emails, team names and
logos are people's data and are never committed.
