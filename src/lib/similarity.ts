import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY } from "astro:env/server";

function jaccardSimilarity(a: string, b: string): boolean {
  const tokenize = (s: string) => new Set(s.toLowerCase().match(/\w+/g) ?? []);
  const setA = tokenize(a);
  const setB = tokenize(b);
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 && intersection / union >= 0.25;
}

export async function haikuSimilarity(a: string, b: string): Promise<boolean> {
  if (!ANTHROPIC_API_KEY) return jaccardSimilarity(a, b);
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [
        {
          role: "user",
          content: `Are these two standup blocker entries describing the same blocking issue? Answer YES or NO only.\n\n<entry1>${a.slice(0, 500)}</entry1>\n<entry2>${b.slice(0, 500)}</entry2>`,
        },
      ],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    return text.trim().toUpperCase().startsWith("YES");
  } catch (err) {
    console.error("[haikuSimilarity] Anthropic call failed, falling back to Jaccard:", err);
    return jaccardSimilarity(a, b);
  }
}
