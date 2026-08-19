# Migration History Reconciliation

## Target and evidence date

Read-only inspection on 2026-07-11 identified the configured target as Neon PostgreSQL 17.10, database `neondb`, schema `public`. No database objects or migration records were changed.

## Database-only applied migrations

All four follow the last source/database common migration and were applied successfully on 2026-06-10. Exact SQL could not be recovered from local refs, fetched remote refs, either authoritative GitHub repository, or exact-path GitHub commit history.

| Migration | Checksum | Started | Finished | Steps | Rollback | Logs | Physical evidence consistent with name |
|---|---|---|---|---:|---|---|---|
| `20260609010000_add_ai_billing_fields` | `36da42092e790665bad60dd2ba12860db56b56fa94417764c8843b2020be9769` | 05:25:53.343Z | 05:25:53.450Z | 1 | none | none | Billing decision and token-charge columns exist on `ai_interaction_logs`. |
| `20260610090000_add_fantasy_cache_contracts` | `e4fad56041ced25ce47440aab84999461527c710dc5f2ca6f470f5ba7c5166c2` | 05:25:53.511Z | 05:25:53.705Z | 1 | none | `fantasy_players`, `fantasy_projections`, `fantasy_stat_lines`, and `fantasy_schedule_games` exist with mapped cache columns. |
| `20260610091000_add_concept_presets` | `12bd7f34e4301e7ce9dca29b8895a59fba3c29a27b8c5186676e46ea5def8715` | 05:25:53.757Z | 05:25:53.888Z | 1 | none | `concept_presets` and its foundation columns exist. |
| `20260610100000_expand_concept_presets` | `f001afc238c79451b72e52f8201502a378157ad55d7b83206601bcaa7e44c88b` | 05:25:53.926Z | 05:25:54.031Z | 1 | none | Expanded readiness, visibility, launch, warning, metadata, and preset-key columns exist. |

These attributions are physical-schema correlations, not recovered migration SQL. Equivalent models and fields are present in `schema.prisma`, but checksum parity cannot be reconstructed from schema inference.

## Unapplied source migration

`20260709000000_decision_os_league_context` creates three financial-context enums, `decision_os_league_context`, its primary key, and a unique league index. The table and all three enums are absent from the configured database. No database-only migration duplicates those objects. Its SQL is additive and appears capable of applying against the inspected physical state, but it must remain pending until a disposable clone proves ordering and history behavior. It must not be marked resolved.

## Rolled-back records

Each rolled-back attempt has a later successful record of the same name. The current source checksum exactly matches the later successful checksum.

| Migration | Failed checksum and reason | Successful checksum | Source parity | Renewal impact |
|---|---|---|---|---|
| `20260507180000_world_cup_bracket_entries` | `1835233fd0a08525b79e2ae9647e4141fca42cb27eebe156562144d820217370`; referenced a nonexistent camel-case column | `95bcc6d5c83d9729d781156bfbe2e6ab9f5f6506b14d954a3d81f4b29595bc73` | exact | none found |
| `20260509170000_create_league_rank_invite_foundation` | `7eeae52f986cf7c18ff39fd1aad52365ab17dd3084088851403a6380f3aa591f`; column already existed | `7eeae52f986cf7c18ff39fd1aad52365ab17dd3084088851403a6380f3aa591f`; recorded resolved with zero steps | exact | none found |
| `20260516030000_world_cup_official_fixtures_standings` | `edf12ea0305c971de418e1bd9eba7e32a7a344ea18d068d4208b757b4bce6d70`; table already existed | `83eb612d330cf84af6d3a223018969d39c7e865fbcde1deeccccdf322b3d7f26` | exact | none found |

The rolled-back attempts do not create the current divergence because the successful records and source checksums align. They must not be retried.

## Recovery search

- Local and fetched Git object/path searches: no missing migration objects found.
- Both configured remotes fetched successfully.
- GitHub code search: no exact migration path found.
- GitHub commit-history queries by exact path: zero results in both repositories for all four migrations.
- CI/deployment artifacts and other developer machines were not available in this environment.
- Prisma logs contain no SQL for the four successful records.

## Selected strategy

Strategy B — verified baseline reconstruction for a disposable clone — is the only currently supported route. It can validate physical compatibility but cannot repair production checksum history. Strategy A remains preferred if exact files are later recovered. Strategy C requires database-administrator approval and is not selected.

No fake migration directories were created, `_prisma_migrations` was not edited, and `prisma migrate resolve` was not used.
