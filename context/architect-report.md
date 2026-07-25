---
title: Raport architektoniczny — Moduł 4 (10xArchitect)
created: 2026-07-16
type: architect-report
---

# Raport architektoniczny — Moduł 4

## 1. Opisane projekty

| Repo | Stack | Skala (orientacyjnie) | Artefakt |
|---|---|---|---|
| **react** (lokalnie `/home/kaktus/repos/react`, zdalnie `pgarr/react` wg metadanych research.md) | JS (Flow, nie TypeScript — potwierdzone meta-finding w research.md) + Rust (port kompilatora); monorepo z `packages/` (runtime) i `compiler/` | Duży, wieloletni monorepo — repo-map.md: "~13 lat historii"; `shared/` samo ma 646 importów w 27 pakietach | L2 (repo-map.md), L3 (fast-refresh-audit/research.md), L4 (refactor-opportunities/plan.md) |
| **10xdev-dst** ("Daily Standup Tracker", ten projekt) | Astro 6 SSR + React 19 (wyspy) + Supabase (Auth/Postgres/RLS) + Cloudflare Workers + Anthropic Claude Haiku | Mały, greenfield MVP — `target_scale: users: medium, qps: low, data_volume: small` (`context/foundation/prd.md:8-11`) | L5 (context/domain/) |

## 2. Mapa projektu (react, L2)

- **Dwa rdzenie o różnej dynamice.** `compiler/` (port JS→Rust) generuje dziś więcej zmienionych plików niż cały `packages/` razem — to centrum ciężkości pracy, nie peryferia; trend 90-dniowy rośnie (14→...→22 zmian/tydzień).
- **Niewidoczny kręgosłup.** `shared/` (646 importów / 27 pakietów) jest importowany przez symlink workspaces i **nie widnieje** w formalnym grafie `bundles.js` — realna zależność bez formalnego śladu.
- **Strefa ryzyka #1: Fast Refresh / `ReactFiberHotReloading.js`.** Bus factor ≈ 1 (Sophie Alpert), leży w strukturalnym cyklu importów runtime, poprzedni fix (#30660) zrewertowany — stąd wybór tego przepływu do L3.
- **Rozjazd struktura-vs-aktywność.** `packages/react` ma niski churn (21 zmian/90d), ale jest jedyną wspólną zależnością praktycznie wszystkich bundli — niska częstość zmian nie znaczy niskie ryzyko.
- **Największy unknown:** brak grafu importów dla `react-dom`, `react-dom-bindings`, `react-devtools-shared`, `react-native-renderer`, `react-server-dom-*` — sprzężenia tam znane tylko z co-change git log, nie z importów.

## 3. Analiza ficzera (react, L3)

**Wybrany przepływ:** Fast Refresh (`ReactFiberHotReloading.js`) — bezpośrednio z powodu strefy ryzyka #1 z mapy (bus factor, żywy cykl, zrewertowany fix).

**Feature overview:** Edytor zapisuje plik → bundler (poza repo) reewaluuje moduł → Babel-owy `$RefreshReg$` rejestruje typ w `ReactFreshRuntime.js` (`react-refresh`, silnik decyzyjny). `canPreserveStateBetween` decyduje update-vs-remount; reconciler (`ReactFiberHotReloading.js`) wykonuje to na fiberach. Stan zmienia się na trzy sposoby: **remount** (utrata stanu, `remountFiber`), **update w miejscu** (`resolveTypeForHotReloading`, 6 potwierdzonych call-site'ów), **bailout** (nic się nie dzieje). Dwa pakiety łączy wyłącznie duck-typing na globalnym hooku DevTools, nie import statyczny.

**Technical debt (3 potwierdzone ryzyka):**
1. **Kruche sprzężenie przez duck-typing** — kontrakt `scheduleRefresh`/`scheduleRoot`/`setRefreshHandler` weryfikowany tylko `typeof x === 'function'`; zmiana sygnatury łamie to cicho w runtime, bez błędu kompilacji poza monorepo.
2. **Luka w bramce kompatybilności — `scheduleRoot` nigdy nie jest sprawdzany** — potwierdzone ast-grep + grep krzyżowo (research.md § Weryfikacja strukturalna, poz. 16): bramka w `ReactFreshRuntime.js:485-486,499-500` sprawdza tylko `scheduleRefresh`/`setRefreshHandler`; renderer z zepsutym `scheduleRoot` przechodzi bramkę i wybucha dopiero w ścieżce odzyskiwania zepsutego roota.
3. **Jeden punkt pokrycia testowego** — cała logika Fast Refresh w reconcilerze testowana wyłącznie przez pakiet `react-refresh` (zero testów pod `react-reconciler/src/__tests__/` wspominających "hot reload", potwierdzone grepem — prawdziwe zero).

Meta-finding metodologiczny: `ast-grep --lang js` na tym repo (kod Flow) cicho gubi realne call-site'y (błędy parsera tree-sitter na składni Flow) — grep okazał się bardziej wiarygodny dla wyczerpujących liczności.

## 4. Plan refaktoryzacji (react, L4)

**Co refaktoryzowane:** zamknięcie potwierdzonej luki #2 z L3 — bramka kompatybilności w `injectIntoGlobalHook` (`ReactFreshRuntime.js`) ma wymagać `scheduleRoot` obok `scheduleRefresh`/`setRefreshHandler` w obu miejscach sprawdzenia (`hook.inject` i replay `hook.renderers.forEach`), zgodnie z tym, co `RendererHelpers` już deklaruje. Docelowy kształt: renderer bez działającego `scheduleRoot` jest odrzucany od razu, nie dopiero w odzyskiwaniu zepsutego roota.

**Czego świadomie NIE robimy:** rozbicie cyklu importów (Opportunity #2) — odłożone; martwa gałąź legacy `scheduleRoot` (Candidate B) — odłożona do zewnętrznego sprawdzenia ekosystemu; pełny harness testowy po stronie reconcilera — osobny, większy wysiłek; import typów Flow z `react-reconciler` do `react-devtools-shared` — świadomie zachowana nieprzezroczystość z decyzji z 2021 (#21891); dodatkowy defensywny guard przy `helpers.scheduleRoot(...)` — zbędny po naprawie bramki.

**Fazy:**
1. Test-first: nowy test (`ReactFreshInjection-test.js`) dowodzi dzisiejszej dziury (czerwony), potem naprawa trzeciego warunku w obu bramkach (zielony) — weryfikacja **auto** (`yarn test packages/react-refresh`, `yarn flow dom-node`, `yarn lint`) + **ręcznie** (realna apka dev z react-dom nadal hot-reloaduje).
2. Doprecyzowanie typu Flow `ReactRenderer` w DevTools (dodanie `scheduleRoot?`/`setRefreshHandler?` jako nieprzezroczyste `Function`, bez zmiany zachowania) — weryfikacja **auto** (Flow, lint, `test-build-devtools`) + **ręcznie** (przegląd diffu pod kątem konfliktu pól).

## 5. Domena wg DDD (10xdev-dst, L5)

**Ubiquitous language (kluczowe pojęcia):** `Workspace`/`WorkspaceMember` (role member/team_lead), `StandupEntry` (did/plan wymagane, blockers opcjonalne), `Streak` (wyliczany na żywo, nigdy nie persystowany), `Blocker Match Suggestion` (efemeryczna, nieprzechowywana sugestia), `BlockerAlert` (trwały, niemutowalny rekord potwierdzenia/odrzucenia).

**Najważniejsze rozjazdy model-vs-kod:** (1) kanoniczny `context/foundation/prd.md` to w rzeczywistości wersja 1 (draft, przestarzała) — kod jest zgodny z `prd-v3.md`, nie z plikiem, który domyślnie czyta kolejny agent; (2) zadeklarowany, ale nieegzekwowany precondition "wpisy tylko w dni robocze" (komentarz w `src/lib/blocker.ts:4`), od którego zależą i streak, i wykrywanie blokerów.

**Niezmiennik #1 i agregat:** *"BlockerAlert powstaje wyłącznie jako potwierdzenie realnie wykrytego dopasowania"* — wybrany jako najbardziej rdzeniowy (to dokładnie mechanizm nazwany w Vision jako powód istnienia produktu) i najsłabiej egzekwowany (serwer w `/api/blocker/confirm` waliduje dziś tylko format daty i tożsamość, nigdy treść dopasowania). Należy do zaprojektowanego agregatu **`RecurringBlockerSuggestion`** (metody `confirm()`/`dismiss()`, błędy domenowe `NoMatchDetectedError`/`AlertAlreadyDecidedError`), zapisywanego przez `BlockerAlertRepository` z atomowością opartą o `UNIQUE(user_id, trigger_date)`.

**Anti-Corruption Layer:** przecieka `@supabase/supabase-js` — typ `User` (24 pola, z czego aplikacja realnie używa `id`+`email`) wpisany wprost w `App.Locals` (`src/env.d.ts:3`, najbliższy odpowiednik kontraktu międzywarstwowego), a wzorzec "wczytaj `workspace_member ⋈ workspace`" zreimplementowany niezależnie w min. 8 plikach. Przecieka przez **~21 plików / 4 warstwy**: kontrakt aplikacji (`env.d.ts`), middleware, 13 API routes, 5 stron Astro. Projekt ACL: port `AuthContextPort` + VO `AuthenticatedUser`/`WorkspaceMembership` + jeden adapter `SupabaseAuthContextAdapter`.

## 6. Decyzje, które należą do mnie

W wątku React AI (badanie + planowanie) dostarczyło pełną mapę ryzyk i dwie rankowane opcje refaktoru, ale to człowiek zawęził zakres planu do samej naprawy bramki `scheduleRoot`, świadomie odrzucając rozbicie cyklu importów, martwą gałąź legacy i pełny harness testowy (`plan.md § What We're NOT Doing`) — decyzja o tym, co jest "wystarczająco wartościowe teraz", a co zostaje w backlogu, nie wynikała z samej analizy, tylko z osądu o koszcie/ryzyku. AI (ast-grep) dało też błędne liczby (65→67, ~35→43 testów) i fałszywe zero dla kilku wzorców — to człowiek zdecydował, że każde twierdzenie strukturalne musi być skrzyżowane z grepem, co ujawniło samą zawodność narzędzia jako osobny wniosek metodologiczny. W domenie Daily Standup Tracker to użytkownik rozstrzygnął oba pierwotnie otwarte pytania PRD (streak kalendarzowy vs biznesowy; mechanizm dopasowania blokera — potwierdzenie czy dopasowanie automatyczne) między wersjami PRD v1→v2, oraz jawnie przywrócił FR-007/FR-008 (edit/delete) "per decision on 2026-06-05" po tym, jak AI pierwotnie je wycięło z MVP — AI proponowało zakres, ale ostateczny kształt reguł biznesowych pozostał decyzją właściciela produktu.
