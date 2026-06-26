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
  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [
        {
          role: "user",
          content: `Are these two standup blocker entries describing the same blocking issue? Answer YES or NO only.\n\nEntry 1: ${a}\nEntry 2: ${b}`,
        },
      ],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    return text.trim().toUpperCase().startsWith("YES");
  } catch {
    return jaccardSimilarity(a, b);
  }
}
