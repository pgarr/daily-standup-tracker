---
title: Invariant Aggregate Refactor Plan — Recurring Blocker Confirmation
created: 2026-07-16
type: refactor-plan
---

# Invariant Aggregate Refactor Plan — Daily Standup Tracker

> Ten dokument to **plan refaktoru**, nie implementacja. Żaden plik produkcyjny nie został zmieniony podczas jego przygotowania. Bazuje na odkryciu domeny zapisanym w `context/domain/01-domain-distillation.md` — tu nie powtarzam całego KROK 0, tylko przywołuję ustalenia potrzebne do decyzji.

## KROK 0 — Kontekst (skrót)

Stack: Astro 6 SSR + Supabase (Postgres/Auth/RLS) + Cloudflare Workers + Anthropic Claude Haiku (fallback: Jaccard). Logika biznesowa żyje w czterech warstwach: DB (`supabase/migrations/*.sql` — CHECK/UNIQUE/RLS/`SECURITY DEFINER`), czyste funkcje domenowe (`src/lib/*.ts`), API routes (`src/pages/api/**/*.ts`, walidacja zod), strony Astro (kompozycja odczytu). Wizja produktu wprost nazywa mechanizm wykrywania powtarzającego się blokera jako różnicujący sygnał: *"the streak + repeated-blocker alert turns a passive log into an active signal — and that signal is what no existing tool provides"* (`context/foundation/prd.md:24`). Aktualna (v3) reguła biznesowa: alert **musi** być potwierdzeniem realnie wykrytego dopasowania — *"the blocker alert fires only upon member confirmation"* (`context/foundation/prd-v3.md:154`), *"Member confirms or dismisses the suggestion; blocker alert fires only on confirmation"* (`context/foundation/prd-v3.md:68`).

## KROK 1 — Lista niezmienników biznesowych

| # | Niezmiennik | Typ reguły | Źródło |
|---|---|---|---|
| 1 | Jeden `StandupEntry` na użytkownika na `submitted_date` | "X powstaje tylko raz na Y" | `supabase/migrations/20260605000002_standup_entries.sql:10` |
| 2 | `did`/`plan` zawsze wymagane, `blockers` opcjonalne | walidacja pola | FR-006, `context/foundation/prd-v3.md:103-104` |
| 3 | Izolacja pozioma: Member widzi tylko swoje wpisy; Team Lead tylko wpisy własnego workspace | dostęp danych | Guardrail, `context/foundation/prd.md:43` |
| 4 | Jeden `Workspace` na użytkownika (brak multi-workspace) | "X ma dokładnie jeden Y" | `supabase/migrations/20260604000000_workspace_member_schema.sql:20` |
| 5 | Co najwyżej jeden Team Lead na workspace | "co najwyżej jeden Y na X" | `workspace_member_schema.sql:27-28` |
| 6 | `WorkspaceInvitation`: token jednorazowy, powiązany z e-mailem, z wygaśnięciem | przejście stanu (pending→accepted), atomowość | `supabase/migrations/20260605000001_accept_invitation_function.sql:9-36` |
| 7 | `BlockerAlert` raz zdecydowany (confirmed/dismissed) jest **niemutowalny** — pierwsza decyzja wygrywa | "operacja jest jednorazowa / dane niezmienne po zapisie" | komentarz: "alerts are immutable (first action wins, ignoreDuplicates=true)", `supabase/migrations/20260607000000_blocker_alerts.sql:21` |
| 8 | **`BlockerAlert` może powstać wyłącznie jako potwierdzenie realnie wykrytego dopasowania** — przejście stanu (brak decyzji) → (`confirmed`\|`dismissed`) wymaga warunku C = `shouldSuggestBlockerMatch(...) === true` w chwili decyzji | "przejście stanu A→B wymaga warunku C" | `context/foundation/prd-v3.md:68,154` |
| 9 | `Streak` nigdy nie jest persystowany — zawsze wyliczany na żywo z `standup_entries` | "dane D nigdy nie są persystowane" | brak pola `streak` w `src/types.ts:1-47`; `src/lib/streak.ts:2` (funkcja czysta) |
| 10 | Wpisy standup mają być składane tylko w dni robocze (pon–pt) | precondition domenowy | komentarz "entries are only submitted on business days", `src/lib/blocker.ts:4` |

## KROK 2 — Klasyfikacja i wybór #1

| # | Niezmiennik | (a) Rdzeniowość | (b) Rozproszenie po warstwach | (c) Egzekwowanie |
|---|---|---|---|---|
| 1 | Jeden entry/dzień | Supporting | 2 warstwy (DB UNIQUE + zod) | **Silne** — DB UNIQUE, błąd `23505` obsłużony jawnie (`src/pages/api/standup/submit.ts:76-79`) |
| 2 | did/plan wymagane | Supporting | 3 warstwy (UI, zod, DB NOT NULL) | **Silne** — redundantnie na 3 poziomach |
| 3 | Izolacja pozioma | Supporting (ale krytyczny NFR) | DB RLS, testowane integracyjnie | **Silne** — pokryte testem `src/__tests__/standup-data-isolation.test.ts:118-161` |
| 4 | Jeden workspace/user | Supporting | 1 warstwa (DB UNIQUE) | **Silne** |
| 5 | Jeden Team Lead/workspace | Supporting | 1 warstwa (częściowy unikalny indeks) | **Silne**, jawnie opisane jako obrona przed TOCTOU |
| 6 | Token zaproszenia jednorazowy | Supporting | 1 miejsce, ale atomowe (`SECURITY DEFINER` + `FOR UPDATE`) | **Silne** — testowane w `src/__tests__/invite-token-security.test.ts:123-155` |
| 7 | BlockerAlert niemutowalny | **Core** (chroni sygnał produktu) | 2 warstwy (DB brak UPDATE policy + `ignoreDuplicates`) | **Silne strukturalnie**, ale *cicho* — patrz KROK 3 |
| **8** | **BlockerAlert powstaje tylko z realnego dopasowania** | **Core — najwyższa** (to *dokładnie* mechanizm nazwany w Vision jako powód istnienia produktu) | Rozsmarowany na 3 warstwy: UI (`dashboard.astro`) liczy sugestię, API (`confirm.ts`/`dismiss.ts`) tylko waliduje format, DB (RLS) sprawdza tylko tożsamość | **Najsłabsze w całym projekcie — de facto tylko UI jest strażnikiem** |
| 9 | Streak niepersystowany | Core (mechanizm formowania nawyku) | 1 warstwa (brak kolumny) | **Silne przez nieobecność** — nie ma czego złamać |
| 10 | Wpisy tylko w dni robocze | Core-adjacent (fundament dla #8 i #9) | 1 miejsce (komentarz) | **Brak — tylko zadeklarowane** |

**Wybór: niezmiennik #8 — "BlockerAlert powstaje wyłącznie jako potwierdzenie realnie wykrytego dopasowania".**

Uzasadnienie: spośród niezmienników o statusie Core (#7, #8, #9, #10), #8 jest jedynym, w którym serwer *nigdy* nie weryfikuje treści reguły — jedynie tożsamość wywołującego i format danych. #7 (niemutowalność) jest egzekwowane strukturalnie przez DB. #9 nie ma się czego naruszyć (brak stanu). #10 jest realnym problemem, ale jest *fundamentem pod* #8 i #9, a nie samym produktem — jego złamanie psuje dokładność #8/#9, ale nie tworzy fałszywego sygnału wprost widocznego dla Team Leada. #8 natomiast, gdy złamany, bezpośrednio fałszuje właśnie to, co według Vision odróżnia produkt od konkurencji: odznakę "⚠ Recurring Blocker" widoczną i w prywatnej historii Membera (`src/components/standup/StandupHistoryList.tsx:60-62`), i w team feed Team Leada (`src/pages/team-feed.astro:200-204`). To najbardziej rdzeniowy I najsłabiej egzekwowany niezmiennik w projekcie.

## KROK 3 — Diagnoza niezmiennika #8

### Gdzie dziś żyje reguła

| Warstwa | Plik:linia | Co robi |
|---|---|---|
| Obliczenie (prawda domenowa) | `src/lib/blocker.ts:14-35` (`shouldSuggestBlockerMatch`) | Jedyne miejsce, które faktycznie umie ocenić "czy to jest to samo dopasowanie" (próg, kolejność dni roboczych, podobieństwo tekstu) |
| UI — jedyny dziś strażnik | `src/pages/dashboard.astro:45-58` | Wywołuje `shouldSuggestBlockerMatch` **tylko przy świeżym submicie** (`isFreshSubmit`), wynik ląduje w zmiennej `showBlockerBanner` używanej wyłącznie do renderu — **nigdzie nie jest przekazywany do API ani zapisywany** |
| UI — przyciski decyzji | `src/pages/dashboard.astro:129-148` | `<form action="/api/blocker/confirm">` i `/api/blocker/dismiss` wysyłają tylko `trigger_date` — żaden dowód, że sugestia rzeczywiście wystąpiła, nie jest przesyłany |
| API `confirm` | `src/pages/api/blocker/confirm.ts:7-9` | Walidacja zod ogranicza się do formatu daty (`regex /^\d{4}-\d{2}-\d{2}$/`) |
| API `confirm` — zapis | `src/pages/api/blocker/confirm.ts:39-61` | Ładuje `workspace_id` członka, po czym **od razu** robi `upsert(..., {status:"confirmed"}, {ignoreDuplicates:true})` — między tymi krokami nie ma żadnego wywołania `shouldSuggestBlockerMatch` ani odczytu `standup_entries` |
| API `dismiss` | `src/pages/api/blocker/dismiss.ts:39-61` | Analogicznie — akceptuje dowolną poprawną datę bez weryfikacji |
| DB RLS `INSERT` | `supabase/migrations/20260607000000_blocker_alerts.sql:22-24` | `WITH CHECK (auth.uid() = user_id AND workspace_id = auth_user_workspace_id())` — sprawdza **tożsamość i przynależność do workspace**, nic o treści dopasowania (RLS nie może wywołać LLM/Jaccard) |
| Odczyt/zaufanie do wyniku (Member) | `src/components/standup/StandupHistoryList.tsx:60-62` | `blockerAlerts.find(a => a.trigger_date === entry.submitted_date && a.status === "confirmed")` — traktuje `status === "confirmed"` jako fakt dowiedziony |
| Odczyt/zaufanie do wyniku (Team Lead) | `src/pages/team-feed.astro:72-78,200-204` | Filtruje `blocker_alerts` po `status = "confirmed"` i renderuje odznakę "⚠ Recurring Blocker" bez żadnej dodatkowej weryfikacji |

### Konkretne luki

1. **Klient jest jedynym strażnikiem treści reguły.** Serwer nigdy nie odtwarza pytania "czy w tym oknie dni rzeczywiście był match" — ufa, że przycisk "Yes, same blocker" pojawił się tylko wtedy, gdy `shouldSuggestBlockerMatch` faktycznie zwróciło `true` po stronie renderującego SSR-a. To prawda *dzisiaj*, bo Astro renderuje `dashboard.astro` po stronie serwera — ale nic nie wiąże konkretnego POST-a do `/api/blocker/confirm` z tym konkretnym wynikiem: dowolny klient (curl, zreplayowany request, przyszły refaktor UI) może wysłać `trigger_date` bez uprzedniej sugestii i dostanie `status: "confirmed"` bez błędu.
2. **Błąd jest połykany, nie zatrzymuje operacji, w dwóch miejscach:**
   - `dashboard.astro:55-56` — jeśli `shouldSuggestBlockerMatch` rzuci (np. Anthropic API padnie), błąd trafia do `console.error` i banner po prostu się nie pokazuje — **degradacja cicha**, zgodna z resztą architektury (`similarity.ts:29-35` ma podobny fallback), ale tu dotyczy samej *decyzji o pokazaniu sugestii*, nie tylko jakości dopasowania.
   - `confirm.ts:52-61` / `dismiss.ts:52-61` — `ignoreDuplicates: true` oznacza, że **drugie wywołanie dla tej samej (user_id, trigger_date) nie zwraca błędu**: `error` zostaje `null`, kod idzie dalej do `return context.redirect("/dashboard")` (`confirm.ts:67`), tak jakby operacja się powiodła — mimo że w bazie nic się nie zmieniło (poprzednia decyzja przetrwała nienaruszona). Użytkownik nie ma żadnego sygnału "to już zostało rozstrzygnięte inaczej".
3. **Niespójne egzekwowanie między warstwami**: DB RLS pilnuje *kto* może wstawić wiersz, ale nie *czy powinien* — a jedyna warstwa, która wie "czy powinien" (`shouldSuggestBlockerMatch`), jest wywoływana wyłącznie po stronie odczytu (SSR render), nigdy po stronie zapisu (API route).

## KROK 4 — Projekt agregatu-strażnika

### Aggregate root: `RecurringBlockerSuggestion`

Reprezentuje domenowe pojęcie "Blocker Match Suggestion" (już nazwane w `context/domain/01-domain-distillation.md` § Ubiquitous Language). To jedyne miejsce, w którym wolno zdecydować, czy transakcja zapisu `BlockerAlert` jest legalna.

```ts
// src/lib/domain/blockerMatchSuggestion.ts
import { shouldSuggestBlockerMatch } from "@/lib/blocker"; // reużyte, nie duplikowane

export class NoMatchDetectedError extends Error {
  readonly code = "NO_MATCH_DETECTED";
  constructor(triggerDate: string) {
    super(`No recurring-blocker match detected for ${triggerDate}; confirmation refused.`);
  }
}

export class AlertAlreadyDecidedError extends Error {
  readonly code = "ALERT_ALREADY_DECIDED";
  constructor(triggerDate: string, existingStatus: "confirmed" | "dismissed") {
    super(`Blocker alert for ${triggerDate} was already ${existingStatus}; decision is immutable.`);
  }
}

interface StandupEntryLike {
  submitted_date: string;
  blockers: string | null;
}

interface ExistingAlert {
  status: "confirmed" | "dismissed";
}

export class RecurringBlockerSuggestion {
  private constructor(
    private readonly workspaceId: string,
    private readonly userId: string,
    private readonly triggerDate: string,
    private readonly isMatch: boolean,
  ) {}

  // Precondition: entries sorted desc by submitted_date (contract already binding on shouldSuggestBlockerMatch).
  static async detect(params: {
    workspaceId: string;
    userId: string;
    triggerDate: string;
    entries: readonly StandupEntryLike[];
    threshold: number;
    similarityFn: (a: string, b: string) => Promise<boolean>;
  }): Promise<RecurringBlockerSuggestion> {
    const isMatch = await shouldSuggestBlockerMatch(params.entries, params.threshold, params.similarityFn);
    return new RecurringBlockerSuggestion(params.workspaceId, params.userId, params.triggerDate, isMatch);
  }

  /** Precondition: no prior decision AND a real match was detected. */
  confirm(existingAlert: ExistingAlert | null): BlockerAlertWrite {
    if (existingAlert) throw new AlertAlreadyDecidedError(this.triggerDate, existingAlert.status);
    if (!this.isMatch) throw new NoMatchDetectedError(this.triggerDate);
    return this.toWrite("confirmed");
  }

  /** Precondition: no prior decision. Dismissing a false-positive suggestion is always legal. */
  dismiss(existingAlert: ExistingAlert | null): BlockerAlertWrite {
    if (existingAlert) throw new AlertAlreadyDecidedError(this.triggerDate, existingAlert.status);
    return this.toWrite("dismissed");
  }

  private toWrite(status: "confirmed" | "dismissed"): BlockerAlertWrite {
    return { workspace_id: this.workspaceId, user_id: this.userId, trigger_date: this.triggerDate, status };
  }
}

export interface BlockerAlertWrite {
  workspace_id: string;
  user_id: string;
  trigger_date: string;
  status: "confirmed" | "dismissed";
}
```

Uwaga projektowa: `confirm()` wymaga realnego dopasowania; `dismiss()` — nie (odrzucenie fałszywego alarmu musi być zawsze legalne, zgodnie z US-02: *"Member confirms or dismisses the suggestion"*, `context/foundation/prd-v3.md:68` — obie opcje są dostępne niezależnie od tego, czy dopasowanie jest "prawdziwe"). Jedyny wspólny precondition obu metod to brak istniejącej decyzji — to właśnie egzekwuje niemutowalność (niezmiennik #7) w jednym miejscu zamiast polegać wyłącznie na cichym `ignoreDuplicates`.

### Repozytorium

```ts
// src/lib/repositories/blockerAlertRepository.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlockerAlertWrite } from "@/lib/domain/blockerMatchSuggestion";

export class PersistenceError extends Error {}

export interface DecisionContext {
  workspaceId: string;
  threshold: number;
  entries: { submitted_date: string; blockers: string | null }[];
  existingAlert: { status: "confirmed" | "dismissed" } | null;
}

export class BlockerAlertRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // Single read path: membership + recent entries + existing decision for this date,
  // fetched together so the route has everything RecurringBlockerSuggestion.detect() needs.
  async loadDecisionContext(userId: string, triggerDate: string): Promise<DecisionContext | null> {
    const [{ data: member }, { data: entries }, { data: existing }] = await Promise.all([
      this.supabase
        .from("workspace_member")
        .select("workspace_id, workspace:workspace_id(alert_threshold)")
        .eq("user_id", userId)
        .maybeSingle(),
      this.supabase
        .from("standup_entries")
        .select("submitted_date, blockers")
        .eq("user_id", userId)
        .lte("submitted_date", triggerDate)
        .order("submitted_date", { ascending: false })
        .limit(60),
      this.supabase
        .from("blocker_alerts")
        .select("status")
        .eq("user_id", userId)
        .eq("trigger_date", triggerDate)
        .maybeSingle(),
    ]);
    if (!member) return null;
    return {
      workspaceId: member.workspace_id,
      threshold: member.workspace?.alert_threshold ?? 2,
      entries: entries ?? [],
      existingAlert: existing ?? null,
    };
  }

  // The DB UNIQUE(user_id, trigger_date) constraint is the true source of atomicity —
  // it is what arbitrates a race between two concurrent confirm() calls, not this method.
  // ignoreDuplicates:true + a post-write existence check turns "silently no-op'd" into
  // a reportable AlertAlreadyDecidedError instead of a false success.
  async save(write: BlockerAlertWrite): Promise<{ inserted: boolean }> {
    const { data, error } = await this.supabase
      .from("blocker_alerts")
      .upsert(write, { onConflict: "user_id,trigger_date", ignoreDuplicates: true })
      .select("id");
    if (error) throw new PersistenceError(error.message);
    return { inserted: (data?.length ?? 0) > 0 };
  }
}
```

**O atomowości**: niezmiennik #8 nie da się w pełni domknąć jedną transakcją SQL, bo `shouldSuggestBlockerMatch` woła zewnętrzne API (Anthropic) — nie da się tego wykonać wewnątrz funkcji Postgresowej `SECURITY DEFINER` (w przeciwieństwie do `accept_invitation()` w `supabase/migrations/20260605000001_accept_invitation_function.sql:9-36`, gdzie cała logika jest czystym SQL i może być zablokowana `FOR UPDATE`). Zamiast tego atomowość samego *zapisu* pozostaje tam, gdzie już jest: `UNIQUE (user_id, trigger_date)` w `blocker_alerts.sql:8` — to ono rozstrzyga wyścig między dwoma równoległymi żądaniami `confirm()`, niezależnie od tego, co każde z nich obliczyło w pamięci. Nowość: przegrany wyścigu dostaje teraz `AlertAlreadyDecidedError` zamiast cichego "sukcesu" (patrz `save()` powyżej, `{ inserted: false }` → mapowane na błąd domenowy w route).

### Cienki route

```ts
// src/pages/api/blocker/confirm.ts (przeprojektowany)
import { RecurringBlockerSuggestion, NoMatchDetectedError, AlertAlreadyDecidedError } from "@/lib/domain/blockerMatchSuggestion";
import { BlockerAlertRepository } from "@/lib/repositories/blockerAlertRepository";
import { haikuSimilarity } from "@/lib/similarity";

export const POST: APIRoute = async (context) => {
  // ...auth + origin checks bez zmian (confirm.ts:12-30)...
  const repo = new BlockerAlertRepository(supabase);
  const ctx = await repo.loadDecisionContext(user.id, result.data.trigger_date);
  if (!ctx) return context.redirect("/workspace/setup");

  try {
    const suggestion = await RecurringBlockerSuggestion.detect({
      workspaceId: ctx.workspaceId,
      userId: user.id,
      triggerDate: result.data.trigger_date,
      entries: ctx.entries,
      threshold: ctx.threshold,
      similarityFn: haikuSimilarity,
    });
    const write = suggestion.confirm(ctx.existingAlert);
    const { inserted } = await repo.save(write);
    if (!inserted) throw new AlertAlreadyDecidedError(result.data.trigger_date, "confirmed");
  } catch (err) {
    if (err instanceof NoMatchDetectedError) {
      return context.redirect(`/dashboard?error=${encodeURIComponent("No matching blocker pattern found")}`);
    }
    if (err instanceof AlertAlreadyDecidedError) {
      return context.redirect(`/dashboard?error=${encodeURIComponent("This blocker was already reviewed")}`);
    }
    return context.redirect(`/dashboard?error=${encodeURIComponent("Failed to record blocker alert")}`);
  }
  return context.redirect("/dashboard");
};
```

`dismiss.ts` — identyczna struktura, wywołuje `suggestion.dismiss(ctx.existingAlert)` (bez `NoMatchDetectedError`, bo dismiss nie ma tego preconditionu).

Egzekucja przenosi się z klienta (dziś: SSR-render `dashboard.astro` jako niepisany kontrakt z formularzem) na serwer (teraz: `RecurringBlockerSuggestion` jako jedyny arbiter). `dashboard.astro:45-58` może opcjonalnie zostać przepisany, by wołać `RecurringBlockerSuggestion.detect(...)` zamiast `shouldSuggestBlockerMatch` bezpośrednio — to nie jest wymagane dla bezpieczeństwa (bo i tak jest to tylko podgląd), ale ujednolica jedno źródło prawdy.

## KROK 5 — Before/After, plan, testy

### Before/After

| Miejsce | Before | After |
|---|---|---|
| `src/pages/dashboard.astro:45-58` | Jedyne miejsce liczące `shouldSuggestBlockerMatch`; wynik używany tylko do UI, błąd cicho łykany | Bez zmian funkcjonalnych (nadal tylko podgląd) — opcjonalnie: woła `RecurringBlockerSuggestion.detect()` zamiast funkcji bezpośrednio, dla spójności nazewnictwa |
| `src/pages/api/blocker/confirm.ts:39-61` | Blind `upsert` po samej walidacji formatu daty i tożsamości | Woła `BlockerAlertRepository.loadDecisionContext` → `RecurringBlockerSuggestion.detect().confirm()` → `repo.save()`; nielegalna operacja = named error → widoczny redirect z `?error=` |
| `src/pages/api/blocker/dismiss.ts:39-61` | Blind `upsert`, `ignoreDuplicates` łyka duplikaty cicho | Woła `.dismiss()`; powtórna decyzja = `AlertAlreadyDecidedError` zamiast cichego "sukcesu" |
| `supabase/migrations/20260607000000_blocker_alerts.sql:1-24` | RLS pilnuje tożsamości/workspace; jedyna warstwa DB | Bez zmian schematu — RLS zostaje jako obrona w głąb (identity + tenancy), `UNIQUE(user_id,trigger_date)` staje się mechanizmem atomowości dla agregatu, nie tylko "ciche ignorowanie" |
| `src/components/standup/StandupHistoryList.tsx:60-62` | Ufa `status==='confirmed'` jako faktowi | Bez zmian kodu — ale gwarancja, której dziś ufa tylko "z założenia", staje się rzeczywiście prawdziwa |
| `src/pages/team-feed.astro:72-78,200-204` | Jak wyżej — Team Lead ufa cudzej decyzji bez zaplecza | Bez zmian kodu — odznaka "⚠ Recurring Blocker" faktycznie znaczy to, co obiecuje PRD |

### Plan faz (test-first, zgodnie z istniejącą dyscypliną projektu — patrz `src/__tests__/blocker-detection.test.ts`, `src/__tests__/invite-token-security.test.ts`)

**Faza 1 — test-first, jednostkowa (bez DB).**
Nowy plik `src/__tests__/blocker-match-suggestion.test.ts`, wzorowany na istniejącym `blocker-detection.test.ts`. Testy najpierw czerwone, potem implementacja `src/lib/domain/blockerMatchSuggestion.ts` do zielonego. `shouldSuggestBlockerMatch` pozostaje niezmieniona i nadal osobno testowana.

Przypadki testowe (legalne):
- **L1** — realne dopasowanie (próg=2, dwa kolejne dni robocze, podobne blokery), brak istniejącej decyzji → `confirm()` zwraca `BlockerAlertWrite{status:"confirmed"}`.
- **L2** — brak dopasowania (za mało wpisów w oknie), brak istniejącej decyzji → `dismiss()` zwraca `BlockerAlertWrite{status:"dismissed"}` (dismiss nie wymaga realnego matcha).
- **L3** — realne dopasowanie, użytkownik i tak wybiera dismiss → `dismiss()` zwraca `status:"dismissed"` (prawo użytkownika do odrzucenia nawet trafnej sugestii).

Przypadki testowe (nielegalne):
- **I1** — brak realnego dopasowania (np. sfałszowana `trigger_date` z dnia bez blokerów) + `confirm()` → rzuca `NoMatchDetectedError`, żaden `BlockerAlertWrite` nie powstaje.
- **I2** — istniejąca decyzja `confirmed` dla (user, date) + ponowne `confirm()` → rzuca `AlertAlreadyDecidedError`.
- **I3** — istniejąca decyzja `dismissed` dla (user, date) + próba `confirm()` (próba "cofnięcia" odrzucenia) → rzuca `AlertAlreadyDecidedError`.
- **I6** — wpisy zostały zedytowane/usunięte po pokazaniu sugestii, więc przeliczone okno już nie spełnia warunku w chwili `confirm()` → `NoMatchDetectedError` (przestarzała sugestia odrzucona).

**Faza 2 — test-first, integracyjna (lokalny Supabase wymagany).**
Nowy plik `src/__tests__/blocker-alert-integrity.test.ts`, wzorowany na `src/__tests__/invite-token-security.test.ts:1-11` (`describe.skipIf(!supabaseAvailable)`, `createServiceClient`/`createUserClient` z `src/__tests__/helpers/supabase-test.ts`). Implementacja `BlockerAlertRepository` powstaje dopiero po napisaniu testów.

Dodatkowe przypadki (wymagają realnej bazy):
- **I4** — dwa równoległe żądania `confirm()` dla tej samej (user, date), oba przechodzą kontrolę w pamięci → tylko jeden wiersz trwały w `blocker_alerts`; przegrany dostaje `{inserted:false}` z repozytorium → `AlertAlreadyDecidedError` w route (regresja na dzisiejsze ciche `ignoreDuplicates`).
- **I5** — próba potwierdzenia dla `user_id` innego niż wywołujący (bezpośrednie wywołanie repo z cudzym tokenem) → blokowane przez istniejącą politykę RLS `blocker_alerts.sql:22-24` (regresja, nie nowa funkcjonalność — upewnia się, że refaktor nic nie osłabił).

**Faza 3 — przełączenie routes.**
`src/pages/api/blocker/confirm.ts` i `dismiss.ts` przechodzą na cienki wzorzec z KROK 4. Zero zmian w kontrakcie HTTP (te same pola formularza, te same ścieżki przekierowań na sukces) — zmienia się wyłącznie ścieżka błędu: z cichego 200-redirect na redirect z czytelnym `?error=`.

**Faza 4 — regresja pełna.**
`npm run test` (Vitest — jednostkowe + integracyjne z lokalnym Supabase), `npm run test:e2e` (Playwright — flow dashboard/team-feed bez zmian UI), `npm run lint`, `npm run typecheck`. Ręczna weryfikacja: dashboard nadal pokazuje banner sugestii, przyciski confirm/dismiss nadal działają dla prawdziwego scenariusza, a próba powtórnego POST-a do już rozstrzygniętego dnia (np. przez cofnięcie w historii przeglądarki i ponowne wysłanie formularza) pokazuje teraz komunikat błędu zamiast cichego "sukcesu".

### Nowe load-bearing nazwy do zarejestrowania

Projekt nie prowadzi scentralizowanego rejestru kontraktów — istniejący wzorzec to sekcja *"Binding Function Contracts"* wewnątrz `plan.md` konkretnej zmiany (por. komentarz `// Contract: context/changes/test-phase-3/plan.md § Binding Function Contracts` w `src/lib/blocker.ts:1`, dotyczący już zarchiwizowanej zmiany). Rekomendacja: nowa zmiana (`context/changes/<change-id>/plan.md`) powinna zawierać analogiczną sekcję z poniższymi nazwami jako wiążącym kontraktem:

- `RecurringBlockerSuggestion` (klasa, `src/lib/domain/blockerMatchSuggestion.ts`)
- `RecurringBlockerSuggestion.detect(...)` (statyczna fabryka)
- `RecurringBlockerSuggestion#confirm(existingAlert)` / `#dismiss(existingAlert)`
- `NoMatchDetectedError`, `AlertAlreadyDecidedError` (błędy domenowe, nazwane, nie generyczne)
- `BlockerAlertRepository` (`src/lib/repositories/blockerAlertRepository.ts`)
- `BlockerAlertRepository#loadDecisionContext(userId, triggerDate)` / `#save(write)`
- Kontrakt zachowany bez zmian: `shouldSuggestBlockerMatch` (`src/lib/blocker.ts:14-35`) — reużyty wewnątrz `detect()`, nie duplikowany.

---

## Podsumowanie

Spośród dziesięciu zidentyfikowanych niezmienników domeny Daily Standup Tracker, ten dokument wybiera i projektuje strażnika dla najbardziej rdzeniowego a zarazem najsłabiej egzekwowanego: reguły, że alert o powtarzającym się blokerze może powstać wyłącznie jako potwierdzenie realnie wykrytego dopasowania, nie dowolnej deklaracji klienta. Diagnoza pokazuje, że dziś jedynym strażnikiem tej reguły jest przeglądarka — serwer (`/api/blocker/confirm`, `/api/blocker/dismiss`) waliduje tylko format daty i tożsamość, nigdy treść dopasowania, a powtórna decyzja jest dziś cicho ignorowana zamiast zgłaszana jako błąd. Projekt wprowadza agregat `RecurringBlockerSuggestion` jako jedyne miejsce oceny legalności przejścia (brak decyzji) → (`confirmed`/`dismissed`), z nazwanymi błędami domenowymi `NoMatchDetectedError` i `AlertAlreadyDecidedError` zamiast cichej aktualizacji stanu, oraz repozytorium `BlockerAlertRepository`, które opiera ostateczną atomowość zapisu na istniejącym ograniczeniu `UNIQUE(user_id, trigger_date)` w bazie — jedynym miejscu, gdzie równoległe żądania mogą być rozstrzygnięte bez transakcji obejmującej zewnętrzne wywołanie LLM. Plan faz jest w pełni test-first, zgodny z już istniejącą dyscypliną testową projektu (testy jednostkowe czystej logiki + testy integracyjne na lokalnym Supabase, wzorowane na `invite-token-security.test.ts`), i nie wymaga żadnej zmiany kontraktu HTTP ani schematu bazy danych — wyłącznie przeniesienia egzekwowania z domyślnego zaufania do klienta na jawny, testowalny agregat po stronie serwera.
