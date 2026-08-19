# Sports Data Snapshot & Event Storage (Fantasy OS Phase 5B)

Non-production, isolated `sports_data` schema. Append-only. Provider-neutral (no raw provider payloads persisted; only canonical records + a content hash).

## Snapshot tables
- **`sports_snapshot`** — `snapshot_id` (deterministic from content checksum), version, sport, capability, provider, `status` (building/partial/certified/rejected), generated_at, source_updated_at, record/resolved/ambiguous/unresolved/rejected counts, `checksum`, `previous_snapshot_id`, `limitations`.
- **`sports_snapshot_record`** — (`snapshot_id`, `canonical_key`) PK, `resolution_status`, `record` jsonb (canonical + `__contentHash`).

**Certification gate** (`canCertify`): every record schema-valid · all identity outcomes classified · deterministic checksum · row accounting reconciles · scope complete · rejects explained via `limitations` · run not partial · provenance present · freshness complete. A failing gate throws before insert — the prior certified snapshot survives. Certified snapshots are **never updated in place**.

**Checksum method** — per-record content hash = SHA-256 of the canonical record with volatile provenance (`fetchedAt`, per-record `snapshotVersion`, `sourceUpdatedAt`) stripped, so an unchanged fact hashes identically across runs. Snapshot checksum = SHA-256 over `canonicalKey:contentHash` pairs sorted by key (order-insensitive). Snapshot id derives from this checksum → identical data on rerun ⇒ `ON CONFLICT DO NOTHING` ⇒ no duplicate snapshot.

## Event tables
- **`sports_event`** — `event_id` (deterministic SHA-256 of `eventType|entityId|snapshotVersion|contentHash`), event_type, sport, entity_id, occurred_at, observed_at, provider, snapshot_version, payload, provenance, `delivery_status`, `retry_count`.

**Deduplication** — deterministic `event_id` + `ON CONFLICT (event_id) DO NOTHING` ⇒ idempotent inserts; the same change never produces a second event. **No-change suppression** — `diffSnapshot` compares new records' content hashes to the previous certified snapshot's; unchanged records emit nothing.

Supported initial event types (Part 2): `player_status_changed`, `injury_status_changed`, `player_team_changed`, `game_status_changed`, `game_start_changed`, `roster_changed`, `transaction_observed`, `draft_state_changed`, `projection_changed`, `provider_record_corrected`. (The players backbone emits `player_status_changed`; the rest arrive with their scopes.)

## Sync tables
`sync_run`, `sync_checkpoint`, `sync_lock` (leased, stale-recovery via `expires_at`), `sync_freshness` — the DB backing for the Phase 4 runner interfaces.

## Disable / rollback
Disable: unset `FANTASY_OS_EXEC_ENABLED` or `FANTASY_OS_EXEC_DATABASE_URL` → store fails closed. Rollback: the prior certified snapshot remains queryable; nothing is destructive.
