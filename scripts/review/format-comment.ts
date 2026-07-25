/**
 * Formatuje wynik review.ts (JSON zgodny z REVIEW_SCHEMA) jako komentarz Markdown do PR-a.
 *
 * Użycie:
 *   npx tsx scripts/review/format-comment.ts review-result.json
 *   npx tsx scripts/review/review.ts --base origin/master | npx tsx scripts/review/format-comment.ts
 */
import { readFileSync } from "node:fs";
import { REVIEW_SCHEMA } from "./review-schema.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const CRITERIA_LABELS = {
  implementationCorrectness: "Poprawność implementacji",
  idiomaticity: "Idiomatyczność",
  complexity: "Złożoność",
  testRiskCoverage: "Pokrycie testami",
  securitySafety: "Bezpieczeństwo",
} as const;

async function main(): Promise<void> {
  const path = process.argv[2];
  const raw = path ? readFileSync(path, "utf8") : await readStdin();

  const parsed = REVIEW_SCHEMA.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`Niepoprawny JSON wyniku review: ${parsed.error.message}`);
  const review = parsed.data;

  const badge = review.verdict === "pass" ? "✅ PASS" : "❌ FAIL";
  const rows = (Object.keys(CRITERIA_LABELS) as (keyof typeof CRITERIA_LABELS)[])
    .map((key) => `| ${CRITERIA_LABELS[key]} | ${review[key]}/10 |`)
    .join("\n");

  const comment = `## 🤖 AI Code Review — ${badge}

| Kryterium | Ocena |
| --- | --- |
${rows}

${review.summary}

<sub>Wygenerowano automatycznie w CI (\`npm run review\`).</sub>`;

  console.log(comment);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  console.error(`[format-comment] BŁĄD: ${message}`);
  process.exitCode = 1;
}
