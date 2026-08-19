# Invited MVP Certification Checklist

## Run header and stop gate

- [ ] Environment name/URL and build SHA recorded.
- [ ] Target positively identified as non-production and safe to mutate.
- [ ] Database identity recorded without credentials.
- [ ] Real commissioner and manager sessions attached to trusted browsers.
- [ ] Test league ownership and cleanup policy approved.
- [ ] Console, network, API correlation, and read-only DB evidence collection ready.
- [ ] No fixture, mocked login, or production data is being used as certification evidence.

If any item fails, stop, record the missing prerequisite, and leave every dependent item `BLOCKED`, not `FAIL` or `PASS`.

Use `PASS`, `FAIL`, `BLOCKED`, or `NOT SUPPORTED`. Each pass needs an evidence ID.

## NFL checklist

| Capability | Preconditions | Deterministic steps | Expected result | Required evidence | Result / evidence ID |
| --- | --- | --- | --- | --- | --- |
| Create league | Commissioner; safe DB | Create NFL redraft with invited-MVP defaults; refresh; reopen settings | One owned league persists with correct sport/type/defaults | Browser, create API, DB league/settings before-after | |
| Sleeper import | Owned Sleeper league | Preview; prove commissioner ownership; review warnings; commit twice | Correct preview/commit; warnings persist; duplicate is rejected/idempotent | Provider response metadata, API, DB league/import identity | |
| Other imports | Approved matrix | Verify UI visibility; attempt only supported source | Unsupported sources hidden/labeled; no false promise | Browser and network | |
| Invite/join | Commissioner + fresh manager | Send invite; open as manager; join; refresh; retry link | Correct league/team membership; duplicate safe; wrong user/league denied | Delivery/token metadata, browser, API, DB member rows | |
| Commissioner setup | Joined league | Change general/scoring/roster/draft/waiver/trade/playoff/notification setting; test manager denial | Valid changes persist; frozen/unsupported values blocked; manager receives denial | Browser, API, DB, audit | |
| Draft setup | Enough managers | Configure snake then permitted linear behavior; verify auction unavailable | Correct order/timer/pool; unsupported auction rejected/hidden | Browser, API, draft config DB | |
| Live draft | Three sessions | Execute multiplayer script | Picks are unique, ordered, persistent and synchronized | Multiplayer evidence packet | |
| Mock draft | Authenticated member | Create NFL mock; make picks; refresh/finish | NFL-only pool, stable state, correct recap; no league mutation | Browser/API; DB if persisted | |
| Lineup | Completed draft | Move starter/bench; save/refresh; test invalid, lock and failure | Authoritative save; invalid/locked denied; failure reconciles | Browser, roster API, DB slots | |
| Waivers | Waiver period and FAAB/priority known | Submit claim/drop; duplicate; cancel if supported; process as commissioner | Exactly one claim; correct status/priority/FAAB and atomic roster update | Browser/API/DB transaction and balances | |
| Trades | Two teams | Propose; reject; re-propose; accept/review as policy requires; refresh history | Authorized state transitions and atomic supported-asset ownership; exactly-once notices | Browser/API/DB/event/outbox evidence within supported scope | |
| Schedule/matchups | Schedule generated | Navigate weeks; inspect bye/playoff weeks; edit lineup; refresh scores | Correct teams/weeks, projections distinguished from actual, truthful missing/stale state | Browser/API/DB/provider references | |
| Standings/playoffs | Scored weeks | Compare authoritative standings; apply permitted correction; advance/finalize playoffs | Rank/tiebreak updates authoritatively; correction pending state truthful; champion recorded | Browser/API/DB before-after | |
| Notifications | Delivery configured | Trigger invite, waiver, trade, commissioner event | Correct recipient, league, dedupe and safe copy | Delivery log/ID and notification DB row | |
| Chat/mentions | Two members | Send, refresh, mention duplicate-name case, attempt cross-league access | Stable persistence/order; canonical identity; cross-league denied; no implied notification if absent | Two browsers, API, DB message identities | |
| Settings | Commissioner + manager | Edit each included panel; navigate away with unsaved change; test destructive confirmation | Visibility matches scope; progress/result/frozen states truthful; auth enforced | Browser/API/DB/audit | |
| Commissioner tools | Real commissioner | Exercise every enabled operation; inspect disabled placeholders; repeat as manager | Enabled actions have handlers and audit; placeholders hidden/disabled; manager denied | Browser/API/DB/audit | |
| Season completion | Completed playoffs | Finalize championship; refresh all clients; inspect history and locked state | Champion/runner-up/final standings persist; completed state consistent | Browser/API/DB; provider final scores | |

NFL auction remains `NOT SUPPORTED` for invited MVP. Source/test readiness does not promote any row to runtime pass.

## NCAAF checklist

Run the same lifecycle with an NCAAF league and replace team identity with school identity. Apply these explicit differences:

| Capability | Preconditions and steps | Expected result | Required evidence | Result / evidence ID |
| --- | --- | --- | --- | --- |
| Create league | Create NCAAF redraft using supported presets | NCAAF sport/defaults/eligibility persist; no NFL pool leakage | Browser/API/DB | |
| Import | Verify provider matrix before action | Sleeper is hidden/not supported; Fantrax remains `REQUIRES CERTIFICATION`; unsupported providers cannot commit | Browser/API/provider/DB when exercised | |
| Draft setup/live/mock | Use NCAAF-supported snake/linear configuration and multiplayer script | Only NCAAF player pool/schools; no unsupported auction | Three-browser/API/DB/realtime | |
| Lineups | Exercise NCAAF eligibility, game locks, injury/bye labels | Rules remain isolated from NFL; authoritative save and denial | Browser/API/DB | |
| Waivers/trades | Use NCAAF players only | No cross-sport player; supported transactions atomic/idempotent | Browser/API/DB | |
| Schedule/matchups/standings/playoffs | Complete representative weeks | Correct NCAAF season context, school identity and scoring truth | Browser/API/DB/provider | |
| Provider-backed data | Authorized NCAAF sources only | Source/freshness/unavailable states are truthful; no NFL fallback contamination | Provider packet plus browser | |
| Notifications/chat/settings/commissioner | Repeat NFL role/identity checks | Same authorization and persistence guarantees; sport-safe copy | Browser/API/DB/delivery | |
| Season completion | Complete supported playoff lifecycle | Final state/history persists without implying unsupported renewal | Browser/API/DB | |

NCAAF Sleeper import and auction are `NOT SUPPORTED`. Fantrax import and all live NCAAF provider behavior cannot pass until physically certified.

## Cross-cutting negative cases

- [ ] Anonymous request denied where membership is required.
- [ ] Manager request denied for commissioner-only action.
- [ ] Non-member and wrong-league IDs denied without existence leakage.
- [ ] Wrong-tenant/organization request denied where applicable.
- [ ] Duplicate submission produces one business mutation and one customer-visible result.
- [ ] Refresh/reconnect never creates a duplicate mutation.
- [ ] Raw backend/provider errors and secrets never render.
- [ ] Provider brand and prohibited customer terminology do not leak.
- [ ] Unsupported modes/providers/settings are hidden or explicitly unavailable.
- [ ] Desktop and 390×844 mobile complete every core action with no hydration/global-error screen.

## Closeout

- [ ] Every item has a result and evidence link.
- [ ] P0/P1 inventory is empty.
- [ ] P2/P3 deferrals have owner, issue, target release, and explicit approval.
- [ ] Source runner passed on the exact build SHA.
- [ ] Console/network failures are classified, not ignored.
- [ ] Production was not mutated during certification.
- [ ] Release owner issued explicit invited-MVP approval.
