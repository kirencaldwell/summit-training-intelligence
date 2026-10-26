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

-- ---------------------------------------------------------
-- Debugging prompts (the full text of each call is stored in system_text / user_text / history_text / response_text)
-- ---------------------------------------------------------

-- Where do the characters in each kind of call go? (about 4 characters per token)
SELECT mode, tier, COUNT(*) AS calls,
       ROUND(AVG(LENGTH(system_text)))  AS avg_system_chars,
       ROUND(AVG(LENGTH(user_text)))    AS avg_user_chars,
       ROUND(AVG(LENGTH(history_text))) AS avg_history_chars,
       ROUND(AVG(LENGTH(response_text))) AS avg_reply_chars,
       ROUND(AVG(input_tokens))         AS avg_input_tokens
FROM public.llm_usage
WHERE system_text IS NOT NULL
GROUP BY mode, tier
ORDER BY AVG(input_tokens) DESC NULLS LAST;

-- The most recent calls, newest first (click a cell to read the whole text)
SELECT id, created_at, mode, tier, model, input_tokens, output_tokens, user_text, history_text, response_text
FROM public.llm_usage
ORDER BY created_at DESC
LIMIT 20;

-- The biggest prompts
SELECT id, created_at, mode, input_tokens, LENGTH(user_text) AS user_chars
FROM public.llm_usage
ORDER BY input_tokens DESC NULLS LAST
LIMIT 20;

-- Clear the stored text from calls older than 30 days (keeps the counts)
-- UPDATE public.llm_usage SET system_text = NULL, user_text = NULL, history_text = NULL, response_text = NULL
-- WHERE created_at < NOW() - INTERVAL '30 days';
