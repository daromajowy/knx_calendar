-- Dedicated Kanban tables. No account credentials or private data in the bundle.
create table public.kanban_boards (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  data jsonb not null default '{"tasks":[],"members":[],"stages":[{"id":"todo","title":"Do zrobienia","color":"#64748b"},{"id":"in_progress","title":"W trakcie","color":"#d97706"},{"id":"done","title":"Zrobione","color":"#0d9488"}]}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint board_data_object check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 2000000)
);

create table public.kanban_members (
  board_id uuid not null references public.kanban_boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 120),
  role text not null check (role in ('admin', 'member')) default 'member',
  primary key (board_id, user_id)
);
create index kanban_members_user_idx on public.kanban_members(user_id);

alter table public.kanban_boards enable row level security;
alter table public.kanban_members enable row level security;
revoke all on public.kanban_boards, public.kanban_members from public, anon, authenticated;
grant select on public.kanban_boards, public.kanban_members to authenticated;
grant all on public.kanban_boards, public.kanban_members to service_role;

-- No recursion: a membership row is only visible to that authenticated user.
-- Provisioning/revocation happens in the trusted dashboard, never in board JSON.
create policy membership_self_read on public.kanban_members for select to authenticated
  using (user_id = (select auth.uid()));
create policy board_member_read on public.kanban_boards for select to authenticated
  using (exists (select 1 from public.kanban_members m where m.board_id = id and m.user_id = (select auth.uid())));

-- The only browser write surface. Membership is immutable to browser roles.
create or replace function public.save_kanban_board(target_board uuid, expected_revision bigint, new_data jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare next_revision bigint;
begin
  if auth.uid() is null or not exists (
    select 1 from public.kanban_members m where m.board_id = target_board and m.user_id = auth.uid()
  ) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if new_data is null or jsonb_typeof(new_data) <> 'object'
    or jsonb_typeof(new_data->'tasks') is distinct from 'array'
    or jsonb_typeof(new_data->'members') is distinct from 'array'
    or jsonb_typeof(new_data->'stages') is distinct from 'array'
    or octet_length(new_data::text) > 2000000
    or jsonb_array_length(new_data->'tasks') > 5000
    or jsonb_array_length(new_data->'members') > 200
    or jsonb_array_length(new_data->'stages') not between 3 and 20
  then raise exception 'Invalid board data' using errcode = '22023'; end if;
  update public.kanban_boards set data = new_data, revision = revision + 1, updated_at = now()
    where id = target_board and revision = expected_revision returning revision into next_revision;
  if not found then raise exception 'Revision conflict' using errcode = '40001'; end if;
  return next_revision;
end;
$$;
revoke all on function public.save_kanban_board(uuid,bigint,jsonb) from public, anon;
grant execute on function public.save_kanban_board(uuid,bigint,jsonb) to authenticated;
