-- READ-ONLY. How many stored trades in each non-NFL sport moved a draft pick?
-- (2026-11-22: decides whether a pick market is worth building for NBA / MLB / NHL.)
-- One row per sport and season. Counts only — no user, league or player identifiers.
SELECT upper(t.sport)                                         AS sport,
       t.season,
       count(DISTINCT t."transactionId")                      AS trades,
       count(DISTINCT t."transactionId") FILTER (
         WHERE jsonb_array_length(COALESCE(t."picksGiven", '[]'::jsonb)) > 0
            OR jsonb_array_length(COALESCE(t."picksReceived", '[]'::jsonb)) > 0
       )                                                      AS trades_with_a_pick,
       count(DISTINCT t."transactionId") FILTER (
         WHERE t."contextSnapshot" IS NOT NULL
       )                                                      AS trades_with_saved_context,
       count(DISTINCT t."transactionId") FILTER (
         WHERE t."contextSnapshot" -> 'boardValues' IS NOT NULL
       )                                                      AS trades_with_board_values
FROM "LeagueTrade" t
WHERE upper(t.sport) <> 'NFL'
GROUP BY 1, 2
ORDER BY 1, 2;
