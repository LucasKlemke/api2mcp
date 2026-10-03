import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type Provider = "openai" | "anthropic";
const DEFAULT_MODELS: Record<Provider, string> = { openai: "gpt-5-mini", anthropic: "claude-sonnet-5-5" };

/** OpenAI tem prioridade; API2MCP_PROVIDER força um provedor. */
export function pickProvider(): Provider | undefined {
  const forced = process.env.API2MCP_PROVIDER as Provider | undefined;
  if (forced === "openai" || forced === "anthropic") return forced;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return undefined;
}

export const modelFor = (provider: Provider) => process.env.API2MCP_MODEL || DEFAULT_MODELS[provider];

/** Remove cercas de markdown e pega o objeto JSON mais externo. */
export function parseLlmJson(raw: string): unknown {
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

/** Chama o LLM pedindo JSON e devolve o objeto já parseado. O prompt precisa mencionar JSON. */
export async function completeJson(provider: Provider, model: string, system: string, user: string): Promise<unknown> {
  let text: string;
  if (provider === "openai") {
    const res = await new OpenAI().chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    text = res.choices[0]?.message?.content ?? "";
  } else {
    const msg = await new Anthropic().messages.create({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
    });
    text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  return parseLlmJson(text);
}
