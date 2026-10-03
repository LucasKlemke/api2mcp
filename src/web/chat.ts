import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { McpEntry } from "./server.js";

const MAX_STEPS = 10;
const model = () => process.env.OPENAI_MODEL || "gpt-5-mini";

const systemPrompt = (entry: McpEntry) =>
  `Você é um assistente que opera a API "${entry.name}" através das tools de um servidor MCP.
Use as tools para cumprir o pedido do usuário; encadeie quantas chamadas forem necessárias (ex: listar antes de atualizar).
Se uma tool retornar erro, leia a mensagem e corrija a chamada. Responda em português, de forma curta, dizendo o que foi feito.`;

/**
 * Roda um turno de conversa: o modelo da OpenAI chama as tools do MCP (via protocolo MCP real, em HTTP)
 * até produzir uma resposta final. Recebe e devolve o histórico completo (sem a mensagem de sistema).
 */
export async function chat(entry: McpEntry, url: string, history: ChatCompletionMessageParam[]) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Configure sua chave da OpenAI em ⚙ Configurações.");
  }

  const client = new Client({ name: "api2mcp-web-chat", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));

  try {
    const { tools } = await client.listTools();
    const openaiTools: ChatCompletionTool[] = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema as Record<string, unknown> },
    }));

    const openai = new OpenAI();
    const messages: ChatCompletionMessageParam[] = [...history];

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await openai.chat.completions.create({
        model: model(),
        messages: [{ role: "system", content: systemPrompt(entry) }, ...messages],
        tools: openaiTools,
      });
      const msg = res.choices[0].message;
      messages.push({ role: "assistant", content: msg.content ?? "", ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });

      if (!msg.tool_calls?.length) return { messages };

      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // argumentos inválidos: deixa a API/MCP responder com o erro
        }
        const result = await client.callTool({ name: call.function.name, arguments: args });
        const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
        messages.push({ role: "tool", tool_call_id: call.id, content: result.isError ? `ERRO: ${text}` : text });
      }
    }

    messages.push({ role: "assistant", content: `Parei após ${MAX_STEPS} passos sem concluir. Tente reformular o pedido.` });
    return { messages };
  } finally {
    await client.close();
  }
}
