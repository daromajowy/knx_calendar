# KNX Calendar

Kalendarz zespołu w widoku całego miesiąca dla użytkowników tablicy [Delitech Kanban](https://github.com/daromajowy/kanban), wzorowany na Google Calendar z Androida.

**Adres:** https://daromajowy.github.io/knx_calendar/

## Funkcje

- Widok miesiąca, wydarzenia wielodniowe jako paski, „+N więcej” przy przepełnionym dniu, przewijanie miesięcy strzałkami lub gestem.
- Dodawanie wydarzenia kliknięciem dnia lub przyciskiem „+”: daty od–do albo liczba dni, godziny lub cały dzień, miejsce, opis, osoby zaangażowane, kolor.
- Kliknięcie wydarzenia otwiera jego pełny rekord z edycją i usuwaniem.
- Przypomnienia e-mail: w dniu wydarzenia, 1 lub 2 dni przed albo tydzień przed, o 8:00 czasu polskiego. Odbiorcy to osoby zaangażowane albo wszyscy użytkownicy tablicy.
- Filtr po osobie, jasny i ciemny motyw.

## Logowanie i dostęp

Kalendarz korzysta z **tego samego projektu Supabase co Kanban** (`assets/config.js` ma te same publiczne identyfikatory co `src/config.public.json` w Kanbanie).

- Logujesz się tym samym e-mailem i hasłem co w Kanbanie. Nie ma osobnych kont ani rejestracji.
- Dostęp ma tylko konto z wpisem w `kanban_members` dla tablicy Kanban. Nadanie i odebranie dostępu do Kanbana działa tak samo dla kalendarza.
- Lista osób (imiona, kolory, adresy e-mail) jest pobierana na żywo z listy członków tablicy Kanban. W kodzie nie ma żadnych użytkowników.
- „Nie pamiętasz hasła?” wysyła link Supabase; nowe hasło obowiązuje w obu aplikacjach.
- Sesja jest trzymana tylko w bieżącej karcie przeglądarki, tak jak w Kanbanie.
- Każde zapytanie sprawdzają reguły RLS w bazie, niezależnie od interfejsu.

## Jednorazowa konfiguracja

### 1. Baza danych

W Supabase → SQL Editor uruchom `supabase/migrations/20261008190000_calendar_events.sql` (albo `supabase db push`). Tworzy tabelę `calendar_events` z regułami RLS opartymi na `kanban_members`. Do tego czasu aplikacja po zalogowaniu pokazuje komunikat o brakującej konfiguracji bazy.

### 2. Adres w Supabase Auth

Supabase → Authentication → URL Configuration → Redirect URLs: dodaj `https://daromajowy.github.io/knx_calendar/`. Potrzebne do linków „Nie pamiętasz hasła?” wysyłanych z kalendarza.

### 3. GitHub Pages

Repozytorium → Settings → Pages → Build and deployment → Source: **GitHub Actions**. Workflow `.github/workflows/pages.yml` sprawdza kod, uruchamia testy i publikuje stronę po każdym pushu do `main`.

### 4. Przypomnienia e-mail

Wysyła je funkcja `supabase/functions/send-calendar-reminders`, uruchamiana co godzinę. Używa [Resend](https://resend.com) (darmowy plan wystarcza; wymaga zweryfikowanej domeny nadawcy). Odbiorcami mogą być tylko adresy kont, które mają dostęp do tablicy.

```bash
supabase functions deploy send-calendar-reminders --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_... REMINDER_FROM="KNX Calendar <kalendarz@twojadomena.pl>" REMINDER_CRON_SECRET=$(openssl rand -hex 32)
```

Następnie w SQL Editor (wstaw ten sam `REMINDER_CRON_SECRET`):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('<REMINDER_CRON_SECRET>', 'knx_reminder_cron_secret');
select cron.schedule('knx-calendar-reminders', '5 * * * *', $$
  select net.http_post(
    url := 'https://dvcaeyzckaqohpzbozum.supabase.co/functions/v1/send-calendar-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'knx_reminder_cron_secret')),
    body := '{}'::jsonb)
$$);
```

Klucze i sekrety trzymaj wyłącznie w Supabase. Nigdy nie wpisuj ich do repozytorium.

## Rozwój

```bash
npm ci
npm run check   # składnia skryptów
npm test        # testy reguł dostępu do calendar_events (PGlite)
python3 -m http.server 8000   # podgląd na http://localhost:8000
```

Strona nie wymaga budowania: `index.html`, `assets/app.css`, `assets/app.js`. Biblioteka `@supabase/supabase-js` 2.117.2 (licencja MIT) jest dołączona w `assets/vendor`, w tej samej wersji co w Kanbanie. `tests/fixtures/kanban_secure.sql` to kopia migracji z repozytorium Kanban, używana tylko w testach.
