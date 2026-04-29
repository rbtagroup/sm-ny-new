-- Manuální test scheduleru přes pg_net
-- Nahraď URL a secret, nebo použij Vault verzi níže.

select net.http_post(
  url := 'https://PROJECT_REF.supabase.co/functions/v1/scheduler',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-scheduler-secret', 'CHANGE_ME_LONG_RANDOM_SECRET'
  ),
  body := jsonb_build_object('job', 'daily-coverage', 'source', 'manual-sql-test')
) as request_id;

-- Výsledek pg_net requestu zkontroluj:
select *
from net._http_response
order by created desc
limit 10;
