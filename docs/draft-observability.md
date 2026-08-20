# Draft observability (Phase 5G)

Provider-less operational signals for **draft health**, **automation**, **legacy HTTP containment**, and **live-sync snapshot** failures. Events are plain **JSON log lines** via `logStructured` (`source: "draft_health"`, `event: <DraftHealthEventId>`).

## Event taxonomy (`lib/draft/observability/taxonomy.ts`)

| Event | When |
|-------|------|
| `draft_cron_batch_started` | Expired-timer cron batch begins (`processExpiredDraftTimersBatch`). |
| `draft_cron_batch_completed` | Batch finished; includes `durationMs` + rollup `counts`. |
| `draft_expired_timer_processed` | Per-league cron attempt (skipped/processed/error). |
| `draft_autopick_fired` | Reserved for non–slow-draft paths (e.g. auction tick auto-pick). |
| `draft_autopick_skipped` | Slow-draft automation submitted a `(Skipped)` pick. |
| `draft_queue_pick_used` | Queue-first auto-pick committed from slow-draft tick. |
| `draft_bpa_fallback_used` | BPA auto-pick committed from slow-draft tick. |
| `draft_auction_automation_processed` | Auction timer automation (`auto_bid` / `auto_resolve` / `auto_nominate` counts). |
| `draft_lock_busy` | Draft distributed lock contended (`draft_lock` source mirrors `draftEvent`). |
| `draft_live_sync_snapshot_failed` | `buildSessionSnapshot` threw during draft events poll. |
| `draft_session_slot_order_repaired` | `repairDraftSessionSlotOrderIfNeeded` rewrote `slotOrder`. |
| `draft_pick_stale_overall` | `submitPick` rejected: client `expectedOverall` mismatch. |
| `legacy_draft_route_blocked` | Legacy draft API returned **410** (see `logLegacyDraftBlocked`). |
| `chimmy_legacy_draft_signal_fallback` | Chimmy read `DraftRoomStateRow` because no `DraftSession` row. |

## Normalized fields

Helpers in `lib/draft/observability/normalizedPayload.ts` prefer:

- `leagueId`, `draftSessionId`, `draftType`
- `outcome`, `reason` (short codes, not free-form user text)
- `durationMs`, `counts`, `errorClass`
- `draftEvent` (duplicate of top-level `event` for rows mirrored onto other `source` values)

**Never log:** emails, owner/player display names, raw prompts, payment data, full legacy `sessionId` (use `sessionKeyShape` from legacy helper only on legacy events).

## Dashboard-ready summarizers

Pure functions in `lib/draft/observability/summarize.ts` for offline analysis of parsed log rows:

- `summarizeDraftCronBatch`
- `summarizeLegacyRouteBlocks`
- `summarizeDraftAutomationOutcomes`

## Future alert rules

See `lib/draft/observability/alertThresholds.ts` for starter constants (grep-friendly; no pager integration yet).

## Interpreting risk

| Signal | Likely meaning |
|--------|----------------|
| Sustained `legacy_draft_route_blocked` | Old clients/scripts hitting retired live legacy routes. |
| `draft_cron_batch_completed` + `outcome=completed_with_errors` | Cron batch had per-league failures — inspect prior `draft_expired_timer_processed` errors. |
| Frequent `draft_lock_busy` | Concurrent writers / double-submit pressure. |
| `draft_session_slot_order_repaired` spikes | Corrupt/partial `slotOrder` JSON or settings drift. |
| `draft_live_sync_snapshot_failed` | Snapshot builder or DB errors during poll. |
| `chimmy_legacy_draft_signal_fallback` | League missing canonical `DraftSession` while legacy room row exists. |

## Related docs

- `docs/draft-architecture.md` — canonical vs legacy draft system.
- Phase **5F** — Chimmy + legacy route containment predecessor.
