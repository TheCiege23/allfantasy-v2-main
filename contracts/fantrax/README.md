# Fantrax actual-week roster download

The fixture records the exact request supplied by the commissioner on October 7,
2026. League and team identifiers are placeholders. No session credentials were
collected. This endpoint requires a logged-in browser; HTTP 200 alone does not
prove CSV success. Without login it returns `WARNING_NOT_LOGGED_IN` as JSON.

`SEASON_50t_BY_PERIOD` is an opaque captured code, supported only for 2026.
Do not derive codes for another season or copy projected-stat parameters.
The captured date envelope starts September 1; this connector does not cover
earlier periods. Its end date advances using the Eastern date, while source
rosters, completed periods and starter totals validate every downloaded CSV.

See `tools/fantrax-browser-connector/README.md` for the installation and remaining
authenticated browser verification. Fixture tests do not prove Chrome sends the
commissioner's session successfully. Login expiry and rate limits stop the run.
