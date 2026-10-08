// KNX Calendar: wysyłka przypomnień e-mail o wydarzeniach.
// Uruchamiana co godzinę przez pg_cron (opis w README). Wysyła o 8:00 czasu polskiego
// w dniu: data rozpoczęcia minus reminder_offset dni. Odbiorcy to osoby z listy tablicy
// Kanban, ale tylko te, których adres należy do konta z wpisem w kanban_members.
//
// Sekrety funkcji (supabase secrets set ...): REMINDER_CRON_SECRET, RESEND_API_KEY, REMINDER_FROM.
// Opcjonalnie CALENDAR_APP_URL. SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY dostarcza Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const TIME_ZONE = 'Europe/Warsaw';
const SEND_HOUR = 8;
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

type CalendarEvent = {
  id: string; board_id: string; title: string; start_date: string; end_date: string; all_day: boolean;
  start_time: string | null; end_time: string | null; place: string; description: string; people: string[];
  reminder_offset: number; reminder_scope: 'people' | 'all';
};
type Member = { id: string; name: string; email: string };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function warsawNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]} ${y}`;
}
function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function message(e: CalendarEvent, people: Member[], appUrl: string) {
  const when = e.start_date === e.end_date ? fmtDate(e.start_date) : `${fmtDate(e.start_date)} – ${fmtDate(e.end_date)}`;
  const time = e.all_day ? 'cały dzień' : `${e.start_time?.slice(0, 5)}–${e.end_time?.slice(0, 5)}`;
  const lines = [
    `Przypomnienie o wydarzeniu w kalendarzu zespołu.`, '',
    e.title, `Termin: ${when}, ${time}`,
    e.place ? `Miejsce: ${e.place}` : '',
    people.length ? `Osoby: ${people.map(p => p.name).join(', ')}` : '',
    e.description ? `\n${e.description}` : '', '',
    `Kalendarz: ${appUrl}`,
  ];
  return { subject: `Przypomnienie: ${e.title} (${fmtDate(e.start_date)})`, text: lines.filter(l => l !== '').join('\n').replace(/\n\n\n+/g, '\n\n') };
}

async function sendMail(apiKey: string, from: string, to: string, subject: string, text: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET') ?? '';
  if (cronSecret.length < 32 || !safeEqual(req.headers.get('x-cron-secret') ?? '', cronSecret)) return json({ error: 'Unauthorized' }, 401);
  const apiKey = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('REMINDER_FROM');
  if (!apiKey || !from) return json({ error: 'Mail provider not configured' }, 500);
  const appUrl = Deno.env.get('CALENDAR_APP_URL') ?? 'https://daromajowy.github.io/knx_calendar/';

  const now = warsawNow();
  if (now.hour < SEND_HOUR) return json({ sent: 0, skipped: 'before send hour' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  // Only events that have not started yet; a reminder planned for a past day still goes out once.
  const { data: candidates, error } = await db.from('calendar_events')
    .select('id,board_id,title,start_date,end_date,all_day,start_time,end_time,place,description,people,reminder_offset,reminder_scope')
    .not('reminder_offset', 'is', null).is('reminder_sent_at', null)
    .gte('start_date', now.date).lte('start_date', addDays(now.date, 7)).limit(500);
  if (error) return json({ error: 'Query failed' }, 500);
  const due = (candidates as CalendarEvent[]).filter(e => addDays(e.start_date, -e.reminder_offset) <= now.date);

  const boards = new Map<string, { members: Member[]; allowed: Set<string> }>();
  async function boardInfo(boardId: string) {
    if (boards.has(boardId)) return boards.get(boardId)!;
    const { data: board } = await db.from('kanban_boards').select('data').eq('id', boardId).single();
    const members: Member[] = (board?.data?.members ?? []).filter((m: Member) => m?.id && m?.email)
      .map((m: Member) => ({ id: m.id, name: m.name, email: String(m.email).trim().toLowerCase() }));
    const { data: grants } = await db.from('kanban_members').select('user_id').eq('board_id', boardId);
    const allowed = new Set<string>();
    for (const g of grants ?? []) {
      const { data } = await db.auth.admin.getUserById(g.user_id);
      if (data.user?.email) allowed.add(data.user.email.toLowerCase());
    }
    const info = { members, allowed };
    boards.set(boardId, info);
    return info;
  }

  let sent = 0, failed = 0;
  for (const e of due) {
    // Claim first so overlapping runs never send twice.
    const { data: claimed } = await db.from('calendar_events').update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', e.id).is('reminder_sent_at', null).select('id');
    if (!claimed?.length) continue;
    const { members, allowed } = await boardInfo(e.board_id);
    const people = members.filter(m => e.people.includes(m.id));
    const to = [...new Set((e.reminder_scope === 'all' ? members : people).map(m => m.email).filter(m => allowed.has(m)))];
    const { subject, text } = message(e, people, appUrl);
    let ok = 0;
    for (const address of to) {
      try { await sendMail(apiKey, from, address, subject, text); ok++; sent++; } catch { failed++; }
    }
    // Nothing delivered: release the claim so the next run retries.
    if (to.length && !ok) await db.from('calendar_events').update({ reminder_sent_at: null }).eq('id', e.id);
  }
  return json({ due: due.length, sent, failed });
});
