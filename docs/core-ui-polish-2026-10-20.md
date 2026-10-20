# Core mobile polish release

Simplifies Core and league lists, live scores, chat, and mobile draft navigation. Routine sync metadata moves into Updates; delayed data remains visible. League selection preserves roster/live/draft context and recovers from membership read failures without silently dropping the selected league. Imported artwork uses one resolver, including local uploads and Sleeper avatar ids.

Prepared on current main in an isolated release checkout, preserving newer rail, language, chat persistence and draft fixes. No database migrations or worker changes.

Validation: focused navigation, membership recovery, artwork and mobile draft tests; changed TS/TSX syntax and CSS parsing. Protected CI and deployment verification are required before calling this released. The development-only preview uses synthetic data and is unavailable in production.

The reported unresponsive Guilly URL is a separate staging application. Signed-in commissioner testing could enter its live draft and open Players at phone width; the reported behavior for other managers has not yet been reproduced. Staging currently has a separate draft-settings release in progress.
