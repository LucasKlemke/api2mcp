export type JSONSchema = Record<string, any>;

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, JSONSchema>; required?: string[] };
  method: string;
  path: string;
  paramLocations?: Record<string, "path" | "query" | "header" | "body">;
  wrappedBody?: boolean;
};

export type ParamLocation = "path" | "query" | "header" | "body";

export type ParamDraft = {
  name: string;
  in: ParamLocation;
  type: string;
  required: boolean;
  description: string;
  schema?: JSONSchema;
};

/** Tool no formato de formulário (como o backend devolve e recebe). */
export type ToolDraft = {
  name: string;
  description: string;
  method: string;
  path: string;
  enabled: boolean;
  wrappedBody?: boolean;
  params: ParamDraft[];
};

export type McpSummary = {
  id: string;
  name: string;
  baseUrl: string;
  enhanced: boolean;
  createdAt: string;
  url: string;
  headerNames: string[];
  tools: ToolDraft[];
};

export type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type Config = {
  openai: boolean;
  model: string;
  keySource?: "interface" | "env" | null;
  keyPreview?: string | null;
  settingsFile?: string;
};

/** Chamada ao backend web (/api/*); lança Error com a mensagem do servidor. */
export async function backend<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Gera um valor de exemplo a partir de um JSON Schema (para pré-preencher formulários). */
export function exampleFor(s: JSONSchema | undefined): unknown {
  if (!s) return null;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum)) return s.enum[0];
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
    default:
      if (s.properties) return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, exampleFor(v as JSONSchema)]));
      return type ? null : {};
  }
}
