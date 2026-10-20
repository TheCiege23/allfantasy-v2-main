# Core mobile polish release

Simplifies Core and league lists, live scores, chat, and mobile draft navigation. Routine sync metadata moves into Updates; delayed data remains visible. League selection preserves roster/live/draft context and recovers from membership read failures without silently dropping the selected league. Imported artwork uses one resolver, including local uploads and Sleeper avatar ids.

Prepared on current main in an isolated release checkout, preserving newer rail, language, chat persistence and draft fixes. No database migrations or worker changes.

Validation: focused navigation, membership recovery, artwork and mobile draft tests; changed TS/TSX syntax and CSS parsing. Protected CI and deployment verification are required before calling this released. The development-only preview uses synthetic data and is unavailable in production.

The reported unresponsive Guilly URL is a separate staging application. Its mobile audit reproduced chat drawer locks remaining after orientation changes and deployed the responsive cleanup fix in e1b89da11f14eda2c402921faad898e2921e5f5c. Regular-member Android Chrome and iPhone Safari/WebKit emulation passed 24 checks, including draft entry. Independent live staging checks confirmed that closing the drawer during both rotation directions clears inert and scroll locks and leaves Roster and Draft responsive. The draft was not started or changed; physical phones were not directly tested.
