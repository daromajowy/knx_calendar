-- KNX Calendar: wydarzenia kalendarza dla członków tablicy Delitech Kanban.
-- Wymaga tabel kanban_boards i kanban_members z repozytorium daromajowy/kanban.
-- Dostęp ma wyłącznie zalogowany użytkownik z wpisem w kanban_members dla danej tablicy.

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  start_date date not null,
  end_date date not null,
  all_day boolean not null default true,
  start_time time,
  end_time time,
  place text not null default '' check (length(place) <= 200),
  description text not null default '' check (length(description) <= 4000),
  -- ID osób z listy członków tablicy (kanban_boards.data.members[].id)
  people text[] not null default '{}' check (cardinality(people) <= 200),
  color text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  reminder_offset smallint check (reminder_offset in (0, 1, 2, 7)),
  reminder_scope text check (reminder_scope in ('people', 'all')),
  reminder_sent_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null default '' check (length(created_by_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_event_dates check (end_date >= start_date and end_date - start_date <= 366),
  constraint calendar_event_times check (all_day or (start_time is not null and end_time is not null and (end_date > start_date or end_time > start_time))),
  constraint calendar_event_reminder check ((reminder_offset is null) = (reminder_scope is null))
);
create index calendar_events_board_range_idx on public.calendar_events (board_id, start_date, end_date);
create index calendar_events_due_reminder_idx on public.calendar_events (start_date)
  where reminder_offset is not null and reminder_sent_at is null;

-- Pola ustawiane przez serwer: autor, znaczniki czasu i status wysyłki przypomnienia.
create or replace function public.calendar_events_guard()
returns trigger language plpgsql set search_path = '' as $$
declare roster text[];
begin
  -- Browser roles must be members of the event's board (RLS checks this again).
  if current_user in ('anon', 'authenticated') and not exists (select 1 from public.kanban_members m
      where m.board_id = coalesce(old.board_id, new.board_id) and m.user_id = auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_name := coalesce((select m.display_name from public.kanban_members m
      where m.board_id = new.board_id and m.user_id = auth.uid()), '');
    new.created_at := now();
    new.reminder_sent_at := null;
  else
    new.board_id := old.board_id;
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
    -- Zmiana terminu lub przypomnienia planuje wysyłkę od nowa.
    if (new.start_date, new.reminder_offset, new.reminder_scope) is distinct from (old.start_date, old.reminder_offset, old.reminder_scope)
      and auth.role() is distinct from 'service_role' then
      new.reminder_sent_at := null;
    end if;
  end if;
  new.updated_at := now();
  new.title := btrim(new.title);
  new.people := array(select distinct unnest(new.people));
  if cardinality(new.people) > 0 then
    select coalesce(array_agg(x->>'id'), '{}') into roster
      from public.kanban_boards b, jsonb_array_elements(b.data->'members') x where b.id = new.board_id;
    if not new.people <@ roster and (tg_op = 'INSERT' or new.people is distinct from old.people) then
      raise exception 'Unknown participant' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger calendar_events_guard before insert or update on public.calendar_events
  for each row execute function public.calendar_events_guard();

alter table public.calendar_events enable row level security;
revoke all on public.calendar_events from public, anon, authenticated;
grant select, delete on public.calendar_events to authenticated;
grant insert (board_id, title, start_date, end_date, all_day, start_time, end_time, place, description, people, color, reminder_offset, reminder_scope)
  on public.calendar_events to authenticated;
grant update (title, start_date, end_date, all_day, start_time, end_time, place, description, people, color, reminder_offset, reminder_scope)
  on public.calendar_events to authenticated;
grant all on public.calendar_events to service_role;

create policy calendar_member_read on public.calendar_events for select to authenticated
  using (exists (select 1 from public.kanban_members m where m.board_id = calendar_events.board_id and m.user_id = (select auth.uid())));
create policy calendar_member_insert on public.calendar_events for insert to authenticated
  with check (exists (select 1 from public.kanban_members m where m.board_id = calendar_events.board_id and m.user_id = (select auth.uid())));
create policy calendar_member_update on public.calendar_events for update to authenticated
  using (exists (select 1 from public.kanban_members m where m.board_id = calendar_events.board_id and m.user_id = (select auth.uid())))
  with check (exists (select 1 from public.kanban_members m where m.board_id = calendar_events.board_id and m.user_id = (select auth.uid())));
create policy calendar_member_delete on public.calendar_events for delete to authenticated
  using (exists (select 1 from public.kanban_members m where m.board_id = calendar_events.board_id and m.user_id = (select auth.uid())));
