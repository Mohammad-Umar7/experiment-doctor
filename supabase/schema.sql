-- Experiment Doctor game storage (Supabase / Postgres).
--
-- Tables are closed to every API role (RLS on, no policies, no grants). The app talks to
-- the database only through the security-definer functions below, so the server can use
-- the project's publishable key and no secret key has to live in the app.

create table if not exists public.doctor_sessions (
  sid text primary key,
  pid text not null,
  case_id text not null,
  variant text not null check (variant in ('full_report', 'one_fix')),
  source text not null default 'local' check (source in ('flagsmith', 'local')),
  counted boolean not null default true,
  started_at timestamptz not null default now(),
  hint_at timestamptz,
  repaired_at timestamptz,
  elapsed_ms integer,
  attempts integer not null default 0,
  last_failing_check text
);

create index if not exists doctor_sessions_pid_idx on public.doctor_sessions (pid);
create index if not exists doctor_sessions_counted_idx on public.doctor_sessions (counted, variant);

create table if not exists public.doctor_leaderboard (
  sid text primary key references public.doctor_sessions (sid) on delete cascade,
  handle text not null check (char_length(handle) between 2 and 20),
  case_id text not null,
  elapsed_ms integer not null check (elapsed_ms > 0),
  variant text not null,
  used_hint boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists doctor_leaderboard_time_idx on public.doctor_leaderboard (elapsed_ms);

alter table public.doctor_sessions enable row level security;
alter table public.doctor_leaderboard enable row level security;
revoke all on public.doctor_sessions from anon, authenticated;
revoke all on public.doctor_leaderboard from anon, authenticated;

-- Start a session. Ignores duplicates.
create or replace function public.doctor_start_session(
  p_sid text, p_pid text, p_case_id text, p_variant text, p_source text, p_counted boolean, p_started_at timestamptz
) returns void
language sql security definer set search_path = public as $$
  insert into doctor_sessions (sid, pid, case_id, variant, source, counted, started_at)
  values (p_sid, p_pid, p_case_id, p_variant, p_source, p_counted, p_started_at)
  on conflict (sid) do nothing;
$$;

-- First hint wins.
create or replace function public.doctor_record_hint(p_sid text) returns void
language sql security definer set search_path = public as $$
  update doctor_sessions set hint_at = now() where sid = p_sid and hint_at is null;
$$;

-- Records one verify attempt atomically. Returns true only for the first verified repair.
create or replace function public.doctor_record_attempt(
  p_sid text, p_ok boolean, p_elapsed_ms integer, p_failing_check text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  first_success boolean := false;
begin
  if p_ok then
    update doctor_sessions
       set attempts = attempts + 1, repaired_at = now(), elapsed_ms = p_elapsed_ms
     where sid = p_sid and repaired_at is null;
    first_success := found;
    if not first_success then
      update doctor_sessions set attempts = attempts + 1 where sid = p_sid;
    end if;
  else
    update doctor_sessions
       set attempts = attempts + 1, last_failing_check = p_failing_check
     where sid = p_sid;
  end if;
  return first_success;
end;
$$;

create or replace function public.doctor_get_session(p_sid text) returns setof public.doctor_sessions
language sql security definer set search_path = public as $$
  select * from doctor_sessions where sid = p_sid limit 1;
$$;

-- A leaderboard spot needs a repaired, counted session whose recorded time matches.
create or replace function public.doctor_claim(
  p_sid text, p_handle text, p_case_id text, p_elapsed_ms integer, p_variant text, p_used_hint boolean
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from doctor_sessions
     where sid = p_sid and counted and repaired_at is not null and elapsed_ms = p_elapsed_ms
  ) then
    return false;
  end if;
  insert into doctor_leaderboard (sid, handle, case_id, elapsed_ms, variant, used_hint)
  values (p_sid, p_handle, p_case_id, p_elapsed_ms, p_variant, p_used_hint)
  on conflict (sid) do nothing;
  return true;
end;
$$;

create or replace function public.doctor_leaderboard_top(p_limit integer default 50)
returns setof public.doctor_leaderboard
language sql security definer set search_path = public as $$
  select * from doctor_leaderboard order by elapsed_ms asc, created_at asc limit least(greatest(p_limit, 1), 200);
$$;

create or replace function public.doctor_all_sessions() returns setof public.doctor_sessions
language sql security definer set search_path = public as $$
  select * from doctor_sessions order by started_at asc limit 20000;
$$;

revoke all on function public.doctor_start_session(text, text, text, text, text, boolean, timestamptz) from public;
revoke all on function public.doctor_record_hint(text) from public;
revoke all on function public.doctor_record_attempt(text, boolean, integer, text) from public;
revoke all on function public.doctor_get_session(text) from public;
revoke all on function public.doctor_claim(text, text, text, integer, text, boolean) from public;
revoke all on function public.doctor_leaderboard_top(integer) from public;
revoke all on function public.doctor_all_sessions() from public;

grant execute on function public.doctor_start_session(text, text, text, text, text, boolean, timestamptz) to anon, authenticated, service_role;
grant execute on function public.doctor_record_hint(text) to anon, authenticated, service_role;
grant execute on function public.doctor_record_attempt(text, boolean, integer, text) to anon, authenticated, service_role;
grant execute on function public.doctor_get_session(text) to anon, authenticated, service_role;
grant execute on function public.doctor_claim(text, text, text, integer, text, boolean) to anon, authenticated, service_role;
grant execute on function public.doctor_leaderboard_top(integer) to anon, authenticated, service_role;
grant execute on function public.doctor_all_sessions() to anon, authenticated, service_role;
