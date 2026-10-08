// Granica dostępu do calendar_events: tylko członkowie tablicy Kanban.
// tests/fixtures/kanban_secure.sql to kopia migracji z github.com/daromajowy/kanban.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const alice = '00000000-0000-4000-a000-000000000001';
const bob = '00000000-0000-4000-a000-000000000002';
const outsider = '00000000-0000-4000-a000-000000000003';
const board = '10000000-0000-4000-a000-000000000001';
const other = '10000000-0000-4000-a000-000000000002';
const roster = { tasks: [], stages: [], members: [
  { id: 'p-alice', name: 'Alice', email: 'alice@example.invalid', role: 'Projekt', color: '#6366f1', status: 'active' },
  { id: 'p-carol', name: 'Carol', email: 'carol@example.invalid', role: 'Montaż', color: '#0d9488', status: 'active' },
] };

test('calendar_events authorization boundary', async t => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;`);
  await db.exec(await readFile(new URL('./fixtures/kanban_secure.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261008190000_calendar_events.sql', import.meta.url), 'utf8'));
  await db.query('insert into auth.users values ($1),($2),($3)', [alice, bob, outsider]);
  await db.query('insert into public.kanban_boards(id,name,data) values ($1,$2,$3::jsonb),($4,$5,$3::jsonb)', [board, 'Delitech', JSON.stringify(roster), other, 'Private']);
  await db.query('insert into public.kanban_members(board_id,user_id,display_name,role) values ($1,$2,$3,$4),($5,$6,$7,$8)', [board, alice, 'Alice', 'member', other, bob, 'Bob', 'admin']);

  const as = async (role, sub, fn) => {
    await db.exec('begin');
    try {
      await db.exec('set local role ' + role);
      await db.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [sub, role]);
      return await fn();
    } finally { await db.exec('rollback'); }
  };
  const rejects = (p, code) => assert.rejects(p, e => e.code === code);
  const insert = (b = board, extra = {}) => db.query(
    `insert into public.calendar_events(board_id,title,start_date,end_date,people,reminder_offset,reminder_scope)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [b, extra.title ?? ' Montaż ', extra.start ?? '2026-10-20', extra.end ?? '2026-10-21', extra.people ?? ['p-alice'], extra.offset ?? 1, extra.scope ?? 'people']);

  await t.test('anonymous users cannot read or write', async () => {
    await as('anon', '', () => rejects(db.query('select * from public.calendar_events'), '42501'));
    await as('anon', '', () => rejects(insert(), '42501'));
  });

  await t.test('signed-in non-member cannot create events', async () => {
    await as('authenticated', outsider, () => rejects(insert(), '42501'));
    await as('authenticated', bob, () => rejects(insert(board), '42501'));
  });

  await t.test('member creates an event; server sets author and trims title', async () => {
    await as('authenticated', alice, async () => {
      const row = (await insert()).rows[0];
      assert.equal(row.title, 'Montaż');
      assert.equal(row.created_by, alice);
      assert.equal(row.created_by_name, 'Alice');
      assert.equal(row.reminder_sent_at, null);
    });
  });

  await t.test('only people from the Kanban roster can be assigned', async () => {
    await as('authenticated', alice, () => rejects(insert(board, { people: ['p-unknown'] }), '23514'));
  });

  await t.test('invalid dates, times and reminders are rejected', async () => {
    await as('authenticated', alice, () => rejects(insert(board, { start: '2026-10-21', end: '2026-10-20' }), '23514'));
    await as('authenticated', alice, () => rejects(insert(board, { offset: 3 }), '23514'));
    await as('authenticated', alice, () => rejects(db.query(
      `insert into public.calendar_events(board_id,title,start_date,end_date,all_day,start_time,end_time) values ($1,'X','2026-10-20','2026-10-20',false,'10:00','09:00')`, [board]), '23514'));
  });

  await t.test('browser cannot mark a reminder as sent or move an event to another board', async () => {
    const id = (await db.query(`insert into public.calendar_events(board_id,title,start_date,end_date) values ($1,'Serwis','2026-10-22','2026-10-22') returning id`, [board])).rows[0].id;
    await as('authenticated', alice, () => rejects(db.query('update public.calendar_events set reminder_sent_at = now() where id = $1', [id]), '42501'));
    await as('authenticated', alice, () => rejects(db.query('update public.calendar_events set board_id = $2 where id = $1', [id, other]), '42501'));
    await as('authenticated', bob, async () => {
      assert.equal((await db.query('select * from public.calendar_events')).rows.length, 0);
      assert.equal((await db.query('delete from public.calendar_events where id = $1', [id])).affectedRows, 0);
    });
  });

  await t.test('changing the date re-arms a sent reminder; the sender can mark it sent', async () => {
    const id = (await db.query(`insert into public.calendar_events(board_id,title,start_date,end_date,reminder_offset,reminder_scope) values ($1,'Odbiór','2026-10-23','2026-10-23',1,'all') returning id`, [board])).rows[0].id;
    await as('service_role', '', async () => {
      await db.query('update public.calendar_events set reminder_sent_at = now() where id = $1', [id]);
      assert.notEqual((await db.query('select reminder_sent_at from public.calendar_events where id = $1', [id])).rows[0].reminder_sent_at, null);
    });
    await db.query('update public.calendar_events set reminder_sent_at = now() where id = $1', [id]);
    await as('authenticated', alice, async () => {
      await db.query(`update public.calendar_events set start_date = '2026-10-24', end_date = '2026-10-24' where id = $1`, [id]);
      assert.equal((await db.query('select reminder_sent_at from public.calendar_events where id = $1', [id])).rows[0].reminder_sent_at, null);
      await db.query(`update public.calendar_events set title = 'Odbiór końcowy' where id = $1`, [id]);
    });
  });
});
