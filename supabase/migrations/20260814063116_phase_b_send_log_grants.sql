-- Least privilege: send log and delivery events are written by service role
-- (cron + webhook). Members may read them.

revoke insert, update, delete, truncate, references, trigger
  on table public.sms_send_log from authenticated;

revoke insert, update, delete, truncate, references, trigger
  on table public.sms_delivery_events from authenticated;

grant select on table public.sms_send_log to authenticated;
grant select on table public.sms_delivery_events to authenticated;
