import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDef } from "./tools.js";

const text = (t: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

function formatBody(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export async function executeTool(
  tool: ToolDef,
  args: Record<string, unknown>,
  baseUrl: string,
  extraHeaders: Record<string, string> = {},
): Promise<CallToolResult> {
  try {
    let path = tool.path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
    let body: unknown;
    const bodyFields: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args ?? {})) {
      if (value === undefined) continue;
      switch (tool.paramLocations[key]) {
        case "path":
          path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
          break;
        case "query":
          if (Array.isArray(value)) value.forEach((v) => query.append(key, String(v)));
          else query.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
          break;
        case "header":
          headers[key] = String(value);
          break;
        case "body":
          if (tool.wrappedBody) body = value;
          else bodyFields[key] = value;
          break;
        default:
          // argumento desconhecido: ignora em vez de quebrar a chamada
          break;
      }
    }

    const missing = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    if (missing.length) return text(`Parâmetro(s) obrigatório(s) ausente(s): ${missing.join(", ")}`, true);

    if (body === undefined && Object.keys(bodyFields).length) body = bodyFields;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const qs = query.toString();
    const url = baseUrl.replace(/\/+$/, "") + path + (qs ? `?${qs}` : "");
    const res = await fetch(url, {
      method: tool.method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const raw = await res.text();

    if (!res.ok) return text(`HTTP ${res.status}: ${raw || res.statusText}`, true);
    return text(raw ? formatBody(raw) : `HTTP ${res.status} (sem corpo)`);
  } catch (err) {
    return text(`Falha ao chamar ${tool.method} ${tool.path}: ${(err as Error).message}`, true);
  }
}
