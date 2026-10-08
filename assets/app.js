'use strict';
// KNX Calendar: miesięczny kalendarz zespołu dla członków tablicy Delitech Kanban.
// Logowanie i dostęp: ten sam projekt Supabase co Kanban. O dostępie decyduje wpis
// w kanban_members; reguły RLS w bazie sprawdzają każde zapytanie niezależnie od UI.

// ---------- Icons ----------
const I = {
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  text: '<path d="M4 6h16M4 12h16M4 18h10"/>', users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>', edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n]}</svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEX = /^#[0-9a-fA-F]{6}$/;
const safeColor = (c, fallback = '#64748b') => HEX.test(c || '') ? c : fallback;

// ---------- Dates (local YYYY-MM-DD strings; noon avoids DST edges) ----------
const MONTHS = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
const MONTHS_GEN = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
const WD = ['Pn','Wt','Śr','Cz','Pt','So','Nd'];
const WD_LONG = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const today = () => iso(new Date());
const fmtDay = s => { const d = parse(s); return `${WD_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`; };
const fmtShort = s => { const d = parse(s); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()].slice(0, 3)}`; };
const fmtStamp = ts => { const d = new Date(ts); return `${fmtShort(iso(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const daysLabel = n => n === 1 ? '1 dzień' : `${n} dni`;
function fmtRange(e) {
  const n = diffDays(e.start, e.end) + 1;
  const time = e.allDay ? 'cały dzień' : `${e.startTime || '—'}–${e.endTime || '—'}`;
  if (n === 1) return `${fmtDay(e.start)} · ${time}`;
  return `${fmtShort(e.start)} – ${fmtDay(e.end)} · ${daysLabel(n)}${e.allDay ? '' : ' · ' + time}`;
}
function weeksOf(month) {
  const first = parse(month + '-01');
  const start = addDays(month + '-01', -((first.getDay() + 6) % 7)); // Monday first
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

// ---------- Supabase ----------
const cfg = window.KNX_CONFIG || {};
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(cfg.supabaseUrl || '')
  && String(cfg.publishableKey || '').startsWith('sb_publishable_')
  && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(cfg.boardId || '');
// Static GitHub Pages: invite and recovery links arrive as implicit-flow fragments,
// the same way as in the Kanban app. Sessions live only in this browser tab.
const sb = configured && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storage: window.sessionStorage },
}) : null;
const passwordLink = /(?:[?#&])type=(invite|recovery)(?:&|$)/.test(location.hash + location.search);

class AccessDeniedError extends Error {}
const missingTable = err => ['42P01', 'PGRST205'].includes(err?.code);
function dbError(err, fallback) {
  if (missingTable(err)) return new Error('Kalendarz czeka na konfigurację bazy danych. Administrator musi uruchomić migrację calendar_events (opis w README repozytorium).');
  if (err?.code === '42501') return new AccessDeniedError('Brak dostępu. To konto nie jest członkiem tablicy Kanban.');
  if (err?.code === '23514') return new Error('Serwer odrzucił dane wydarzenia. Sprawdź daty, godziny i długość pól.');
  return new Error(fallback);
}

async function verifiedUser() {
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user) return null;
  const { data: membership, error: memberError } = await sb.from('kanban_members')
    .select('role,display_name').eq('board_id', cfg.boardId).eq('user_id', user.id).maybeSingle();
  if (memberError) throw new Error('Nie udało się sprawdzić dostępu. Spróbuj ponownie.');
  if (!membership) throw new AccessDeniedError('To konto nie ma dostępu do tablicy Kanban. Skontaktuj się z administratorem.');
  return { id: user.id, name: membership.display_name, email: (user.email || '').toLowerCase(), role: membership.role };
}

// People come from the live Kanban roster (kanban_boards.data.members).
async function loadRoster() {
  const { data, error } = await sb.from('kanban_boards').select('data').eq('id', cfg.boardId).maybeSingle();
  if (error) throw new Error('Nie udało się pobrać listy osób z tablicy Kanban.');
  if (!data) throw new AccessDeniedError('Brak dostępu do tablicy Kanban.');
  const members = Array.isArray(data.data?.members) ? data.data.members : [];
  return members.filter(m => m && typeof m.id === 'string' && typeof m.name === 'string')
    .map(m => ({ id: m.id, name: m.name.slice(0, 120), email: String(m.email || '').toLowerCase().slice(0, 254), color: safeColor(m.color), status: m.status }));
}

const rowToEvent = r => ({
  id: r.id, title: r.title, start: r.start_date, end: r.end_date, allDay: r.all_day,
  startTime: (r.start_time || '').slice(0, 5), endTime: (r.end_time || '').slice(0, 5),
  place: r.place || '', description: r.description || '', people: r.people || [], color: safeColor(r.color, '#4f46e5'),
  reminder: r.reminder_offset == null ? null : { offset: r.reminder_offset, scope: r.reminder_scope },
  reminderSentAt: r.reminder_sent_at, createdByName: r.created_by_name || '', createdBy: r.created_by,
});
const eventToRow = e => ({
  title: e.title, start_date: e.start, end_date: e.end, all_day: e.allDay,
  start_time: e.allDay ? null : e.startTime, end_time: e.allDay ? null : e.endTime,
  place: e.place, description: e.description, people: e.people, color: e.color,
  reminder_offset: e.reminder ? e.reminder.offset : null, reminder_scope: e.reminder ? e.reminder.scope : null,
});
const COLUMNS = 'id,title,start_date,end_date,all_day,start_time,end_time,place,description,people,color,reminder_offset,reminder_scope,reminder_sent_at,created_by,created_by_name';

async function loadEvents(from, to) {
  const { data, error } = await sb.from('calendar_events').select(COLUMNS)
    .eq('board_id', cfg.boardId).lte('start_date', to).gte('end_date', from).order('start_date').limit(2000);
  if (error) throw dbError(error, 'Nie udało się pobrać wydarzeń. Sprawdź połączenie i spróbuj ponownie.');
  return data.map(rowToEvent);
}
async function loadReminders() {
  const { data, error } = await sb.from('calendar_events').select(COLUMNS)
    .eq('board_id', cfg.boardId).not('reminder_offset', 'is', null).gte('start_date', addDays(today(), -14)).order('start_date').limit(200);
  if (error) throw dbError(error, 'Nie udało się pobrać przypomnień.');
  return data.map(rowToEvent);
}
async function saveEvent(e) {
  const row = eventToRow(e);
  const q = e.id
    ? sb.from('calendar_events').update(row).eq('id', e.id).eq('board_id', cfg.boardId)
    : sb.from('calendar_events').insert({ ...row, board_id: cfg.boardId });
  const { data, error } = await q.select(COLUMNS).single();
  if (error) throw dbError(error, 'Nie zapisano wydarzenia. Sprawdź połączenie i spróbuj ponownie.');
  return rowToEvent(data);
}
async function deleteEvent(id) {
  const { data, error } = await sb.from('calendar_events').delete().eq('id', id).eq('board_id', cfg.boardId).select('id');
  if (error) throw dbError(error, 'Nie usunięto wydarzenia. Spróbuj ponownie.');
  if (!data.length) throw new Error('To wydarzenie zostało już usunięte.');
}

// ---------- State ----------
const COLORS = ['#4f46e5', '#0d9488', '#d97706', '#be3450', '#2563eb', '#7c3aed', '#15803d', '#64748b'];
const OFFSETS = [[0, 'W dniu wydarzenia (8:00)'], [1, '1 dzień przed'], [2, '2 dni przed'], [7, 'Tydzień przed']];
const PREFS_KEY = 'knx-calendar-prefs';
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (_) { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ filter: state.filter, theme: document.documentElement.dataset.theme || '' })); } catch (_) {} };
if (prefs.theme === 'dark' || prefs.theme === 'light') document.documentElement.dataset.theme = prefs.theme;

const state = { user: null, roster: [], events: [], month: today().slice(0, 7), filter: prefs.filter || '', banner: '', loginMessage: '', recovery: passwordLink, busy: false };
const memberById = id => state.roster.find(m => m.id === id);
const myMember = () => state.roster.find(m => m.email && m.email === state.user?.email);
const initials = n => n.trim().slice(0, 2).toUpperCase();
const av = (m, size) => `<span class="avatar" style="background:${safeColor(m.color)}${size ? `;width:${size}px;height:${size}px;font-size:${Math.round(size / 2.6)}px` : ''}">${esc(initials(m.name))}</span>`;
function recipients(e) {
  const list = e.reminder?.scope === 'all' ? state.roster : e.people.map(memberById).filter(Boolean);
  return list.filter(m => m.email);
}

// ---------- Theme ----------
const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
function themeToggle() { document.documentElement.dataset.theme = isDark() ? 'light' : 'dark'; savePrefs(); renderApp(); }

// ---------- Auth flow ----------
const root = document.getElementById('root');
const dlg = document.getElementById('dlg');
let generation = 0, loggingOut = false;

async function verify() {
  if (!sb || loggingOut) return;
  const ticket = ++generation;
  try {
    const user = await verifiedUser();
    if (ticket !== generation) return;
    if (!user) { state.user = null; render(); return; }
    const first = !state.user || state.user.id !== user.id;
    state.user = user; state.loginMessage = '';
    state.roster = await loadRoster();
    if (ticket !== generation) return;
    if (first) render();
    await refreshEvents();
  } catch (err) {
    if (ticket !== generation) return;
    if (err instanceof AccessDeniedError || !state.user) {
      state.user = null; state.loginMessage = err.message; render();
    } else { state.banner = err.message; renderApp(); }
  }
}
async function refreshEvents() {
  if (!state.user) return;
  const weeks = weeksOf(state.month);
  try {
    state.events = await loadEvents(weeks[0][0], weeks[5][6]);
    state.banner = '';
  } catch (err) {
    if (err instanceof AccessDeniedError) { state.user = null; state.loginMessage = err.message; render(); return; }
    state.banner = err.message;
  }
  if (!dlg.open || dlg.dataset.kind !== 'form') renderApp();
}
async function logout() {
  loggingOut = true; ++generation;
  state.user = null; state.events = []; state.roster = []; state.recovery = false;
  if (dlg.open) dlg.close();
  render();
  try { await sb?.auth.signOut({ scope: 'local' }); } finally { loggingOut = false; }
}

function render() {
  if (state.recovery) return renderPasswordGate('recovery');
  if (!state.user) return renderPasswordGate('login');
  renderApp();
}

function renderPasswordGate(mode) {
  if (dlg.open) dlg.close();
  const recovery = mode === 'recovery', reset = mode === 'reset';
  root.innerHTML = `<main class="auth"><form class="auth-card" id="authForm" novalidate>
    <div class="brand"><span class="brand-symbol">${icon('cal')}</span>delitech <span class="slash">/ knx calendar</span></div>
    <div><p class="eyebrow">Kalendarz zespołu</p><h1>${recovery ? 'Ustaw swoje hasło' : reset ? 'Odzyskaj dostęp' : 'Zaloguj się kontem z tablicy Kanban'}</h1></div>
    <p class="note">${recovery ? 'Hasło obowiązuje też w aplikacji Kanban.' : reset ? 'Wyślemy link na adres Twojego konta.' : 'Ten sam e-mail i hasło co w Kanbanie. Dostęp mają tylko członkowie tablicy.'}</p>
    ${!configured ? '<p class="note warn" role="alert">Kalendarz czeka na konfigurację logowania. Skontaktuj się z administratorem.</p>' : ''}
    ${state.loginMessage && !recovery ? `<p class="note warn" role="alert">${esc(state.loginMessage)}</p>` : ''}
    ${!recovery ? '<label class="field">E-mail<input id="aEmail" type="email" autocomplete="username" placeholder="ty@firma.pl" maxlength="254" required></label>' : ''}
    ${!reset ? `<label class="field">${recovery ? 'Nowe hasło (min. 12 znaków)' : 'Hasło'}<input id="aPass" type="password" autocomplete="${recovery ? 'new-password' : 'current-password'}" required></label>` : ''}
    ${recovery ? '<label class="field">Powtórz hasło<input id="aPass2" type="password" autocomplete="new-password" required></label>' : ''}
    <p class="error" id="aErr" role="alert" hidden></p>
    <p class="note" id="aNotice" role="status" hidden></p>
    <button class="btn primary" id="aSubmit" ${configured ? '' : 'disabled'}>${recovery ? 'Zapisz hasło' : reset ? 'Wyślij link' : 'Zaloguj się'} ${icon('right')}</button>
    ${recovery ? '<button type="button" class="text-button" id="aBack">Wróć do logowania</button>'
      : `<button type="button" class="text-button" id="aToggle">${reset ? 'Wróć do logowania' : 'Nie pamiętasz hasła?'}</button>`}
    <p class="hint">Dostęp wyłącznie dla zaproszonych osób z tablicy Kanban.</p>
  </form></main>`;
  const $ = s => root.querySelector(s);
  $('#aToggle')?.addEventListener('click', () => { state.loginMessage = ''; renderPasswordGate(reset ? 'login' : 'reset'); });
  $('#aBack')?.addEventListener('click', () => { state.recovery = false; history.replaceState(null, '', location.pathname); logout(); });
  $('#authForm').onsubmit = async ev => {
    ev.preventDefault();
    if (!sb || state.busy) return;
    const err = $('#aErr'), notice = $('#aNotice'), btn = $('#aSubmit');
    err.hidden = true; notice.hidden = true; state.busy = true; btn.disabled = true;
    try {
      if (recovery) {
        const p = $('#aPass').value;
        if (p.length < 12) throw new Error('Użyj hasła o długości przynajmniej 12 znaków.');
        if (p !== $('#aPass2').value) throw new Error('Hasła nie są jednakowe.');
        const { error } = await sb.auth.updateUser({ password: p });
        if (error) throw new Error('Nie udało się ustawić hasła. Otwórz nowy link odzyskiwania.');
        state.recovery = false; history.replaceState(null, '', location.pathname);
        toast('Hasło zapisane'); await verify();
      } else if (reset) {
        const { error } = await sb.auth.resetPasswordForEmail($('#aEmail').value.trim(), { redirectTo: new URL('.', location.href).href });
        if (error) throw new Error('Nie udało się wysłać linku. Spróbuj ponownie za chwilę.');
        notice.hidden = false; notice.textContent = 'Jeśli konto istnieje, otrzymasz wiadomość z linkiem do ustawienia hasła.';
      } else {
        const email = $('#aEmail').value.trim(), pass = $('#aPass');
        if (!email || !pass.value) throw new Error('Podaj e-mail i hasło.');
        const { error } = await sb.auth.signInWithPassword({ email, password: pass.value });
        pass.value = '';
        if (error) throw new Error('Nie udało się zalogować. Sprawdź e-mail i hasło.');
      }
    } catch (e) { err.hidden = false; err.textContent = e.message || 'Wystąpił błąd. Spróbuj ponownie.'; }
    finally { state.busy = false; if (btn.isConnected) btn.disabled = false; }
  };
}

// ---------- Calendar view ----------
const matchesFilter = e => !state.filter || e.people.includes(state.filter);

function renderApp() {
  if (!state.user || state.recovery) return;
  const [y, m] = state.month.split('-').map(Number);
  const me = myMember() || { name: state.user.name, color: '#6366f1' };
  const upcoming = state.events.filter(e => e.reminder && !e.reminderSentAt && e.start >= today()).length;
  if (state.filter && !memberById(state.filter)) state.filter = '';
  root.innerHTML = `<div class="app">
    <header class="topbar">
      <div class="brand hide-sm"><span class="brand-symbol">${icon('cal')}</span></div>
      <h1 class="month-title" aria-live="polite">${MONTHS[m - 1]} <span class="year">${y}</span></h1>
      <div class="nav"><button class="btn ghost icon-btn" id="prev" aria-label="Poprzedni miesiąc">${icon('left')}</button><button class="btn ghost icon-btn" id="next" aria-label="Następny miesiąc">${icon('right')}</button></div>
      <button class="btn" id="todayBtn">Dziś</button>
      <span class="spacer"></span>
      <div class="top-actions">
        <select class="filter" id="filter" aria-label="Pokaż wydarzenia osoby"><option value="">Wszystkie osoby</option>${state.roster.map(u => `<option value="${esc(u.id)}" ${state.filter === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
        <button class="btn ghost" id="remBtn" aria-label="Przypomnienia e-mail">${icon('mail')}<span class="hide-sm">Przypomnienia</span>${upcoming ? `<span class="badge">${upcoming}</span>` : ''}</button>
        <button class="btn ghost icon-btn" id="themeBtn" aria-label="Zmień motyw">${icon(isDark() ? 'sun' : 'moon')}</button>
        <button class="btn ghost user-btn" id="userBtn" aria-label="Konto">${av(me)}<span class="hide-sm">${esc(state.user.name)}</span></button>
      </div>
    </header>
    ${state.banner ? `<div class="banner error" role="alert">${esc(state.banner)} <button class="btn" id="retry">Spróbuj ponownie</button></div>` : ''}
    <div class="weekdays">${WD.map((d, i) => `<div class="${i > 4 ? 'weekend' : ''}">${d}</div>`).join('')}</div>
    <div class="grid" id="grid"></div>
    <button class="fab" id="fab" aria-label="Dodaj wydarzenie">${icon('plus')}</button>
  </div>`;
  const nav = n => { const d = parse(state.month + '-01'); d.setMonth(d.getMonth() + n); state.month = iso(d).slice(0, 7); renderApp(); refreshEvents(); };
  root.querySelector('#prev').onclick = () => nav(-1);
  root.querySelector('#next').onclick = () => nav(1);
  root.querySelector('#todayBtn').onclick = () => { if (state.month !== today().slice(0, 7)) { state.month = today().slice(0, 7); renderApp(); refreshEvents(); } };
  root.querySelector('#filter').onchange = e => { state.filter = e.target.value; savePrefs(); renderApp(); };
  root.querySelector('#remBtn').onclick = openReminders;
  root.querySelector('#themeBtn').onclick = themeToggle;
  root.querySelector('#userBtn').onclick = openAccount;
  root.querySelector('#retry')?.addEventListener('click', verify);
  root.querySelector('#fab').onclick = () => openForm(null, state.month === today().slice(0, 7) ? today() : state.month + '-01');
  const grid = root.querySelector('#grid');
  let sx = null, sy = null;
  grid.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  grid.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) nav(dx < 0 ? 1 : -1); });
  root.querySelector('.app').onkeydown = e => { if (dlg.open || e.target.matches('input,select,textarea')) return; if (e.key === 'ArrowLeft') nav(-1); if (e.key === 'ArrowRight') nav(1); };
  layoutGrid();
}

function layoutGrid() {
  const grid = document.getElementById('grid'); if (!grid) return;
  const small = matchMedia('(max-width: 640px)').matches;
  const BAR = small ? 15 : 18, GAP = 2, TOP = small ? 34 : 44, MORE = 20;
  const weeks = weeksOf(state.month), now = today();
  grid.innerHTML = weeks.map((w, wi) => `<div class="week" data-w="${wi}">${w.map((day, di) => {
    const cls = ['day', day.slice(0, 7) !== state.month && 'other', day === now && 'today', di > 4 && 'weekend'].filter(Boolean).join(' ');
    return `<div class="${cls}" data-day="${day}" role="button" tabindex="0" aria-label="${fmtDay(day)}, dodaj wydarzenie"><span class="num">${parse(day).getDate()}</span></div>`;
  }).join('')}<div class="bars"></div></div>`).join('');
  const rowH = grid.querySelector('.week').clientHeight;
  const lanesFit = Math.max(1, Math.floor((rowH - TOP - MORE) / (BAR + GAP)));
  grid.querySelectorAll('.week').forEach((row, wi) => {
    const w = weeks[wi], ws = w[0], we = w[6];
    const evs = state.events.filter(e => e.end >= ws && e.start <= we)
      .sort((a, b) => a.start.localeCompare(b.start) || diffDays(b.start, b.end) - diffDays(a.start, a.end) || (a.startTime || '').localeCompare(b.startTime || ''));
    const lanes = [], hidden = Array(7).fill(0); let html = '';
    for (const e of evs) {
      const c0 = Math.max(0, diffDays(ws, e.start)), c1 = Math.min(6, diffDays(ws, e.end));
      let lane = lanes.findIndex(l => l.every(([a, b]) => c1 < a || c0 > b));
      if (lane < 0) { lane = lanes.length; lanes.push([]); }
      lanes[lane].push([c0, c1]);
      if (lane >= lanesFit) { for (let c = c0; c <= c1; c++) hidden[c]++; continue; }
      html += barHtml(e, c0, c1, lane, TOP, BAR, GAP, e.start < ws, e.end > we);
    }
    row.querySelector('.bars').innerHTML = html;
    hidden.forEach((n, c) => { if (n) row.children[c].insertAdjacentHTML('beforeend', `<button class="more" data-more="${w[c]}">+${n} więcej</button>`); });
  });
  grid.querySelectorAll('.day').forEach(el => {
    el.onclick = ev => { if (ev.target.closest('.more')) return; openForm(null, el.dataset.day); };
    el.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openForm(null, el.dataset.day); } };
  });
  grid.querySelectorAll('.more').forEach(b => b.onclick = () => openDay(b.dataset.more));
  grid.querySelectorAll('.bar').forEach(b => b.onclick = ev => { ev.stopPropagation(); openRecord(b.dataset.id); });
}
function barHtml(e, c0, c1, lane, TOP, BAR, GAP, contL, contR) {
  const left = `calc(${c0} * 100% / 7 + 2px)`, width = `calc(${c1 - c0 + 1} * 100% / 7 - 4px)`;
  const cls = ['bar', contL && 'cont-left', contR && 'cont-right', !matchesFilter(e) && 'dim'].filter(Boolean).join(' ');
  const label = (!e.allDay && e.startTime ? e.startTime + ' ' : '') + e.title;
  return `<button class="${cls}" data-id="${esc(e.id)}" style="left:${left};width:${width};top:${TOP + lane * (BAR + GAP)}px;background:${safeColor(e.color)}" title="${esc(e.title)}">${e.reminder ? icon('bell', 'bell') : ''}<span style="overflow:hidden;text-overflow:ellipsis">${esc(label)}</span></button>`;
}
let resizeT; addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(layoutGrid, 120); });

// ---------- Dialogs ----------
function openDialog(kind, html, bind) {
  dlg.dataset.kind = kind; dlg.innerHTML = html;
  if (!dlg.open) dlg.showModal();
  dlg.querySelectorAll('[data-close]').forEach(b => b.onclick = () => dlg.close());
  bind?.();
}
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
const closeBtn = '<button type="button" class="btn ghost icon-btn" data-close aria-label="Zamknij">' + icon('x') + '</button>';
const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? few : many;

function reminderText(e) {
  const rec = recipients(e);
  const when = OFFSETS.find(o => o[0] === e.reminder.offset)?.[1] || '';
  const status = e.reminderSentAt ? `wysłane ${fmtStamp(e.reminderSentAt)}` : `wysyłka ${fmtShort(addDays(e.start, -e.reminder.offset))} o 8:00`;
  return `${esc(when)}, ${status}, ${rec.length} ${plural(rec.length, 'odbiorca', 'odbiorców', 'odbiorców')}: ${esc(rec.map(u => u.email).join(', ') || 'brak adresów')}`;
}

function openRecord(id) {
  const e = state.events.find(x => x.id === id); if (!e) return;
  const people = e.people.map(memberById).filter(Boolean);
  openDialog('record', `<div class="sheet">
    <div class="sheet-head"><span class="rec-stripe" style="background:${safeColor(e.color)}"></span><h2>${esc(e.title)}</h2>${closeBtn}</div>
    <div class="sheet-body"><div class="rec">
      ${icon('clock')}<div class="val"><strong>${esc(fmtRange(e))}</strong></div>
      ${icon('pin')}<div class="val">${e.place ? esc(e.place) : '<span class="muted">Nie podano miejsca</span>'}</div>
      ${icon('text')}<div class="val desc">${e.description ? esc(e.description) : '<span class="muted">Brak opisu</span>'}</div>
      ${icon('users')}<div class="val">${people.length ? `<div class="plist">${people.map(u => `<span class="chip">${av(u)}${esc(u.name)}</span>`).join('')}</div>` : '<span class="muted">Brak zaangażowanych osób</span>'}</div>
      ${icon('bell')}<div class="val">${e.reminder
        ? `<span class="status-pill ${e.reminderSentAt ? 'sent' : 'on'}">${e.reminderSentAt ? 'Przypomnienie wysłane' : 'Przypomnienie włączone'}</span><div class="hint" style="margin-top:6px">${reminderText(e)}</div>`
        : '<span class="status-pill off">Bez przypomnienia</span>'}</div>
    </div>
    ${e.createdByName ? `<p class="hint">Dodane przez ${esc(e.createdByName)}</p>` : ''}
    <div id="confirmSlot"></div></div>
    <div class="sheet-foot"><button class="btn danger" id="del">${icon('trash')}Usuń</button><span class="spacer"></span><button class="btn primary" id="edit">${icon('edit')}Edytuj</button></div>
  </div>`, () => {
    dlg.querySelector('#edit').onclick = () => openForm(e);
    dlg.querySelector('#del').onclick = () => {
      const slot = dlg.querySelector('#confirmSlot');
      slot.innerHTML = `<div class="confirm">Usunąć to wydarzenie dla wszystkich? <span class="spacer"></span><button class="btn" id="no">Anuluj</button><button class="btn primary" id="yes" style="background:var(--danger);border-color:var(--danger)">Usuń</button></div>`;
      slot.querySelector('#no').onclick = () => slot.innerHTML = '';
      slot.querySelector('#yes').onclick = async ev => {
        ev.target.disabled = true;
        try { await deleteEvent(e.id); state.events = state.events.filter(x => x.id !== e.id); dlg.close(); renderApp(); toast('Usunięto wydarzenie'); }
        catch (err) { slot.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      };
    };
  });
}

function openDay(day) {
  const evs = state.events.filter(e => e.start <= day && e.end >= day).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  openDialog('day', `<div class="sheet">
    <div class="sheet-head"><h2 style="text-transform:capitalize">${fmtDay(day)}</h2>${closeBtn}</div>
    <div class="sheet-body"><div class="list">${evs.map(e => `<button class="list-item" data-id="${esc(e.id)}"><span class="dot" style="background:${safeColor(e.color)}"></span><div><div class="t">${esc(e.title)}</div><div class="hint">${e.allDay ? (e.start === e.end ? 'Cały dzień' : `${fmtShort(e.start)} – ${fmtShort(e.end)}`) : `${esc(e.startTime)}–${esc(e.endTime)}`}${e.place ? ' · ' + esc(e.place) : ''}</div></div>${e.reminder ? icon('bell') : ''}</button>`).join('')}</div></div>
    <div class="sheet-foot"><button class="btn primary" id="addHere">${icon('plus')}Dodaj w tym dniu</button></div></div>`, () => {
    dlg.querySelectorAll('[data-id]').forEach(b => b.onclick = () => openRecord(b.dataset.id));
    dlg.querySelector('#addHere').onclick = () => openForm(null, day);
  });
}

function openForm(ev, day) {
  const mine = myMember();
  const e = ev ? structuredClone(ev) : { id: null, title: '', start: day, end: day, allDay: true, startTime: '09:00', endTime: '10:00', place: '', description: '', people: mine ? [mine.id] : [], color: COLORS[0], reminder: null };
  let mode = 'range';
  const n = diffDays(e.start, e.end) + 1;
  // Keep assignments to people who have since left the roster visible, so an edit doesn't drop them silently.
  const gone = e.people.filter(id => !memberById(id));
  openDialog('form', `<form class="sheet" id="evForm" novalidate>
    <div class="sheet-head"><h2>${ev ? 'Edytuj wydarzenie' : 'Nowe wydarzenie'}</h2>${closeBtn}</div>
    <div class="sheet-body">
      <label class="field">Tytuł<input id="fTitle" value="${esc(e.title)}" maxlength="120" placeholder="np. Montaż instalacji KNX" required></label>
      <div style="display:grid;gap:8px">
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span class="field" style="display:block">Czas trwania</span>
          <div class="seg" role="group" aria-label="Sposób podania czasu"><button type="button" id="mRange" aria-pressed="true">Od – do</button><button type="button" id="mDays" aria-pressed="false">Liczba dni</button></div></div>
        <div class="row2"><label class="field">Od<input type="date" id="fStart" value="${e.start}" required></label>
          <label class="field" id="endWrap">Do<input type="date" id="fEnd" value="${e.end}" required></label>
          <label class="field" id="daysWrap" hidden>Liczba dni<input type="number" id="fDays" min="1" max="367" value="${n}"></label></div>
        <p class="hint mono" id="durHint"></p>
        <label class="check"><input type="checkbox" id="fAll" ${e.allDay ? 'checked' : ''}>Cały dzień</label>
        <div class="row2" id="timeRow" ${e.allDay ? 'hidden' : ''}><label class="field">Godzina rozpoczęcia<input type="time" id="fT1" value="${esc(e.startTime || '09:00')}"></label><label class="field">Godzina zakończenia<input type="time" id="fT2" value="${esc(e.endTime || '10:00')}"></label></div>
      </div>
      <label class="field">Miejsce<input id="fPlace" value="${esc(e.place)}" maxlength="200" placeholder="Adres, sala lub link do spotkania"></label>
      <label class="field">Opis<textarea id="fDesc" maxlength="4000" placeholder="Szczegóły, zadania, co zabrać…">${esc(e.description)}</textarea></label>
      <div class="field" style="display:grid">Osoby zaangażowane${state.roster.length ? `<div class="people">${state.roster.map(u => `<label class="person"><input type="checkbox" name="people" value="${esc(u.id)}" ${e.people.includes(u.id) ? 'checked' : ''}>${av(u)}<div><span class="n">${esc(u.name)}</span><small>${esc(u.email || 'brak adresu e-mail')}</small></div></label>`).join('')}</div>` : '<p class="hint">Lista osób z tablicy Kanban jest pusta.</p>'}
        ${gone.length ? `<p class="hint">${gone.length} ${plural(gone.length, 'osoba nie jest', 'osoby nie są', 'osób nie jest')} już na tablicy Kanban i ${gone.length === 1 ? 'zostanie usunięta' : 'zostaną usunięte'} z wydarzenia po zapisie.</p>` : ''}</div>
      <div class="field" style="display:grid">Kolor<div class="swatches">${COLORS.map(c => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-label="Kolor ${c}" aria-pressed="${c === e.color}"></button>`).join('')}</div></div>
      <div class="reminder-box">
        <label class="check"><input type="checkbox" id="fRem" ${e.reminder ? 'checked' : ''}>${icon('bell')}Wyślij przypomnienie e-mailem</label>
        <div id="remOpts" style="display:grid;gap:10px" ${e.reminder ? '' : 'hidden'}>
          <div class="row2"><label class="field">Kiedy<select id="fOff">${OFFSETS.map(([v, l]) => `<option value="${v}" ${e.reminder?.offset === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field">Do kogo<select id="fScope"><option value="people" ${e.reminder?.scope !== 'all' ? 'selected' : ''}>Osoby zaangażowane</option><option value="all" ${e.reminder?.scope === 'all' ? 'selected' : ''}>Wszyscy użytkownicy tablicy</option></select></label></div>
          <p class="hint" id="remHint"></p>
        </div>
      </div>
      <p class="error" id="fErr" role="alert" hidden></p>
    </div>
    <div class="sheet-foot"><button type="button" class="btn" data-close>Anuluj</button><button class="btn primary" id="fSave">${ev ? 'Zapisz zmiany' : 'Dodaj wydarzenie'}</button></div>
  </form>`, () => {
    const $ = s => dlg.querySelector(s);
    const curEnd = () => mode === 'days' ? addDays($('#fStart').value, Math.max(1, parseInt($('#fDays').value || '1', 10)) - 1) : $('#fEnd').value;
    const people = () => [...dlg.querySelectorAll('[name=people]:checked')].map(x => x.value);
    const setMode = m => { mode = m; $('#mRange').setAttribute('aria-pressed', m === 'range'); $('#mDays').setAttribute('aria-pressed', m === 'days'); $('#endWrap').hidden = m !== 'range'; $('#daysWrap').hidden = m !== 'days'; if (m === 'days') $('#fDays').value = Math.max(1, diffDays($('#fStart').value, $('#fEnd').value) + 1); upd(); };
    function upd() {
      const s = $('#fStart').value, en = curEnd();
      $('#durHint').textContent = s && en && en >= s ? `${fmtShort(s)} – ${fmtShort(en)} · ${daysLabel(diffDays(s, en) + 1)}` : 'Data zakończenia nie może być wcześniejsza niż rozpoczęcia.';
      const off = +$('#fOff').value;
      const to = recipients({ people: people(), reminder: { scope: $('#fScope').value } });
      $('#remHint').innerHTML = to.length
        ? `Wysyłka ${s ? fmtShort(addDays(s, -off)) : '—'} o 8:00 na: <strong>${esc(to.map(u => u.email).join(', '))}</strong>. Adresy pochodzą z kont użytkowników tablicy Kanban.`
        : 'Zaznacz osoby zaangażowane z adresem e-mail albo wybierz „Wszyscy użytkownicy tablicy”.';
    }
    $('#mRange').onclick = () => setMode('range'); $('#mDays').onclick = () => setMode('days');
    ['#fStart', '#fEnd', '#fDays', '#fOff', '#fScope'].forEach(s => $(s).oninput = upd);
    dlg.querySelectorAll('[name=people]').forEach(x => x.onchange = upd);
    $('#fAll').onchange = () => $('#timeRow').hidden = $('#fAll').checked;
    $('#fRem').onchange = () => { $('#remOpts').hidden = !$('#fRem').checked; upd(); };
    dlg.querySelectorAll('.swatch').forEach(b => b.onclick = () => { e.color = b.dataset.c; dlg.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', x === b)); });
    upd();
    $('#evForm').onsubmit = async sub => {
      sub.preventDefault();
      const err = $('#fErr'); const fail = m => { err.hidden = false; err.textContent = m; };
      err.hidden = true;
      const title = $('#fTitle').value.trim(), s = $('#fStart').value, en = curEnd();
      if (!title) return fail('Podaj tytuł wydarzenia.');
      if (!s || !en) return fail('Podaj datę rozpoczęcia i zakończenia albo liczbę dni.');
      if (en < s) return fail('Data zakończenia nie może być wcześniejsza niż rozpoczęcia.');
      if (diffDays(s, en) > 366) return fail('Wydarzenie może trwać najwyżej 367 dni.');
      const allDay = $('#fAll').checked;
      if (!allDay && (!$('#fT1').value || !$('#fT2').value)) return fail('Podaj godzinę rozpoczęcia i zakończenia albo zaznacz „Cały dzień”.');
      if (!allDay && s === en && $('#fT2').value <= $('#fT1').value) return fail('Godzina zakończenia musi być późniejsza niż rozpoczęcia.');
      const rem = $('#fRem').checked ? { offset: +$('#fOff').value, scope: $('#fScope').value } : null;
      if (rem && rem.scope === 'people' && !recipients({ people: people(), reminder: rem }).length) return fail('Przypomnienie potrzebuje odbiorców. Zaznacz osoby zaangażowane z adresem e-mail.');
      Object.assign(e, { title, start: s, end: en, allDay, startTime: allDay ? '' : $('#fT1').value, endTime: allDay ? '' : $('#fT2').value, place: $('#fPlace').value.trim(), description: $('#fDesc').value.trim(), people: people(), reminder: rem });
      const btn = $('#fSave'); btn.disabled = true; btn.textContent = 'Zapisywanie…';
      try {
        const saved = await saveEvent(e);
        state.events = state.events.filter(x => x.id !== saved.id).concat(saved);
        dlg.close();
        if (state.month !== s.slice(0, 7)) { state.month = s.slice(0, 7); renderApp(); refreshEvents(); } else renderApp();
        toast(rem ? `Zapisano. Przypomnienie wyjdzie ${fmtShort(addDays(s, -rem.offset))} o 8:00` : 'Zapisano wydarzenie');
      } catch (x) {
        if (x instanceof AccessDeniedError) { dlg.close(); state.user = null; state.loginMessage = x.message; render(); return; }
        fail(x.message); btn.disabled = false; btn.textContent = ev ? 'Zapisz zmiany' : 'Dodaj wydarzenie';
      }
    };
  });
}

async function openReminders() {
  openDialog('reminders', `<div class="sheet"><div class="sheet-head"><h2>Przypomnienia e-mail</h2>${closeBtn}</div><div class="sheet-body"><p class="muted">Wczytywanie…</p></div></div>`);
  let list;
  try { list = await loadReminders(); }
  catch (err) { if (dlg.dataset.kind === 'reminders') dlg.querySelector('.sheet-body').innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  if (!dlg.open || dlg.dataset.kind !== 'reminders') return;
  openDialog('reminders', `<div class="sheet">
    <div class="sheet-head"><div style="flex:1;min-width:0"><h2>Przypomnienia e-mail</h2><p class="hint">Wiadomości wychodzą o 8:00 w zaplanowanym dniu na adresy kont z tablicy Kanban.</p></div>${closeBtn}</div>
    <div class="sheet-body">${list.length ? list.map(e => `<button class="list-item" data-id="${esc(e.id)}"><span class="dot" style="background:${safeColor(e.color)}"></span><div>
        <div class="mail-head"><span class="t">${esc(e.title)}</span><span class="status-pill ${e.reminderSentAt ? 'sent' : 'queued'}">${e.reminderSentAt ? 'Wysłane' : 'Zaplanowane ' + fmtShort(addDays(e.start, -e.reminder.offset))}</span></div>
        <div class="hint">${esc(fmtRange(e))}</div><div class="hint">${reminderText(e)}</div></div></button>`).join('')
      : '<p class="muted">Brak zaplanowanych przypomnień. Zaznacz „Wyślij przypomnienie e-mailem” w wydarzeniu.</p>'}</div></div>`, () => {
    dlg.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
      const e = list.find(x => x.id === b.dataset.id);
      if (!state.events.some(x => x.id === e.id)) state.events.push(e);
      openRecord(e.id);
    });
  });
}

function openAccount() {
  const me = myMember() || { name: state.user.name, color: '#6366f1' };
  openDialog('account', `<div class="sheet">
    <div class="sheet-head"><h2>Konto</h2>${closeBtn}</div>
    <div class="sheet-body"><div style="display:flex;gap:10px;align-items:center">${av(me, 36)}<div><strong>${esc(state.user.name)}</strong><div class="hint">${esc(state.user.email)} · ${state.user.role === 'admin' ? 'administrator' : 'członek'} tablicy Kanban</div></div></div>
      <p class="hint">Hasło zmieniasz tak samo jak w Kanbanie: wyloguj się i użyj opcji „Nie pamiętasz hasła?”.</p></div>
    <div class="sheet-foot"><button class="btn" id="logout">${icon('out')}Wyloguj</button></div></div>`, () => {
    dlg.querySelector('#logout').onclick = logout;
  });
}

let toastT;
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3000); }

// ---------- Boot ----------
if (!sb) { renderPasswordGate('login'); }
else {
  let timer;
  sb.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') { ++generation; state.user = null; state.recovery = false; render(); return; }
    if (event === 'PASSWORD_RECOVERY') { state.recovery = true; render(); return; }
    // Schedule outside the auth callback to avoid nested auth lock waits.
    clearTimeout(timer); timer = setTimeout(verify, 0);
  });
  if (state.recovery) render(); else verify().then(() => { if (!state.user && root.querySelector('.loading-screen')) render(); });
  setInterval(() => { if (!document.hidden && state.user) verify(); }, 60000);
  addEventListener('focus', () => { if (state.user) verify(); });
}
