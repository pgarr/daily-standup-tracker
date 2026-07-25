/**
 * Minimalny agent do code review oparty o Claude Agent SDK (gotowy agent).
 *
 * Wejście  — diff z gita (stdin, plik, albo wyliczony przez sam skrypt).
 * Wyjście  — ustrukturyzowany JSON na stdout (REVIEW_SCHEMA), metryki na stderr.
 *
 * Użycie (cross-platform, działa w PowerShell / cmd / bash):
 *   npm run review                  # diff working tree vs HEAD
 *   npm run review:staged           # diff --staged (to, co poleci w commicie)
 *   npm run review:sample           # symulowany diff z fixtures/ (weryfikacja połączenia)
 *   npx tsx scripts/review/review.ts --base origin/master
 *   npx tsx scripts/review/review.ts --file some.diff
 *   git diff | npx tsx scripts/review/review.ts
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REVIEW_JSON_SCHEMA, REVIEW_SCHEMA, SYSTEM_PROMPT, type Review } from "./review-schema.ts";

// SDK nie czyta .env samo — wczytujemy go, jeśli istnieje (Node >= 22).
for (const envFile of [".env", ".dev.vars"]) {
  const envPath = resolve(process.cwd(), envFile);
  if (existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Niepoprawny plik .env nie powinien blokować uruchomienia z jawną zmienną środowiskową.
    }
  }
}

const MODEL = process.env.REVIEW_MODEL ?? "claude-opus-5";
const MAX_DIFF_CHARS = Number(process.env.REVIEW_MAX_DIFF_CHARS ?? 200_000);
const MAX_BUDGET_USD = process.env.REVIEW_MAX_BUDGET_USD ? Number(process.env.REVIEW_MAX_BUDGET_USD) : undefined;

interface Args {
  file?: string;
  base?: string;
  staged: boolean;
  strict: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { staged: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--file":
      case "--base": {
        const value = argv.at(i + 1);
        if (value === undefined || value.startsWith("--")) {
          throw new Error(`Brak wartości dla ${arg}`);
        }
        if (arg === "--file") args.file = value;
        else args.base = value;
        i++;
        break;
      }
      case "--staged":
        args.staged = true;
        break;
      case "--strict":
        args.strict = true;
        break;
      default:
        throw new Error(`Nieznany argument: ${arg}`);
    }
  }
  return args;
}

function git(gitArgs: string[]): string {
  const result = spawnSync("git", gitArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`Nie udało się uruchomić gita: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(" ")} zakończył się błędem: ${result.stderr.trim()}`);
  return result.stdout;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function resolveDiff(args: Args): Promise<{ diff: string; source: string }> {
  if (args.file) {
    const path = resolve(process.cwd(), args.file);
    if (!existsSync(path)) throw new Error(`Plik z diffem nie istnieje: ${path}`);
    return { diff: readFileSync(path, "utf8"), source: `plik ${args.file}` };
  }
  if (args.staged) return { diff: git(["diff", "--staged"]), source: "git diff --staged" };
  if (args.base) return { diff: git(["diff", `${args.base}...HEAD`]), source: `git diff ${args.base}...HEAD` };

  const piped = await readStdin();
  if (piped.trim() !== "") return { diff: piped, source: "stdin" };

  return { diff: git(["diff", "HEAD"]), source: "git diff HEAD" };
}

async function review(diff: string): Promise<{ review: Review; costUsd: number; turns: number; durationMs: number }> {
  const result = query({
    prompt: `Zrecenzuj ten diff:\n\n${diff}`,
    options: {
      systemPrompt: SYSTEM_PROMPT, // własna rola — bez presetu claude_code, więc bez CLAUDE.md i skilli
      model: MODEL,
      tools: [], // wyłączamy wbudowane narzędzia: recenzja czyta tylko diff z promptu
      maxTurns: 2, // 1: model formułuje ocenę, 2: emituje ją jako JSON zgodny ze schematem
      outputFormat: { type: "json_schema", schema: REVIEW_JSON_SCHEMA },
      ...(MAX_BUDGET_USD === undefined ? {} : { maxBudgetUsd: MAX_BUDGET_USD }),
    },
  });

  for await (const message of result) {
    if (message.type !== "result") continue;
    if (message.subtype === "success") {
      const parsed = REVIEW_SCHEMA.safeParse(message.structured_output);
      if (!parsed.success) throw new Error(`Niepoprawny structured output: ${parsed.error.message}`);
      return {
        review: parsed.data,
        costUsd: message.total_cost_usd,
        turns: message.num_turns,
        durationMs: message.duration_ms,
      };
    }
    throw new Error(`Review nie powiodło się (${message.subtype}): ${message.errors.join("; ")}`);
  }
  throw new Error("Agent nie zwrócił wyniku");
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { diff, source } = await resolveDiff(args);

  if (diff.trim() === "") {
    throw new Error(`Brak zmian do recenzji (źródło: ${source}). Wskaż diff przez --file, --base lub --staged.`);
  }
  if (diff.length > MAX_DIFF_CHARS) {
    throw new Error(
      `Diff ma ${diff.length} znaków, limit to ${MAX_DIFF_CHARS}. ` +
        `Zawęź zakres (--staged, --base <ref>) albo podnieś REVIEW_MAX_DIFF_CHARS — nie ucinamy wejścia po cichu.`,
    );
  }

  console.error(`[review] model=${MODEL} źródło=${source} znaków=${diff.length}`);

  const { review: verdict, costUsd, turns, durationMs } = await review(diff);

  console.log(JSON.stringify(verdict, null, 2));
  console.error(`[review] werdykt=${verdict.verdict} koszt=$${costUsd.toFixed(4)} tury=${turns} czas=${durationMs}ms`);

  return args.strict && verdict.verdict === "fail" ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  console.error(`[review] BŁĄD: ${message}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "[review] ANTHROPIC_API_KEY nie jest ustawiony. Dodaj go do .env (patrz .env.example) " +
        "albo zaloguj się przez Claude Code — SDK podejmie wtedy twoje credentiale.",
    );
  }
  process.exitCode = 1;
}
