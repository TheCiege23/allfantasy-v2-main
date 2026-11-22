-- Trade-learning census — READ ONLY. Every statement is a SELECT; nothing is written, locked or altered.
-- Run in the Neon SQL editor against production. Each query is independent; run them one at a time.
--
-- Tables (names checked against prisma/schema.prisma on main, 2026-11-22):
--   "LeagueTrade"               one row per SIDE of a completed trade (players/picks/FAAB given and received)
--   "LeagueTradeHistory"        owns those rows; "sleeperLeagueId" is the provider's league id for that season
--   league_player_weekly_scores every rostered player per league/season/week, with rosterId + isStarter
--                               — the rosters at the time of a trade, if it covers that week
--   "WeeklyMatchup"             each team's result per week — the records at the time of a trade
--   leagues                     the league's settings (sport, dynasty, scoring, variant)
--
-- One trade = one ("sleeperLeagueId", "transactionId") pair; its sides are summed.

-- Q1. How many trades, by platform, sport and season — and how complete each one is.
WITH side AS (
  SELECT h."sleeperLeagueId" AS lg, lt."transactionId" AS tx, lt.platform, lower(lt.sport) AS sport, lt.season,
         CASE WHEN jsonb_typeof(lt."playersGiven"::jsonb) = 'array' THEN jsonb_array_length(lt."playersGiven"::jsonb) ELSE 0 END
       + CASE WHEN jsonb_typeof(lt."playersReceived"::jsonb) = 'array' THEN jsonb_array_length(lt."playersReceived"::jsonb) ELSE 0 END AS players,
         CASE WHEN jsonb_typeof(lt."picksGiven"::jsonb) = 'array' THEN jsonb_array_length(lt."picksGiven"::jsonb) ELSE 0 END
       + CASE WHEN jsonb_typeof(lt."picksReceived"::jsonb) = 'array' THEN jsonb_array_length(lt."picksReceived"::jsonb) ELSE 0 END AS picks,
         lt."budgetGiven" IS NOT NULL OR lt."budgetReceived" IS NOT NULL AS budget_read,
         coalesce(lt."budgetGiven", 0) + coalesce(lt."budgetReceived", 0) AS faab
  FROM "LeagueTrade" lt JOIN "LeagueTradeHistory" h ON h.id = lt."historyId"
), trade AS (
  SELECT lg, tx, min(platform) AS platform, min(sport) AS sport, min(season) AS season, count(*) AS sides,
         sum(players) AS players, sum(picks) AS picks, bool_or(budget_read) AS budget_read, sum(faab) AS faab
  FROM side GROUP BY lg, tx
)
SELECT platform, sport, season,
       count(*)                                              AS trades,
       count(DISTINCT lg)                                    AS leagues,
       round(100.0 * avg((sides >= 2)::int), 1)              AS pct_both_sides_stored,
       round(100.0 * avg((players + picks > 0)::int), 1)     AS pct_has_assets,
       round(100.0 * avg((picks > 0)::int), 1)               AS pct_with_picks,
       round(100.0 * avg(budget_read::int), 1)               AS pct_faab_read,
       round(100.0 * avg((faab > 0)::int), 1)                AS pct_faab_moved
FROM trade
GROUP BY platform, sport, season
ORDER BY sport, platform, season DESC;

-- Q2. NFL trades by league type — the cells the learner would fit separately.
WITH trade AS (
  SELECT h."sleeperLeagueId" AS lg, lt."transactionId" AS tx,
         min(coalesce(lt."leagueFormat", 'unknown')) AS fmt, bool_or(lt."isSuperFlex") AS superflex,
         min(coalesce(lt."scoringType", 'unknown')) AS scoring
  FROM "LeagueTrade" lt JOIN "LeagueTradeHistory" h ON h.id = lt."historyId"
  WHERE lower(lt.sport) = 'nfl'
  GROUP BY 1, 2
)
SELECT fmt, coalesce(superflex::text, 'unknown') AS superflex, scoring, count(*) AS trades, count(DISTINCT lg) AS leagues
FROM trade GROUP BY 1, 2, 3 ORDER BY trades DESC;

-- Q3. Trades arriving now — the deadline-week flow, by when they happened and when we stored them.
WITH trade AS (
  SELECT h."sleeperLeagueId" AS lg, lt."transactionId" AS tx, min(lt.platform) AS platform,
         min(lt."tradeDate") AS trade_date, min(lt."createdAt") AS stored_at
  FROM "LeagueTrade" lt JOIN "LeagueTradeHistory" h ON h.id = lt."historyId"
  GROUP BY 1, 2
)
SELECT platform,
       count(*) FILTER (WHERE trade_date >= now() - interval '7 days')  AS made_last_7d,
       count(*) FILTER (WHERE trade_date >= now() - interval '30 days') AS made_last_30d,
       count(*) FILTER (WHERE stored_at  >= now() - interval '7 days')  AS stored_last_7d,
       count(*) FILTER (WHERE trade_date IS NULL)                       AS no_trade_date,
       round(avg(extract(epoch FROM stored_at - trade_date) / 3600)
             FILTER (WHERE trade_date >= now() - interval '30 days'), 1) AS avg_hours_trade_to_stored
FROM trade GROUP BY platform ORDER BY made_last_30d DESC;

-- Q4. Can we rebuild each team's roster and record at the moment of the trade?
--     rosters: the weekly player rows exist for that league, season and week (or the week before)
--     records: at least one weekly result exists for that league and season before the trade week
WITH trade AS (
  SELECT h."sleeperLeagueId" AS lg, lt."transactionId" AS tx, min(lt.platform) AS platform,
         min(lower(lt.sport)) AS sport, min(lt.season) AS season, min(lt.week) AS week
  FROM "LeagueTrade" lt JOIN "LeagueTradeHistory" h ON h.id = lt."historyId"
  GROUP BY 1, 2
)
SELECT platform, sport, season, count(*) AS trades,
       round(100.0 * avg((EXISTS (
         SELECT 1 FROM league_player_weekly_scores s
         WHERE s."leagueId" = trade.lg AND s."seasonYear" = trade.season AND s.week IN (trade.week, trade.week - 1)
       ))::int), 1) AS pct_roster_rebuildable,
       round(100.0 * avg((EXISTS (
         SELECT 1 FROM "WeeklyMatchup" m
         WHERE m."leagueId" = trade.lg AND m."seasonYear" = trade.season AND m.week < trade.week
       ))::int), 1) AS pct_record_known,
       round(100.0 * avg((week <= 1)::int), 1) AS pct_offseason_or_week1
FROM trade GROUP BY platform, sport, season ORDER BY sport, platform, season DESC;

-- Q5. Do we hold the league's settings for each trade's league?
WITH trade_league AS (
  SELECT DISTINCT h."sleeperLeagueId" AS lg, lower(lt.sport) AS sport
  FROM "LeagueTrade" lt JOIN "LeagueTradeHistory" h ON h.id = lt."historyId"
)
SELECT tl.sport, count(*) AS trade_leagues,
       count(l.id)                                        AS with_league_row,
       count(l.id) FILTER (WHERE l.settings IS NOT NULL)  AS with_settings,
       count(l.id) FILTER (WHERE l."isDynasty")           AS dynasty,
       count(l.id) FILTER (WHERE l."leagueVariant" IS NOT NULL) AS with_variant
FROM trade_league tl
LEFT JOIN LATERAL (
  SELECT id, settings, "isDynasty", "leagueVariant" FROM leagues
  WHERE leagues."platformLeagueId" = tl.lg ORDER BY season DESC LIMIT 1
) l ON true
GROUP BY tl.sport ORDER BY trade_leagues DESC;

-- Q6. How often each player has been traded — how many players have enough trades to learn a value from.
WITH moved AS (
  SELECT lower(lt.sport) AS sport, h."sleeperLeagueId" AS lg, lt."transactionId" AS tx, p.player
  FROM "LeagueTrade" lt JOIN "LeagueTradeHistory" h ON h.id = lt."historyId"
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(lt."playersReceived"::jsonb) = 'array' THEN lt."playersReceived"::jsonb ELSE '[]'::jsonb END
  ) AS p(player)
), per_player AS (
  SELECT sport, player, count(DISTINCT (lg, tx)) AS trades FROM moved GROUP BY sport, player
)
SELECT sport, count(*) AS players_ever_traded,
       count(*) FILTER (WHERE trades >= 3)  AS traded_3_plus,
       count(*) FILTER (WHERE trades >= 5)  AS traded_5_plus,
       count(*) FILTER (WHERE trades >= 10) AS traded_10_plus,
       max(trades) AS most_trades_one_player
FROM per_player GROUP BY sport ORDER BY players_ever_traded DESC;

-- Q7. Trades in the provider fact table, which feeds the manager records — for comparison with "LeagueTrade".
SELECT sport, season, count(*) AS trade_fact_rows, count(DISTINCT "leagueId") AS leagues
FROM dw_transaction_facts
WHERE type ILIKE 'trade%'
GROUP BY sport, season ORDER BY sport, season DESC;
