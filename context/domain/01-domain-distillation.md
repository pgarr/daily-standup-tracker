---
title: Domain Distillation — Daily Standup Tracker
created: 2026-07-16
type: domain-distillation
---

# Domain Distillation — Daily Standup Tracker

## KROK 0 — Kontekst projektu

Dokumenty źródłowe znalezione w `context/foundation/`:

- `prd.md` — **frontmatter `version: 1`** (`context/foundation/prd.md:3`). Status `draft`. Zawiera dwa nierozstrzygnięte Open Questions (dopasowanie blokerów, streak kalendarzowy vs biznesowy) — `context/foundation/prd.md:174-177`.
- `prd-v2.md` — `version: 2`, oba Open Questions rozstrzygnięte (`context/foundation/prd-v2.md:176-179`).
- `prd-v3.md` — `version: 3`, najnowsza wersja: potwierdzenie dopasowania blokera przez użytkownika (US-02), streak wyłącznie w dniach roboczych, FR-007/FR-008 przywrócone jako must-have (`context/foundation/prd-v3.md:3,60-71,108-112,122`).
- `tech-stack.md`, `roadmap.md`, `README.md` — kontekst stacku i historii zmian.

**Ważne ustalenie już na tym etapie**: plik kanoniczny `context/foundation/prd.md`, do którego odwołuje się nazwa pliku bez sufiksu (ten, który domyślnie czytałby kolejny agent), to **wersja 1 — najbardziej przestarzała**, sprzed rozstrzygnięcia obu Open Questions. Wersje v2/v3 istnieją tylko jako pliki poboczne. Kod (patrz KROK 4) jest zgodny z `prd-v3.md`, nie z `prd.md`. To samo w sobie jest rozjazdem dokumentacyjnym opisanym niżej.

Stack: Astro 6 SSR (`output: "server"`) + wyspy React 19, Supabase (Postgres + Auth + Row Level Security), Cloudflare Workers, Anthropic Claude Haiku do wykrywania podobieństwa blokerów (z fallbackiem), Resend do e-maili zaproszeń (`README.md:14-22`, `src/lib/similarity.ts:13-36`, `src/lib/email.ts:1-29`).

Warstwy, w których żyje logika biznesowa:
1. **Baza danych** (`supabase/migrations/*.sql`) — najsilniejsza warstwa egzekwowania: CHECK, UNIQUE, RLS policies, funkcje `SECURITY DEFINER`. To jedyna warstwa, która faktycznie *nie może* być ominięta przez klienta.
2. **Czyste funkcje domenowe** (`src/lib/streak.ts`, `src/lib/blocker.ts`, `src/lib/similarity.ts`) — obliczenia (streak, dopasowanie bloker-do-bloker), bez efektów ubocznych.
3. **API routes** (`src/pages/api/**/*.ts`) — walidacja (zod), autoryzacja aplikacyjna, orkiestracja zapisów.
4. **Strony Astro** (`src/pages/dashboard.astro`, `src/pages/team-feed.astro`) — kompozycja odczytu, wywołanie funkcji domenowych.

## KROK 1 — Ubiquitous Language

| Pojęcie | Definicja | Cytat źródłowy | Gdzie w kodzie |
|---|---|---|---|
| **Workspace** | Jednostka izolacji zespołu; ma nazwę i próg alertu blokera | "Team Lead can create a workspace" (`context/foundation/prd-v3.md:92-93`) | `supabase/migrations/20260604000000_workspace_member_schema.sql:3-8`; `src/types.ts:3-8` |
| **Member / Team Lead** (role) | Dwie role w workspace; Member widzi tylko swoje wpisy, Team Lead widzi cały feed | "Two roles: Member ... Team Lead" (`context/foundation/prd-v3.md:158-164`) | `src/types.ts:1`; CHECK `role IN ('member','team_lead')` w `supabase/migrations/20260604000000_workspace_member_schema.sql:18` |
| **StandupEntry** | Codzienny wpis: `did` (wymagane), `plan` (wymagane), `blockers` (opcjonalne), przypisany do jednego `submitted_date` | "Member can submit a daily standup (did / plan / optional blockers)" FR-006 (`context/foundation/prd-v3.md:103-104`) | `src/types.ts:18-27`; `supabase/migrations/20260605000002_standup_entries.sql:1-11` |
| **submitted_date** | "The user's local business date" — data dostarczana przez klienta, nie przez serwer | komentarz w kodzie: "submitted_date is the user's local business date, sent from the client" | `src/types.ts:22`; `src/pages/api/standup/submit.ts:11-14`; `src/components/standup/StandupForm.tsx:45` (`new Date().toLocaleDateString("sv")`) |
| **Streak** | Liczba kolejnych dni roboczych z wpisem, licząc od najnowszego; wartość **wyliczana**, nie przechowywana | "Member can see their current streak (consecutive business days logged, Mon–Fri...)" FR-011 (`context/foundation/prd-v3.md:122`) | `src/lib/streak.ts:1-26` (funkcja czysta, brak kolumny `streak` w `src/types.ts`) |
| **Business Day** | Dzień roboczy pon–pt; weekend jest "niewidoczny" dla ciągłości streaku i dopasowania blokerów | "Fri→Mon is next business day" (test) (`src/__tests__/streak.test.ts:20`) | Trzy niezależne implementacje: `src/lib/streak.ts:16-26` (`isImmediateNextBizDay`), `src/lib/blocker.ts:3-12` (`isNextBusinessDay`), `src/pages/team-feed.astro:32-46` (`prevBusinessDay`/`nextBusinessDay`) |
| **Blocker Match Suggestion** | Efemeryczna, nieprzechowywana sugestia "to może być ten sam bloker", wyliczana po świeżym submicie | "system evaluates ... surfaces a match suggestion to the member for confirmation" FR-012 v3 (`context/foundation/prd-v3.md:127-128`) | `src/lib/blocker.ts:14-35` (`shouldSuggestBlockerMatch`); renderowana w `src/pages/dashboard.astro:45-58,109-151`; **nigdy nie zapisywana do bazy** |
| **BlockerAlert** | Trwały rekord potwierdzający lub odrzucający sugerowane dopasowanie; pierwsza decyzja wygrywa (niemutowalny) | "blocker alert fires only on confirmation" (`context/foundation/prd-v3.md:68`); "alerts are immutable (first action wins, ignoreDuplicates=true)" (komentarz w kodzie) | `src/types.ts:29-36`; `supabase/migrations/20260607000000_blocker_alerts.sql:1-24`; `src/pages/api/blocker/confirm.ts:52-61`; `src/pages/api/blocker/dismiss.ts:52-61` |
| **Alert Threshold** | Konfigurowalna przez Team Lead liczba kolejnych dni roboczych z takim samym blokerem, po której pojawia się sugestia (domyślnie 2) | FR-015 (`context/foundation/prd.md:136-137`) | `alert_threshold` w `supabase/migrations/20260604000000_workspace_member_schema.sql:6`; `src/pages/api/workspace/update-threshold.ts:7-13` |
| **WorkspaceInvitation** | Token zaproszenia e-mail, jedno aktywne zaproszenie na parę (workspace, email), wygasa po 7 dniach | FR-004 (`context/foundation/prd.md:95-96`) | `src/types.ts:38-47`; `supabase/migrations/20260605000000_workspace_invitation.sql:1-14` |
| **Team Feed** | Widok Team Leada pokazujący wpisy wszystkich członków dla wybranego dnia, z placeholderem "No standup yet" | FR-013 (`context/foundation/prd.md:130-131`) | `src/pages/team-feed.astro:69-91,224-231` |

## KROK 2 — Klasyfikacja subdomen

| Obszar | Kategoria | Uzasadnienie |
|---|---|---|
| **Blocker Detection & Alerting** (sugestia + potwierdzenie + próg + widoczność w team feed) | **Core** | Wprost nazwane w Vision jako różnicujący sygnał: "streak + repeated-blocker alert turns a passive log into an active signal — and that signal is what no existing tool provides" (`context/foundation/prd.md:24`). To jedyny fragment domeny, który jest *powodem*, dla którego produkt istnieje, a nie tylko CRUD-em na wpisach. |
| **Streak** (wyliczanie ciągłości dni roboczych) | **Core** | Współ-nazwana w Vision jako mechanizm formowania nawyku (`context/foundation/prd.md:24`); FR-011 świadomie utrzymana mimo kontrargumentu "vanity metric" — uznana za centralną (`context/foundation/prd-v3.md:120-122`). |
| **Standup Entry logging (submit/edit/delete)** | **Supporting** | Niezbędne, by Core (streak, blokery) miały dane wejściowe, ale samo w sobie to zwykły CRUD — istnieje w wielu konkurencyjnych narzędziach (Notion, Jira comments) wymienionych explicite jako niewystarczające w Vision (`context/foundation/prd.md:24`). |
| **Team Feed (widok agregujący)** | **Supporting** | Prezentacja danych z Core/Supporting innych obszarów; wartościowa dla US-03, ale nie jest unikalnym mechanizmem domenowym — to widok, nie reguła. |
| **Workspace / Membership / Role / Invitation** | **Supporting** | Warunek konieczny dla działania w trybie zespołowym (US-03), ale to standardowy wzorzec multi-tenant, nie różnicuje produktu. |
| **Auth (Supabase email+password)** | **Generic** | "No social login in MVP" (`context/foundation/prd.md:156`); w pełni oddelegowane do Supabase Auth — zero logiki domenowej. |
| **Email delivery (Resend)** | **Generic** | Wysyłka linku zaproszenia; zamienna usługa infrastrukturalna (`src/lib/email.ts:1-29`), z jawnym trybem degradacji do logowania w konsoli gdy brak klucza. |
| **Similarity evaluation (Claude Haiku / Jaccard fallback)** | **Generic (mechanizm) wspierający Core (decyzja)** | Sam mechanizm dopasowania tekstu (LLM lub Jaccard) jest zamienną technologią — PRD wprost mówi "the similarity evaluation mechanism is a downstream implementation decision" (`context/foundation/prd-v3.md:154`). Reguła *którą to wspiera* (czy bloker się powtarza) jest Core. |

## KROK 3 — Kandydaci na agregaty i niezmienniki

### 1. `StandupEntry` (per user, per workspace)

| Niezmiennik | Cytat | Status |
|---|---|---|
| Jeden wpis na użytkownika na `submitted_date` | UNIQUE constraint w tabeli | **Egzekwowany (DB)** — `UNIQUE (user_id, submitted_date)`, `supabase/migrations/20260605000002_standup_entries.sql:10`; naruszenie (`23505`) mapowane na komunikat "You already submitted a standup today." w `src/pages/api/standup/submit.ts:76-79` |
| `did` i `plan` wymagane, `blockers` opcjonalne | FR-006 (`context/foundation/prd-v3.md:103-104`) | **Egzekwowany** — `NOT NULL` w DB (`standup_entries.sql:6-7`) + zod `min(1)` w `src/pages/api/standup/submit.ts:8-9` + walidacja klienta w `StandupForm.tsx:17-32` |
| Wpis widoczny tylko dla właściciela (poziomo) i Team Leada tego samego workspace | "A member's standup entries are never visible to other members" (Guardrail, `context/foundation/prd.md:43`) | **Egzekwowany (RLS)** — `standup_entries.sql:16-18`, doprecyzowany o Team Leada w `20260627000000_team_feed_rls.sql:4-6`; zweryfikowany testem `src/__tests__/standup-data-isolation.test.ts:118-161` |
| Wpisy przesyłane wyłącznie w dni robocze | komentarz: *"prev is guaranteed to be a weekday (Mon–Fri) since entries are only submitted on business days"* (`src/lib/blocker.ts:4`) | **Deklarowany, ale NIE egzekwowany.** `submit.ts` nie waliduje dnia tygodnia `submitted_date` — pole to surowa data lokalna klienta (`new Date().toLocaleDateString("sv")`, `StandupForm.tsx:45`), a komentarz w `submit.ts:11-13` wprost mówi: *"Server-side clamping is deliberately omitted ... streak integrity relies on user trust at MVP scope"*. Zob. KROK 4.a. |
| Wpisy edytowalne/usuwalne wyłącznie przez właściciela, tylko w macierzystym workspace | S-06 (FR-007/FR-008) | **Egzekwowany (RLS, defence-in-depth)** — `20260627000001_standup_entry_edit_delete.sql` dodaje UPDATE/DELETE, zaostrzone w `20260627000002_standup_entries_update_policy_workspace.sql:6-16` (komentarz: pierwotny `USING` pozwalał na odczyt wierszy ze starego workspace po migracji użytkownika) |

### 2. `Workspace` + `WorkspaceMember`

| Niezmiennik | Cytat | Status |
|---|---|---|
| Jeden użytkownik należy do co najwyżej jednego workspace | "No multi-workspace support" (Non-Goal, `context/foundation/prd.md:171`) | **Egzekwowany (DB)** — `UNIQUE (user_id)` na `workspace_member`, `supabase/migrations/20260604000000_workspace_member_schema.sql:20` |
| Co najwyżej jeden Team Lead na workspace | domyślne z "Role assignment: the user who creates a workspace becomes Team Lead" (`context/foundation/prd.md:165`) | **Egzekwowany (DB)** — częściowy unikalny indeks `workspace_member_one_team_lead_per_workspace ... WHERE role='team_lead'` (`workspace_member_schema.sql:27-28`), jawnie opisany jako obrona przed TOCTOU |
| Brak promocji Member → Team Lead | "Promotion of a Member to Team Lead is a non-goal for MVP" (`context/foundation/prd.md:165`) | **Egzekwowany przez brak** — brak polityki UPDATE na `workspace_member` (`workspace_member_schema.sql:100`) |
| Twórca workspace może dołączyć tylko do pustego workspace (anty-hijacking) | brak wprost w PRD — decyzja implementacyjna | **Egzekwowany** — funkcja `workspace_has_no_members()` jako `WITH CHECK` (`workspace_member_schema.sql:50-54,89-98`) |

### 3. `WorkspaceInvitation`

| Niezmiennik | Cytat | Status |
|---|---|---|
| Jedno aktywne zaproszenie na parę (workspace, email) | domyślne z modelu danych | **Egzekwowany (DB)** — `UNIQUE (workspace_id, email)` (`workspace_invitation.sql:13`) |
| Token jednorazowy, odporny na replay, powiązany z e-mailem, z wygaśnięciem | US: "Invited user can join a workspace by accepting the invite" FR-005 | **Egzekwowany** — `accept_invitation()` blokuje wiersz `FOR UPDATE`, sprawdza `accepted_at IS NULL`, `expires_at > now()`, e-mail z JWT (`accept_invitation_function.sql:9-29`); zweryfikowany testami replay/expiry/wrong-email w `src/__tests__/invite-token-security.test.ts:123-155` |
| Zaakceptowane zaproszenie nie może być usunięte (ghost member) | komentarz migracji | **Egzekwowany** — `20260606000000_guard_invitation_cancel.sql` zawęża DELETE do `accepted_at IS NULL` |

### 4. `BlockerAlert`

| Niezmiennik | Cytat | Status |
|---|---|---|
| Alert niemutowalny — pierwsza decyzja (confirm/dismiss) wygrywa | komentarz: "alerts are immutable (first action wins, ignoreDuplicates=true)" (`blocker_alerts.sql:21`) | **Egzekwowany** — `UNIQUE (user_id, trigger_date)` + brak polityki UPDATE (`blocker_alerts.sql:8,11-24`) + `ignoreDuplicates: true` w `confirm.ts:60`/`dismiss.ts:60` |
| Alert powstaje wyłącznie jako potwierdzenie *rzeczywiście wykrytego* dopasowania | "the blocker alert fires only upon member confirmation" (`context/foundation/prd-v3.md:154`) | **Deklarowany, ale słabo egzekwowany.** `POST /api/blocker/confirm` (`confirm.ts:7-9,52-61`) waliduje jedynie format `trigger_date` (regex) i tożsamość wywołującego (RLS `auth.uid()=user_id`) — **nie przelicza po stronie serwera**, czy `shouldSuggestBlockerMatch` faktycznie zwróciłoby `true` dla tej daty. Sugestia jest liczona wyłącznie po stronie renderowania `dashboard.astro` (`dashboard.astro:45-58`) i nigdy nie jest przechowywana ani weryfikowana przy potwierdzeniu. Zob. KROK 4.d. |

### 5. `Streak` (wartość wyliczana, nie agregat)

Brak własnego niezmiennika do złamania — `streak` nie jest przechowywany (brak kolumny w `src/types.ts:18-27`), tylko liczony na żywo z `standup_entries` przy każdym renderze (`dashboard.astro:61`, `calculateStreak` w `src/lib/streak.ts:2-14`). To eliminuje całą klasę błędów spójności ("stary streak po edycji/usunięciu wpisu") kosztem powielonej logiki dni roboczych (patrz KROK 4.e).

## KROK 4 — Rozjazdy MODEL vs KOD

| # | Dokument mówi | Kod robi | Dowód |
|---|---|---|---|
| **a** | Kanoniczny `context/foundation/prd.md` (v1): wpisy standup są **niemutowalne w v1** — "Submissions are immutable in v1" (FR-007/FR-008 = nice-to-have, cut from MVP) | Kod implementuje pełny edit/delete: RLS UPDATE/DELETE, endpointy `/api/standup/update`, `/api/standup/delete`, UI edycji w `StandupHistoryList.tsx` | `context/foundation/prd.md:106-110` vs `supabase/migrations/20260627000001_standup_entry_edit_delete.sql`, `src/pages/api/standup/update.ts`, `src/pages/api/standup/delete.ts`, `src/components/standup/StandupHistoryList.tsx:104-212`. Kod zgadza się z `context/foundation/prd-v3.md:108-112`, **nie** z plikiem kanonicznym. |
| **b** | `prd.md` (v1): alert blokera "surfaced" automatycznie po dopasowaniu ("a blocker alert is surfaced to the member") — brak wzmianki o potwierdzeniu | Kod wymaga jawnego potwierdzenia przez użytkownika (`Yes, same blocker` / `No, different issue`) zanim cokolwiek zapisze do `blocker_alerts` | `context/foundation/prd.md:60-69` vs `src/pages/dashboard.astro:109-151`, `src/pages/api/blocker/confirm.ts`. Zgodne z `context/foundation/prd-v3.md:60-71,127-128`. |
| **c** | `prd.md` (v1): "Should the streak counter be calendar-days or business-days" — **otwarte pytanie**, nierozstrzygnięte | Kod jednoznacznie implementuje wyłącznie dni robocze (pon–pt), zweryfikowane testami Fri→Mon | `context/foundation/prd.md:177` vs `src/lib/streak.ts:16-26`, `src/__tests__/streak.test.ts:20-27`. Zgodne z `context/foundation/prd-v3.md:122`. |
| **d** | Kod deklaruje (komentarz) niezmiennik: *"prev is guaranteed to be a weekday ... since entries are only submitted on business days"* | Nic w kodzie tego nie wymusza — `submit.ts` przyjmuje surową lokalną datę klienta bez walidacji dnia tygodnia, świadomie ("streak integrity relies on user trust at MVP scope") | `src/lib/blocker.ts:4` (deklaracja) vs `src/pages/api/standup/submit.ts:11-14,67-74` (brak walidacji). Scenariusz awarii: użytkownik otwiera aplikację w sobotę/niedzielę i submituje wpis — `isNextBusinessDay` w `blocker.ts:6` liczy `daysUntilNextBusiness` zakładając, że `prev` to zawsze pon–pt, więc dla `prev`=sobota da błędny wynik (traktuje sobotę jak zwykły dzień: +1 zamiast rozpoznania weekendu). |
| **e** | `roadmap.md`: "Does deleting a standup entry retroactively adjust the streak counter? — Owner: user. Block: no" — pytanie pozostawione otwarte jako decyzja implementacyjna | Pytanie zostało rozstrzygnięte *architekturą*, nie jawną decyzją: streak nigdy nie jest przechowywany (brak pola w `src/types.ts`), więc usunięcie wpisu automatycznie zmienia wynik następnego przeliczenia — nie ma "starego licznika" do skorygowania | `context/foundation/roadmap.md:149` vs `src/lib/streak.ts:2` (funkcja czysta) + `src/pages/dashboard.astro:61` (przeliczenie przy każdym renderze). Zgodność faktyczna, ale nieudokumentowana jako świadoma decyzja. |
| **f** | Domena ma jedno pojęcie "Business Day" (dzień roboczy pon–pt, weekend niewidoczny dla ciągłości) — używane spójnie w PRD v3 dla streaku i dla dopasowania blokerów | Logika dni roboczych jest zaimplementowana **trzykrotnie, niezależnie**: `isImmediateNextBizDay` w `streak.ts`, `isNextBusinessDay` w `blocker.ts`, oraz `prevBusinessDay`/`nextBusinessDay` w `team-feed.astro` — bez wspólnej abstrakcji | `src/lib/streak.ts:16-26` vs `src/lib/blocker.ts:3-12` vs `src/pages/team-feed.astro:26-46`. Ryzyko: poprawka reguły dni roboczych (np. obsługa świąt) w jednym miejscu nie propaguje się do pozostałych dwóch. |
| **g** | `prd-v3.md`: "the blocker alert fires only upon member confirmation" (potwierdzenie *rzeczywistego* wykrytego dopasowania) | `POST /api/blocker/confirm` nie weryfikuje po stronie serwera, że dla podanego `trigger_date` faktycznie istniało wykryte dopasowanie — przyjmuje dowolną poprawną datę i tożsamość wywołującego | `context/foundation/prd-v3.md:154` vs `src/pages/api/blocker/confirm.ts:7-9,52-61` (walidacja ograniczona do formatu daty + RLS `auth.uid()=user_id`). RLS ogranicza blast radius do własnych wpisów użytkownika, ale nie chroni **znaczenia** danych, które Team Lead zobaczy w team feed jako "⚠ Recurring Blocker" (`src/pages/team-feed.astro:200-204`). |

## KROK 5 — Ranking refaktoru

**#1 — `BlockerAlert.confirm` bez server-side re-walidacji dopasowania** (rozjazd g)
- **Wartość**: najwyższa — to *jedyny* mechanizm domenowy nazwany w Vision jako powód istnienia produktu (`context/foundation/prd.md:24`). Jego wiarygodność decyduje o zaufaniu Team Leada do team feed.
- **Ryzyko**: obecnie egzekwowanie ogranicza się do "użytkownik potwierdza coś dla siebie" — nie "użytkownik potwierdza *faktycznie zasugerowane* dopasowanie". Różnica jest niewidoczna w normalnym UI flow (przycisk pojawia się tylko po realnej sugestii), ale nic w warstwie API/DB tego nie gwarantuje — kontrakt między "co UI pokazało" a "co serwer zapisał" jest niejawny.
- **Rekomendacja**: przenieść wywołanie `shouldSuggestBlockerMatch` (lub jego wynik) do punktu potwierdzenia po stronie serwera, albo przechowywać wygenerowaną sugestię z krótkim TTL i weryfikować jej istnienie przy `confirm`.

**#2 — Niewymuszony precondition "wpisy tylko w dni robocze"** (rozjazd d)
- **Wartość**: wysoka — od tego zależą zarówno Streak, jak i Blocker Detection (obie Core).
- **Ryzyko**: świadomie zaakceptowane w MVP ("user trust"), ale komentarz w `blocker.ts:4` zakłada gwarancję, której nic nie daje — to cichy dług, łatwy do przeoczenia przy przyszłych zmianach.
- **Rekomendacja**: jawna decyzja produktowa (czy nadal akceptować zaufanie klienta poza MVP) + ewentualna walidacja serwerowa dnia tygodnia albo test regresyjny pokrywający przypadek weekendowego zapisu.

**#3 — Rozjazd dokumentacyjny: kanoniczny `prd.md` to wersja 1** (rozjazd a, b, c)
- **Wartość**: nie dotyczy kodu wprost, ale wysoka dla *sterowalności projektu* — każdy przyszły agent/dev czytający `context/foundation/prd.md` domyślnie dostanie nieaktualne reguły domenowe (immutable entries, brak potwierdzenia blokera, nierozstrzygnięty streak).
- **Ryzyko**: średnie-wysokie — rozbieżność jest cicha (brak błędu, po prostu złe założenie wejściowe do kolejnych zmian).
- **Rekomendacja**: nadać plikowi `prd.md` status aktualnej wersji (przenieść treść `prd-v3.md` pod kanoniczną nazwę, zarchiwizować v1/v2) lub jawnie oznaczyć `prd.md` jako `status: superseded`.

**#4 — Trzykrotna duplikacja logiki "business day"** (rozjazd f)
- **Wartość**: średnia — dziś zachowanie jest spójne (pokryte osobnymi testami w każdym miejscu), więc nie ma aktywnego buga.
- **Ryzyko**: rośnie przy każdej przyszłej zmianie reguły (np. święta, inna strefa czasowa) — trzy miejsca do zsynchronizowania ręcznie.
- **Rekomendacja**: wydzielić wspólny moduł `businessDay` (`isNextBusinessDay`, `addBusinessDays`) i zastąpić nim trzy niezależne implementacje.

---

## Podsumowanie

Artefakt rekonstruuje domenę Daily Standup Tracker na podstawie PRD (trzech wersji), roadmapy, migracji Supabase i kodu źródłowego, wyprowadzając Ubiquitous Language, klasyfikację Core/Supporting/Generic oraz listę niezmienników wraz ze statusem ich egzekwowania. Core domeny to dokładnie dwa mechanizmy nazwane w Vision jako unikalna wartość produktu: wykrywanie powtarzającego się blokera (z wymaganym potwierdzeniem użytkownika) i streak liczony wyłącznie w dniach roboczych — reszta (workspace, zaproszenia, team feed, auth, e-mail) to Supporting/Generic infrastruktura wokół nich. Najważniejsze odkrycie: plik kanoniczny `context/foundation/prd.md` jest w rzeczywistości najstarszą, już nieaktualną wersją PRD (v1) — kod jest zgodny z `prd-v3.md`, nie z plikiem, który normalnie służy jako źródło prawdy, co jest realnym ryzykiem dla każdej przyszłej pracy opartej na tym dokumencie. Drugie istotne odkrycie dotyczy samego rdzenia domeny: potwierdzenie alertu blokera (`POST /api/blocker/confirm`) nie weryfikuje po stronie serwera, że potwierdzane dopasowanie rzeczywiście zostało wykryte — kontrakt "confirm = potwierdzenie realnej sugestii" istnieje tylko w UI, nie w API. Trzecim wątkiem jest cichy, zadeklarowany-ale-nieegzekwowany precondition "wpisy tylko w dni robocze", od którego zależą obie reguły core, oraz trzykrotna, niezsynchronizowana duplikacja logiki dni roboczych. Ranking refaktoru stawia na pierwszym miejscu wzmocnienie potwierdzenia alertu blokera jako punkt o najwyższej wartości domenowej i realnie najsłabiej dziś strzeżony.
