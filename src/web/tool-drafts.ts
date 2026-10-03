import { completeJson, modelFor, pickProvider } from "../llm.js";
import type { JSONSchema, ParamLocation, ToolDef } from "../tools.js";

/** Tool como fica salva num MCP da interface: pode estar desativada. */
export type StoredTool = ToolDef & { disabled?: boolean };

/** Formato de formulário usado pela interface para criar/editar tools. */
export type ParamDraft = {
  name: string;
  in: ParamLocation;
  type: string;
  required: boolean;
  description: string;
  /** schema original (do spec), preservado se o tipo não mudar */
  schema?: JSONSchema;
};

export type ToolDraft = {
  name: string;
  description: string;
  method: string;
  path: string;
  enabled: boolean;
  wrappedBody?: boolean;
  params: ParamDraft[];
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const LOCATIONS: ParamLocation[] = ["path", "query", "header", "body"];
const TYPES = ["string", "number", "integer", "boolean", "array", "object"];
const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function typeOf(schema: JSONSchema | undefined): string {
  if (!schema) return "string";
  const t = Array.isArray(schema.type) ? schema.type.find((x: string) => x !== "null") : schema.type;
  if (typeof t === "string") return t;
  return schema.properties ? "object" : "string";
}

export function toolToDraft(tool: StoredTool): ToolDraft {
  const required = new Set(tool.inputSchema.required ?? []);
  return {
    name: tool.name,
    description: tool.description,
    method: tool.method,
    path: tool.path,
    enabled: !tool.disabled,
    ...(tool.wrappedBody ? { wrappedBody: true } : {}),
    params: Object.entries(tool.inputSchema.properties).map(([name, schema]) => ({
      name,
      in: tool.paramLocations[name] ?? "query",
      type: typeOf(schema),
      required: required.has(name),
      description: schema.description ?? "",
      schema,
    })),
  };
}

/** Valida um rascunho e monta a tool. Lança Error com mensagem para o usuário. */
export function draftToTool(d: ToolDraft, takenNames: Set<string>): StoredTool {
  const name = String(d.name ?? "").trim();
  if (!NAME_RE.test(name)) throw new Error(`Nome "${name}" inválido: use só letras, números, _ ou - (até 64 caracteres).`);
  if (takenNames.has(name)) throw new Error(`Já existe uma tool chamada "${name}".`);

  const method = String(d.method ?? "").toUpperCase();
  if (!METHODS.includes(method)) throw new Error(`Método "${d.method}" inválido. Use ${METHODS.join(", ")}.`);

  let path = String(d.path ?? "").trim();
  if (!path) throw new Error("Informe a rota, ex: /tasks/{id}.");
  if (!path.startsWith("/")) path = `/${path}`;
  if (/\s/.test(path)) throw new Error("A rota não pode ter espaços.");

  const params: ParamDraft[] = [];
  const seen = new Set<string>();
  for (const p of d.params ?? []) {
    const pname = String(p.name ?? "").trim();
    if (!pname) throw new Error("Há um parâmetro sem nome.");
    if (seen.has(pname)) throw new Error(`Parâmetro "${pname}" repetido.`);
    if (!LOCATIONS.includes(p.in)) throw new Error(`Local "${p.in}" inválido para "${pname}".`);
    if (!TYPES.includes(p.type)) throw new Error(`Tipo "${p.type}" inválido para "${pname}".`);
    seen.add(pname);
    params.push({ ...p, name: pname });
  }

  // cada {x} da rota precisa de um parâmetro de path, e vice-versa
  const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  for (const ph of placeholders) {
    if (!seen.has(ph)) params.unshift({ name: ph, in: "path", type: "string", required: true, description: "" });
    else if (params.find((p) => p.name === ph)!.in !== "path") throw new Error(`"${ph}" aparece na rota, então precisa estar em "path".`);
  }
  for (const p of params) {
    if (p.in === "path" && !placeholders.includes(p.name)) throw new Error(`O parâmetro de path "${p.name}" não aparece na rota (use {${p.name}}).`);
  }

  const bodyParams = params.filter((p) => p.in === "body");
  const wrappedBody = Boolean(d.wrappedBody) && bodyParams.length === 1 && bodyParams[0].name === "body";

  const properties: Record<string, JSONSchema> = {};
  const paramLocations: Record<string, ParamLocation> = {};
  const required: string[] = [];
  for (const p of params) {
    const base: JSONSchema =
      p.schema && typeOf(p.schema) === p.type
        ? { ...p.schema }
        : p.type === "array"
          ? { type: "array", items: { type: "string" } }
          : { type: p.type };
    const desc = String(p.description ?? "").trim();
    if (desc) base.description = desc;
    else delete base.description;
    properties[p.name] = base;
    paramLocations[p.name] = p.in;
    if (p.in === "path" || p.required) required.push(p.name);
  }

  return {
    name,
    description: String(d.description ?? "").trim() || `${method} ${path}`,
    method,
    path,
    inputSchema: { type: "object", properties, ...(required.length ? { required } : {}) },
    paramLocations,
    ...(wrappedBody ? { wrappedBody: true } : {}),
    ...(d.enabled === false ? { disabled: true } : {}),
  };
}

const GENERATE_PROMPT = `Você projeta tools para agentes de IA (Model Context Protocol). Cada tool faz UMA chamada HTTP a uma rota da API.
Recebe as tools que já existem e um pedido do usuário, e cria UMA tool nova que atenda ao pedido.

Regras:
- Use uma rota já existente quando ela servir; se o usuário descrever uma rota nova (ex: "GET /api/stats"), use a rota dele.
- "name" em snake_case, curto, e diferente dos nomes existentes.
- "description" escrita para agentes (2 a 4 frases): o que faz e retorna, quando usar, quando NÃO usar (cite a tool alternativa) e qual tool chamar antes, se precisar.
- Cada parâmetro: "in" é path, query, header ou body; "type" é string, number, integer, boolean, array ou object; descrição com exemplo.
- Todo {param} da rota precisa de um parâmetro com in = "path".
- Escreva no mesmo idioma das tools existentes.
- Responda APENAS com JSON válido, no formato:
{"name":"...","description":"...","method":"GET|POST|PUT|PATCH|DELETE","path":"/rota/{id}","params":[{"name":"...","in":"path","type":"integer","required":true,"description":"..."}]}`;

/** Pede ao LLM um rascunho de tool; o usuário revisa antes de salvar. */
export async function generateDraft(apiName: string, baseUrl: string, tools: StoredTool[], prompt: string): Promise<ToolDraft> {
  const provider = pickProvider();
  if (!provider) throw new Error("Configure sua chave da OpenAI em ⚙ Configurações para gerar tools com IA.");

  const existing = tools.map((t) => ({
    name: t.name,
    method: t.method,
    path: t.path,
    description: t.description,
    params: Object.entries(t.inputSchema.properties).map(([n, s]) => ({ name: n, in: t.paramLocations[n], type: typeOf(s) })),
  }));
  const raw = (await completeJson(
    provider,
    modelFor(provider),
    GENERATE_PROMPT,
    `API "${apiName}" em ${baseUrl}\n\nTools existentes:\n${JSON.stringify(existing, null, 2)}\n\nPedido do usuário:\n${prompt}`,
  )) as Record<string, unknown>;

  const params = Array.isArray(raw.params) ? (raw.params as Array<Record<string, unknown>>) : [];
  return {
    name: String(raw.name ?? ""),
    description: String(raw.description ?? ""),
    method: String(raw.method ?? "GET").toUpperCase(),
    path: String(raw.path ?? "/"),
    enabled: true,
    params: params.map((p) => ({
      name: String(p.name ?? ""),
      in: (LOCATIONS.includes(p.in as ParamLocation) ? p.in : "query") as ParamLocation,
      type: TYPES.includes(String(p.type)) ? String(p.type) : "string",
      required: Boolean(p.required),
      description: String(p.description ?? ""),
    })),
  };
}
