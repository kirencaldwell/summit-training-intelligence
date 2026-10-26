-- Where the AI coach spends tokens. Run in the Supabase SQL editor (needs the llm_usage table from schema.sql).

-- Calls, tokens and latency per feature over the last 30 days
SELECT mode, tier, provider, model,
       COUNT(*)                                   AS calls,
       SUM(input_tokens)                          AS input_tokens,
       SUM(output_tokens)                         AS output_tokens,
       ROUND(AVG(input_tokens))                   AS avg_input,
       ROUND(AVG(output_tokens))                  AS avg_output,
       ROUND(AVG(latency_ms))                     AS avg_ms,
       COUNT(*) FILTER (WHERE NOT ok)             AS failed
FROM public.llm_usage
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY mode, tier, provider, model
ORDER BY COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) DESC;

-- Per day
SELECT created_at::date AS day, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
FROM public.llm_usage
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 1 DESC;
