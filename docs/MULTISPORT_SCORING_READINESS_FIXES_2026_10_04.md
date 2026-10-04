# Multisport scoring readiness fixes - October 4, 2026

NBA: category creation/persistence, short weekly stat aliases, weighted percentages, commissioner display and OS/Chimmy context. New 8-cat excludes turnovers; stored legacy 8-cat rules remain unchanged.

NCAAF: explicit Fantrax ID provenance, weekly conservative CFB identity ingestion, CFBD kicker makes and verified misses, verified defender stat fields gated by IDP, and commissioner scoring bridges. Production refresh added 389 verified links without overwrites; 2,504 identities carry both source IDs. This does not establish full roster coverage. CFBD player logs do not supply field-goal distances, two-point conversions or team-defense lines; assisted tackles, forced fumbles, safeties and advanced scoring remain uncertified when their underlying stat fields are absent.

NCAAB: reject wrong-season and opening-month-only schedules, preserve cache on 304. The actual 2026 schedule is still unpublished (304 after client retry); upcoming-season readiness remains dependent on provider publication.

NHL: prevent finalization before the Eastern week ends. Actual week 1 dry run saw 43 games (34 final, 9 unfinished), refused games_not_final and finalized zero rows. Real completion must be verified after the remaining games and grace period.

Focused tests and the TypeScript/CI gates must pass before merge. No schema migration or production test league is introduced.
