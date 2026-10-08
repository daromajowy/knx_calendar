# KNX Calendar

Interaktywny kalendarz miesięczny dla użytkowników tablicy [Delitech Kanban](https://github.com/daromajowy/kanban), wzorowany na Google Calendar z Androida.

**Wersja online:** https://daromajowy.github.io/knx_calendar/

## Stan: prototyp

Ten etap to prototyp w jednym pliku `index.html` (HTML, CSS i JavaScript, bez budowania).

- Widok całego miesiąca, wydarzenia wielodniowe jako paski, „+N więcej” przy przepełnionym dniu.
- Dodawanie wydarzenia kliknięciem dnia lub przyciskiem „+”: daty od–do albo liczba dni, godziny lub cały dzień, miejsce, opis, osoby zaangażowane, kolor.
- Kliknięcie wydarzenia otwiera jego pełny rekord z edycją i usuwaniem.
- Przypomnienia e-mail: termin (w dniu, 1 lub 2 dni przed, tydzień przed) i odbiorcy (osoby zaangażowane albo wszyscy użytkownicy tablicy). Kolejka wysyłki w zakładce „Przypomnienia”.
- Filtr po osobie, jasny i ciemny motyw, przewijanie miesięcy gestem na telefonie.

Ograniczenia prototypu: logowanie jest symulowane, użytkownicy i wydarzenia są przykładowe, dane zapisują się tylko w przeglądarce (localStorage), a wysyłka maili jest symulowana.

## Uruchomienie lokalne

Otwórz `index.html` w przeglądarce albo uruchom `python3 -m http.server` i wejdź na http://localhost:8000.

## GitHub Pages

Workflow `.github/workflows/pages.yml` publikuje stronę po każdym pushu do `main`. Jednorazowo w repozytorium: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Plan wersji docelowej

- Logowanie tym samym kontem co w Kanbanie: ten sam projekt Supabase (e-mail i hasło), dostęp tylko dla osób z wpisem w `kanban_members`.
- Wydarzenia w nowej tabeli `calendar_events` z regułami RLS opartymi na członkostwie w tablicy.
- Przypomnienia wysyłane przez zaplanowaną funkcję Supabase (Edge Function + cron) przez dostawcę SMTP, na adresy z kont użytkowników Kanban. Żadnych kluczy ani haseł SMTP w repozytorium.
