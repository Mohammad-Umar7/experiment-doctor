-- Experiment Doctor game storage (Supabase / Postgres).
-- Only the server (service role) reads and writes these tables; RLS blocks everyone else.

create table if not exists public.doctor_sessions (
  sid text primary key,
  pid text not null,
  case_id text not null,
  variant text not null check (variant in ('full_report', 'one_fix')),
  source text not null default 'local',
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

-- Records one verify attempt atomically. Returns true only for the first verified repair.
create or replace function public.doctor_record_attempt(
  p_sid text,
  p_ok boolean,
  p_elapsed_ms integer,
  p_failing_check text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  first_success boolean := false;
begin
  if p_ok then
    update doctor_sessions
       set attempts = attempts + 1,
           repaired_at = now(),
           elapsed_ms = p_elapsed_ms
     where sid = p_sid and repaired_at is null;
    first_success := found;
    if not first_success then
      update doctor_sessions set attempts = attempts + 1 where sid = p_sid;
    end if;
  else
    update doctor_sessions
       set attempts = attempts + 1,
           last_failing_check = p_failing_check
     where sid = p_sid;
  end if;
  return first_success;
end;
$$;

revoke all on function public.doctor_record_attempt(text, boolean, integer, text) from public, anon, authenticated;
