---
title: Anti-Corruption Layer Plan — Auth & Workspace Membership Context
created: 2026-07-16
type: refactor-plan
---

# Anti-Corruption Layer Plan — Daily Standup Tracker

> Plan refaktoru — żaden plik produkcyjny nie został zmieniony podczas jego przygotowania. Kontynuacja `context/domain/01-domain-distillation.md` (mapa domeny) i `context/domain/02-invariant-aggregate-refactor.md` (agregat-strażnik dla BlockerAlert); tu temat jest inny: nie niezmiennik biznesowy, lecz **przeciekająca zależność zewnętrzna** przez granice warstw.

## KROK 0 — Kontekst

Stack: Astro 6 SSR + Supabase (`@supabase/supabase-js` ^2.99.1, `@supabase/ssr` ^0.10.3) + Cloudflare Workers + Anthropic Claude Haiku + Resend (`package.json:19-41`). Warstwy: middleware (`src/middleware.ts`) → API routes (`src/pages/api/**/*.ts`) → strony Astro SSR (`src/pages/**/*.astro`) → komponenty React (wyspy).

Dokumenty bazowe **nie deklarują wprost** "Supabase ma być wymienialny", ale zawierają dwa sygnały, które razem tworzą mocny rozjazd intencja-kod:

1. `context/foundation/test-plan.md:278` — strategia testowa wprost zakłada granicę: *"Supabase auth SDK internals ... that is testing the vendor's library, not our code. **Our responsibility ends at the inputs we pass and the session state we expect back.** Re-evaluate if we wrap the auth calls in custom logic that diverges from the SDK contract."* — to zakłada, że gdzieś istnieje przekład "stan sesji SDK" → "nasz stan". Jak pokazuje KROK 3, dziś taki przekład nie istnieje.
2. `context/foundation/infrastructure.md:90` — nazwane ryzyko: *"`@supabase/ssr` treats Workers as a secondary target. ... Any `@supabase/ssr` upgrade that changes the cookie abstraction internals may break on Workers until the Workers-specific compatibility is verified."* — to jest udokumentowany powód, by trzymać powierzchnię kontaktu z tą biblioteką jak najmniejszą.

## KROK 1 — Identyfikacja przeciekających zależności

| Kandydat | Warstwy, w których żyje | Sygnał |
|---|---|---|
| `@anthropic-ai/sdk` | 1 plik: `src/lib/similarity.ts:1-36` | **Brak przecieku** — jedyny import w całym repo (`grep -rln "@anthropic-ai" src` → tylko ten plik). Dobry kontrprzykład. |
| `resend` | 1 plik: `src/lib/email.ts:1-29` | **Brak przecieku** — analogicznie skontenerowany. |
| `zod` | 12 plików, ale wyłącznie w jednej warstwie (API routes: `src/pages/api/**/*.ts`) | Rozpowszechniony, ale nie przekracza granic warstw (nigdy w `src/lib/*.ts`, nigdy w stronach Astro, nigdy w `types.ts`) — to oczekiwane miejsce dla walidacji na granicy API, nie przeciek. |
| **`@supabase/supabase-js` / `@supabase/ssr`** (konstrukcja klienta, typ `User`, query builder `workspace_member`) | **middleware + wszystkie API routes + strony Astro + `App.Locals`** | **Największy przeciek w repo** — patrz niżej |

### Gdzie żyje przeciek Supabase (plik:linia)

**A. Typ biblioteki wprost w kontrakcie aplikacji** (`App.Locals` to najbliższy odpowiednik "wire contract" w SSR-owej appce — każdy request go czyta):
- `src/env.d.ts:3` — `user: import("@supabase/supabase-js").User | null;`

**B. Konstrukcja klienta** (18 miejsc importuje `createClient` z `@/lib/supabase`, samo w sobie nieproblematyczne — to już jest jeden choke point): `src/middleware.ts:2`, `src/pages/dashboard.astro:3`, `src/pages/team-feed.astro:3`, `src/pages/workspace/members.astro:3`, `src/pages/auth/accept-invite.astro:4`, oraz 13 plików `src/pages/api/**/*.ts` (auth/signin,signup,signout; workspace/create,invite,accept-invite,invite-cancel,update-threshold; standup/submit,update,delete; blocker/confirm,dismiss).

**C. Zduplikowana rekonstrukcja `workspace_member ⋈ workspace`** — ten sam koncept "wczytaj przynależność do workspace" zaimplementowany niezależnie 8 razy, z różnym zestawem kolumn i bez wspólnej funkcji:
- `src/middleware.ts:28-37` — lokalny typ `MemberRow = WorkspaceMember & { workspace: Workspace | null }`, zapytanie `select("*, workspace:workspace_id(*)")`, `const member = memberResult.data as unknown as MemberRow | null;`
- `src/pages/api/workspace/invite.ts:25-31` — **identyczny** kształt typu pod inną nazwą: `type MemberRowWithWorkspace = WorkspaceMember & { workspace: Workspace | null };`, to samo zapytanie, ten sam cast `as unknown as MemberRowWithWorkspace | null`
- `src/pages/api/standup/submit.ts:53-57` — `select("workspace_id")`, bez typu, bez joina
- `src/pages/api/blocker/confirm.ts:39-43` — `select("workspace_id")`, osobna kopia
- `src/pages/api/blocker/dismiss.ts:39-43` — `select("workspace_id")`, kolejna kopia
- `src/pages/api/workspace/update-threshold.ts:39-43` — `select("workspace_id, role")`, jeszcze inny zestaw kolumn
- `src/pages/api/workspace/invite-cancel.ts:34-38` — `select("id, role, workspace_id")`, czwarty wariant
- Każde z powyższych API routes ma komentarz-echo tego samego uzasadnienia: *"API routes skip middleware workspace loading — load it here"* (`invite.ts:24`, `invite-cancel.ts:33`, `update-threshold.ts:38`) — czyli deweloper **wie**, że to duplikat, i za każdym razem świadomie pisze go od nowa zamiast wydzielić.

**D. Niesprawdzone rzutowania surowej odpowiedzi Supabase na typy domenowe** (ten sam wzorzec, różne tabele):
- `src/pages/dashboard.astro:40` — `recentEntries = data as StandupEntry[];`
- `src/pages/dashboard.astro:43` — `blockerAlerts = alertData as BlockerAlert[];`
- `src/pages/team-feed.astro:84` — `members = ((membersResult.data as MemberRow[] | null) ?? [])...`
- `src/pages/team-feed.astro:86` — `(entriesResult.data as StandupEntry[] | null) ?? []`
- `src/pages/team-feed.astro:89` — `(alertsResult.data as BlockerAlert[] | null) ?? []`
- `src/pages/workspace/members.astro:41-42` — `acceptedResult.data as WorkspaceInvitation[]`, `openResult.data as WorkspaceInvitation[]`
- `src/pages/auth/accept-invite.astro:27` — `invite = data as InviteRow | null;` (lokalnie zdefiniowany `InviteRow`, `accept-invite.astro:11-17`)

**E. Jawny, niedokończony TODO dewelopera** (dowód, że stan jest znanym długiem, nie świadomą architekturą):
- `src/middleware.ts:36` — *"No generated Supabase types for this table; remove cast after `npx supabase gen types typescript`"* — sprawdzone: `find . -iname "*database.types*" -o -iname "*supabase*.d.ts"` (poza `node_modules`) **nie zwraca żadnego pliku** — komenda z komentarza nigdy nie została uruchomiona, a obejście (ręczny cast) rozeszło się do co najmniej 8 plików zamiast zostać w jednym.

**F. Konsumenci ufający polu `user.email` biblioteki bez narrowing** (pochodna przecieku A):
- `src/pages/dashboard.astro:84` — `Signed in as <span>{user.email}</span>` — renderuje bez sprawdzenia czy zdefiniowane
- `src/pages/auth/accept-invite.astro:41` — `if (user.email === invite.email)` — decyduje o gałęzi `authState` bez narrowing

## KROK 2 — Klasyfikacja i wybór #1

| Kandydat | (a) Warstwy/pliki dotknięte | (b) Ryzyko/koszt wymiany dziś | (c) Rozjazd intencja-vs-kod |
|---|---|---|---|
| `@anthropic-ai/sdk` | 1 plik | Niskie — wymiana = edycja jednej funkcji | Brak — README wprost deklaruje zamienność i fallback (*"ANTHROPIC_API_KEY is optional... falls back to keyword matching"*, `README.md:71`), kod to dotrzymuje (`src/lib/similarity.ts:14,29-35`) |
| `resend` | 1 plik | Niskie | Brak deklaracji, brak potrzeby |
| `zod` | 12 plików, 1 warstwa | Średnie, ale ograniczone do warstwy walidacji API | Brak — zod na granicy API to zamierzony wzorzec (CLAUDE.md: *"API routes: ... validate input with zod"*) |
| **`@supabase/supabase-js` (`User`) + query builder `workspace_member`** | **~21 plików**: `env.d.ts`, middleware, 13 API routes, 5 stron Astro, 2 komponenty testowe pomocnicze | **Wysokie** — nazwane wprost jako foundation-level ryzyko (`context/foundation/infrastructure.md:90`: upgrade `@supabase/ssr` może złamać cookie handling na Workers) | **Silny** — `test-plan.md:278` zakłada istnienie granicy "SDK state → nasz stan", której kod nie implementuje; `middleware.ts:36` to jawny, niespełniony TODO dewelopera o docelowym rozwiązaniu |

**Wybór: `@supabase/supabase-js` `User` + rekonstrukcja `workspace_member ⋈ workspace`.**

Uzasadnienie: to jedyny kandydat, który jednocześnie (a) przecina dosłownie każdą warstwę aplikacji łącznie z jej najbardziej centralnym kontraktem (`App.Locals.user`), (b) ma udokumentowane ryzyko wymiany/upgrade'u wprost w `infrastructure.md`, i (c) ma jawny ślad w kodzie ("no generated types... remove cast after...") pokazujący, że sam projekt uważa obecny stan za tymczasowy dług, a mimo to dług ten się rozmnożył zamiast zostać spłacony. `@anthropic-ai/sdk` i `resend` są przykładami *dobrze* wykonanej izolacji — służą tu jako kontrast, nie jako kandydaci.

## KROK 3 — Diagnoza

Powtórzenie kluczowych dowodów w formie "przed":

```
// src/middleware.ts:28-37
type MemberRow = WorkspaceMember & { workspace: Workspace | null };
const memberResult = await supabase
  .from("workspace_member")
  .select("*, workspace:workspace_id(*)")
  .eq("user_id", context.locals.user.id)
  .limit(1)
  .maybeSingle();
if (memberResult.error) console.error("[middleware] workspace query failed:", memberResult.error);
// No generated Supabase types for this table; remove cast after npx supabase gen types typescript
const member = memberResult.data as unknown as MemberRow | null;
```

```
// src/pages/api/workspace/invite.ts:25-31 — sam kształt, inna nazwa, bez komentarza o długu
type MemberRowWithWorkspace = WorkspaceMember & { workspace: Workspace | null };
const memberResult = await supabase
  .from("workspace_member")
  .select("*, workspace:workspace_id(*)")
  .eq("user_id", user.id)
  .maybeSingle();
const memberRow = memberResult.data as unknown as MemberRowWithWorkspace | null;
```

To jest dokładnie sygnał z KROK 1 z instrukcji zadania: "zduplikowana rekonstrukcja obiektów/typów biblioteki w kilku miejscach" — dwa pliki niezależnie wynajdują tę samą kompozycję typu i ten sam niebezpieczny cast, zamiast dzielić jedną implementację.

**Przecięcie granicy klient/serwer** w tym repo nie występuje dosłownie (Astro SSR nie wysyła `SupabaseClient` do przeglądarki — `grep -rn "SupabaseClient" src` nie zwraca nic, sam typ nigdy nie jest jawnie importowany). Groźniejszy w tym projekcie jest inny wariant tego samego sygnału: **typ biblioteki w kontrakcie międzywarstwowym** — `App.Locals.user` (`src/env.d.ts:3`) jest typu `@supabase/supabase-js`'s `User`, który ma 24 pola z dokumentacji typów pakietu (`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:360-386`: `id, app_metadata, user_metadata, aud, confirmation_sent_at?, ..., email?: string, phone?: string, ..., identities?, is_anonymous?, factors?, banned_until?`), z czego cała aplikacja realnie czyta tylko dwa: `grep` po `user.id`/`user.email` w `src/**/*.{ts,astro}` (poza testami) zwraca **14 użyć `.id` i 3 użycia `.email`, zero użyć pozostałych 22 pól**. Każdy konsument `context.locals.user`/`Astro.locals.user` (middleware, wszystkie strony chronione, wszystkie API routes) jest formalnie związany kształtem całego wachlarza pól usera Supabase, mimo że potrzebuje dwóch.

**Błąd niespójnie egzekwowany / połykany**: `src/middleware.ts:35` loguje błąd zapytania (`console.error`), ale i tak kontynuuje z `member = null` — brak eskalacji różni się w każdym z 8 miejsc z KROK 1.C (część w ogóle nie loguje błędu zapytania o `workspace_member`, np. `submit.ts:59-61` mapuje błąd na komunikat użytkownika, ale `confirm.ts` i `dismiss.ts` w ogóle nie sprawdzają `memberError` przed użyciem `member.workspace_id` — patrz `src/pages/api/blocker/confirm.ts:39-50`).

## KROK 4 — Projekt ACL

### Value objects (jedyne miejsce wiedzy o kształcie zależności)

```ts
// src/lib/acl/authContext.ts — nowy plik

/** Domain-owned identity shape. The only two fields any consumer in this app has
 *  ever needed from Supabase's 24-field `User` (verified: grep for user.id/user.email
 *  across src/**). Everything else stays behind the adapter. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string; // decision: always present in this domain — see KROK 5 "Open Question"
}

/** Domain-owned membership shape — replaces 8 independently-reconstructed queries. */
export interface WorkspaceMembership {
  readonly workspaceId: string;
  readonly role: "member" | "team_lead";
  readonly workspace: Workspace; // reuses existing src/types.ts:3-8, unchanged
}

export function isTeamLead(membership: WorkspaceMembership | null): boolean {
  return membership?.role === "team_lead";
}

/** Narrow port — the only interface the rest of the app is allowed to depend on. */
export interface AuthContextPort {
  getAuthenticatedUser(): Promise<AuthenticatedUser | null>;
  getWorkspaceMembership(userId: string): Promise<WorkspaceMembership | null>;
}
```

### Adapter (jedyny plik, który poza `src/lib/supabase.ts` wolno importować surowy kształt Supabase)

```ts
// src/lib/acl/supabaseAuthContextAdapter.ts — nowy plik
import type { AstroCookies } from "astro";
import { createClient } from "@/lib/supabase";
import type { AuthContextPort, AuthenticatedUser, WorkspaceMembership } from "./authContext";
import type { Workspace } from "@/types";

export class SupabaseAuthContextAdapter implements AuthContextPort {
  constructor(
    private readonly headers: Headers,
    private readonly cookies: AstroCookies,
  ) {}

  async getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
    const supabase = createClient(this.headers, this.cookies);
    if (!supabase) return null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    // Sole place in the codebase touching @supabase/supabase-js's `User` shape (24 fields).
    // Decision encoded here, not in callers: this domain requires email+password auth
    // only (no phone auth, context/foundation/prd.md:156), so a missing email means
    // the identity is unusable for this app — treat as unauthenticated rather than
    // forwarding `undefined` downstream.
    if (!user.email) return null;
    return { id: user.id, email: user.email };
  }

  async getWorkspaceMembership(userId: string): Promise<WorkspaceMembership | null> {
    const supabase = createClient(this.headers, this.cookies);
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("workspace_member")
      .select("workspace_id, role, workspace:workspace_id(*)")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new MembershipLookupError(error.message);
    if (!data) return null;
    // TODO(gen-types): replace this single cast once `npx supabase gen types typescript`
    // output is wired in (see the now-removed duplicate TODOs this consolidates).
    const row = data as unknown as { workspace_id: string; role: "member" | "team_lead"; workspace: Workspace | null };
    if (!row.workspace) return null;
    return { workspaceId: row.workspace_id, role: row.role, workspace: row.workspace };
  }
}

export class MembershipLookupError extends Error {}
```

Reszta kodu (middleware, API routes, strony Astro) zna wyłącznie `AuthContextPort`, `AuthenticatedUser`, `WorkspaceMembership` — nigdy `@supabase/supabase-js`.

## KROK 5 — Dowód izolacji + before/after

### Wymiana biblioteki dotyka tylko adaptera

Gdyby Supabase Auth/Postgres zostało zastąpione (np. innym BaaS albo własnym API), zmianie ulega wyłącznie:
- `src/lib/supabase.ts` (konstrukcja klienta — już dziś jedyne miejsce importujące `@supabase/ssr`)
- `src/lib/acl/supabaseAuthContextAdapter.ts` (nowy — mapowanie na `AuthenticatedUser`/`WorkspaceMembership`)

Nic więcej — bo `App.Locals`, middleware, 13 API routes i 5 stron Astro po refaktorze operują wyłącznie na `AuthenticatedUser`/`WorkspaceMembership` (typy domenowe zdefiniowane przez aplikację, nie przez bibliotekę). Tabele `standup_entries`, `blocker_alerts`, `workspace_invitation` nie są tu w scope tego ACL (patrz zastrzeżenie w KROK 6) — ich ad hoc casty (KROK 1.D) to ta sama choroba, ale osobny, mniejszy zabieg tego samego rodzaju co `BlockerAlertRepository` zaprojektowany w `context/domain/02-invariant-aggregate-refactor.md` § KROK 4.

### Before/After

| Miejsce | Before | After |
|---|---|---|
| `src/env.d.ts:3` | `user: import("@supabase/supabase-js").User \| null;` | `user: import("@/lib/acl/authContext").AuthenticatedUser \| null;` — zero importu vendor typu |
| `src/middleware.ts:28-42` | Lokalny `MemberRow`, ręczne zapytanie + `as unknown as MemberRow` | `const authContext = new SupabaseAuthContextAdapter(...); context.locals.user = await authContext.getAuthenticatedUser(); ...membership = await authContext.getWorkspaceMembership(user.id)` |
| `src/pages/api/workspace/invite.ts:25-31` | Duplikat identycznego `MemberRowWithWorkspace` + duplikat castu | `const membership = await authContext.getWorkspaceMembership(user.id); if (!isTeamLead(membership)) ...` |
| `src/pages/api/standup/submit.ts:53-57`, `blocker/confirm.ts:39-43`, `blocker/dismiss.ts:39-43`, `workspace/update-threshold.ts:39-43`, `workspace/invite-cancel.ts:34-38` | 5 niezależnych wariantów `select("...")` na `workspace_member` | Każdy woła to samo `authContext.getWorkspaceMembership(user.id)` — jedna implementacja, jeden zestaw kolumn, jedno miejsce do naprawy przy zmianie schematu |
| `src/pages/dashboard.astro:84` | `{user.email}` — brak gwarancji, że zdefiniowane (vendor `email?: string`) | `{user.email}` — bez zmian w UI, ale typ to teraz `AuthenticatedUser.email: string`, gwarancja narzucona raz, w adapterze |
| `src/pages/auth/accept-invite.astro:41` | `user.email === invite.email` na typie `string \| undefined` | Ta sama linia, ale porównanie dwóch `string` — TypeScript przestaje to przepuszczać "przypadkiem" |

**Warstwa UI dostaje gotowe dane domenowe, nie surowy obiekt biblioteki**: żadna strona Astro po refaktorze nie zna pól typu `app_metadata`, `identities`, `factors` itd. — widzi tylko `{ id, email }`.

### Otwarte pytanie rozstrzygnięte kontraktem biblioteki

**Pytanie**: czy `AuthenticatedUser.email` może być pusty/nieobecny? Zależy od kontraktu `@supabase/supabase-js`, gdzie `User.email` jest zadeklarowane jako opcjonalne (`email?: string`, `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:372`) — bo Supabase Auth wspiera też logowanie telefonem, gdzie e-mail bywa nieobecny.

**Rozstrzygnięcie**: dla tej domeny odpowiedź brzmi "nie może być pusty" — PRD wprost ogranicza MVP do *"Authentication: email + password. No social login in MVP"* (`context/foundation/prd.md:156`), więc telefon jako metoda logowania nigdy nie występuje. Decyzja jest zakodowana **w ACL** (`SupabaseAuthContextAdapter.getAuthenticatedUser`, `if (!user.email) return null;`), nie w żadnym API route ani stronie Astro — dzięki temu `dashboard.astro:84` i `accept-invite.astro:41` (dziś ufające temu milcząco) dostają twardą gwarancję typu zamiast przypadkowej poprawności.

## KROK 6 — Weryfikacja i plan

### Kryterium sukcesu (falsyfikowalne)

Po refaktorze:
```
grep -rn "@supabase/supabase-js" src --include=*.ts --include=*.astro
```
powinno zwrócić wyłącznie `src/lib/acl/supabaseAuthContextAdapter.ts` (+ `src/__tests__/helpers/supabase-test.ts` jako zaakceptowany wyjątek — plik testowy jawnie deklaruje swój wyjątkowy status: *"Bypasses RLS. Use ONLY for fixture setup and teardown"*, `src/__tests__/helpers/supabase-test.ts:26-29`, i nie jest częścią żadnej warstwy produkcyjnej).

```
grep -rn 'from("workspace_member")' src --include=*.ts --include=*.astro
```
powinno zwrócić wyłącznie `src/lib/acl/supabaseAuthContextAdapter.ts` (+ test fixtures, jak wyżej).

Nazwy `MemberRow` i `MemberRowWithWorkspace` (dziś zduplikowane w `middleware.ts:28` i `invite.ts:25`) znikają całkowicie z repo.

### Pliki, które dziś znają zależność → i które przestają

| Plik | Dziś zna Supabase `User`/`workspace_member` | Po refaktorze |
|---|---|---|
| `src/env.d.ts` | tak (linia 3) | **nie** |
| `src/middleware.ts` | tak (linie 2,7,28-37) | **nie** — woła `AuthContextPort` |
| `src/pages/api/workspace/invite.ts` | tak (linie 25-31) | **nie** |
| `src/pages/api/standup/submit.ts` | tak (linie 53-57) | **nie** |
| `src/pages/api/blocker/confirm.ts` | tak (linie 39-43) | **nie** |
| `src/pages/api/blocker/dismiss.ts` | tak (linie 39-43) | **nie** |
| `src/pages/api/workspace/update-threshold.ts` | tak (linie 39-43) | **nie** |
| `src/pages/api/workspace/invite-cancel.ts` | tak (linie 34-38) | **nie** |
| `src/pages/api/workspace/create.ts` | pośrednio (insert do `workspace_member`, nie odczyt — poza scope tego ACL, pozostaje) | bez zmian |
| `src/lib/supabase.ts` | tak (konstrukcja klienta) | bez zmian — to już był poprawny choke point |
| `src/lib/acl/supabaseAuthContextAdapter.ts` | — (nowy plik) | **tak — jedyne dozwolone miejsce** |
| `src/pages/dashboard.astro`, `team-feed.astro` (odczyt entries/alerts) | tak, ale inny wątek (KROK 1.D) | bez zmian w tym ACL — osobny refaktor repozytoriów per tabela |

### Plan faz (zgodny z konwencją projektu: `context/changes/<change-id>/plan.md`, test-first tam gdzie projekt już to robi)

**Faza 1** — dodać `src/lib/acl/authContext.ts` i `src/lib/acl/supabaseAuthContextAdapter.ts` obok istniejącego kodu, bez podłączania (dead code, w pełni pokryty testami jednostkowymi mockującymi `createClient`). Zero ryzyka regresji, bo nic jeszcze go nie woła.

**Faza 2** — przepiąć `src/middleware.ts` na adapter; zmienić `src/env.d.ts:3` na `AuthenticatedUser`. To jedno miejsce, łatwe do zweryfikowania e2e (`npm run test:e2e` — istniejące specyfikacje logowania/przekierowań powinny przejść bez zmian, bo kontrakt `context.locals.user.id`/`.email` się nie zmienia, tylko jego typ węższy).

**Faza 3** — przepiąć po kolei 6 API routes z KROK 1.C (`invite.ts`, `submit.ts`, `confirm.ts`, `dismiss.ts`, `update-threshold.ts`, `invite-cancel.ts`) na `authContext.getWorkspaceMembership(user.id)`, usuwając lokalne typy i zapytania jeden po drugim — każda zmiana to osobny, mały commit, testowalny niezależnie istniejącymi testami integracyjnymi (`src/__tests__/standup-data-isolation.test.ts`, `src/__tests__/invite-token-security.test.ts` już weryfikują RLS niezależnie od tego, jak klient wewnętrznie konstruuje zapytanie — powinny przejść bez zmian, co jest dobrym regresyjnym potwierdzeniem, że ACL nic nie zmienił w semantyce, tylko w miejscu, gdzie żyje kod).

**Faza 4** — weryfikacja końcowa: uruchomić dwa greppy z sekcji "Kryterium sukcesu" i potwierdzić zerowy wynik poza adapterem/testami; `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:e2e`.

**Poza zakresem tego ACL** (świadomie odłożone, ten sam wzorzec do powtórzenia później): ad hoc casty `as StandupEntry[]`/`as BlockerAlert[]`/`as WorkspaceInvitation[]` z KROK 1.D — to następny kandydat na repozytorium-per-agregat, analogiczny do `BlockerAlertRepository` już zaprojektowanego w `context/domain/02-invariant-aggregate-refactor.md`.

---

## Podsumowanie

Spośród zależności zewnętrznych repo, `@anthropic-ai/sdk` i `resend` są przykładami poprawnej izolacji (po jednym pliku, zero przecieku), a `zod` jest rozpowszechniony, ale trzyma się jednej warstwy — żaden z nich nie kwalifikuje się jako przeciek. Najgorszym przeciekiem jest `@supabase/supabase-js`: jego typ `User` (24 pola, z czego aplikacja realnie używa dwóch) jest wpisany wprost w `App.Locals` (`src/env.d.ts:3`), najbliższy odpowiednik kontraktu międzywarstwowego w tej architekturze, a wzorzec "wczytaj `workspace_member ⋈ workspace` i rzutuj wynik" jest reimplementowany niezależnie w co najmniej 8 plikach — w dwóch z nich (`middleware.ts` i `invite.ts`) dosłownie identyczny typ pod dwiema różnymi nazwami. Sam kod przyznaje, że to dług: komentarz w `middleware.ts:36` obiecuje "usuń ten cast po wygenerowaniu typów Supabase" — obietnica nigdy niespełniona, a obejście rozmnożyło się zamiast zniknąć — a dokumentacja foundation (`infrastructure.md:90`, `test-plan.md:278`) niezależnie potwierdza, że ta biblioteka jest zarówno ryzykowna przy aktualizacji, jak i miała mieć jasną granicę "SDK vs nasz kod", której nikt nie zbudował. Plan wprowadza wąski port `AuthContextPort` z dwoma typami domenowymi (`AuthenticatedUser`, `WorkspaceMembership`) i jednym adapterem `SupabaseAuthContextAdapter` jako jedynym miejscem znającym kształt biblioteki — reszta z ~21 dotkniętych dziś plików przestaje jej dotykać. Przy okazji ACL rozstrzyga cichy dług typów: opcjonalne `email?: string` z kontraktu Supabase staje się gwarantowanym `string`, bo domena (email+hasło, brak logowania telefonem) na to pozwala — decyzja zakodowana raz, w adapterze, zamiast przypadkowo zakładana w dwóch miejscach UI. Falsyfikowalne kryterium sukcesu (grep po nazwie pakietu i po nazwie tabeli) pozwala zweryfikować zamknięcie przecieku bez dwuznaczności.
