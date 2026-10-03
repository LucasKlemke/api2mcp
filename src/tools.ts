import type { OpenAPIV3 } from "openapi-types";

export type JSONSchema = Record<string, any>;

export type ParamLocation = "path" | "query" | "header" | "body";

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: JSONSchema & { type: "object"; properties: Record<string, JSONSchema>; required?: string[] };
  method: string;
  path: string;
  paramLocations: Record<string, ParamLocation>;
  /** true quando o body inteiro vai sob a chave `body` (colisão ou body não-objeto) */
  wrappedBody?: boolean;
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function sanitizeName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return (clean || "tool").slice(0, 64);
}

/** Converte palavras-chave do OpenAPI 3.0 (nullable, example) para JSON Schema. */
export function toJsonSchema(schema: unknown, dropNullable = false): JSONSchema {
  if (Array.isArray(schema)) return schema.map((s) => toJsonSchema(s)) as unknown as JSONSchema;
  if (!schema || typeof schema !== "object") return schema as JSONSchema;
  const out: JSONSchema = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "nullable" || k === "example" || k === "xml" || k === "discriminator") continue;
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, toJsonSchema(pv)])) : toJsonSchema(v);
  }
  const s = schema as JSONSchema;
  if ("example" in s && !("examples" in s)) out.examples = [s.example];
  if (s.nullable && !dropNullable && typeof s.type === "string") out.type = [s.type, "null"];
  return out;
}

/** Gera um nome a partir de método + rota, ex: GET /tasks/{id} -> get_tasks_by_id */
function fallbackName(method: string, path: string): string {
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((seg) => (seg.startsWith("{") ? `by_${seg.slice(1, -1)}` : seg));
  return [method, ...parts].join("_");
}

export function specToTools(spec: OpenAPIV3.Document): ToolDef[] {
  const tools: ToolDef[] = [];
  const used = new Set<string>();

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem) continue;
    for (const method of METHODS) {
      const op = pathItem[method];
      if (!op) continue;

      // nome único e válido
      let name = sanitizeName(op.operationId ?? fallbackName(method, path));
      for (let i = 2; used.has(name); i++) name = sanitizeName(`${name.slice(0, 60)}_${i}`);
      used.add(name);

      const properties: Record<string, JSONSchema> = {};
      const required: string[] = [];
      const paramLocations: Record<string, ParamLocation> = {};
      let wrappedBody = false;

      // params do path-item + da operação (a operação sobrescreve)
      const params = new Map<string, OpenAPIV3.ParameterObject>();
      for (const p of [...(pathItem.parameters ?? []), ...(op.parameters ?? [])] as OpenAPIV3.ParameterObject[]) {
        if (p.in === "cookie") continue;
        params.set(`${p.in}:${p.name}`, p);
      }
      for (const p of params.values()) {
        const schema = toJsonSchema(p.schema ?? { type: "string" }, p.in === "path");
        if (p.description) schema.description = p.description;
        properties[p.name] = schema;
        paramLocations[p.name] = p.in as ParamLocation;
        if (p.in === "path" || p.required) required.push(p.name);
      }

      // body JSON
      const reqBody = op.requestBody as OpenAPIV3.RequestBodyObject | undefined;
      const rawBody = reqBody?.content?.["application/json"]?.schema;
      const bodySchema = rawBody ? toJsonSchema(rawBody) : undefined;
      if (bodySchema) {
        const bodyProps = bodySchema.type === "object" || bodySchema.properties ? bodySchema.properties : undefined;
        const collides = bodyProps && Object.keys(bodyProps).some((k) => k in properties);
        if (bodyProps && !collides) {
          for (const [k, s] of Object.entries(bodyProps)) {
            properties[k] = s as JSONSchema;
            paramLocations[k] = "body";
          }
          for (const k of (bodySchema.required as string[] | undefined) ?? []) required.push(k);
        } else {
          properties.body = { ...bodySchema, description: bodySchema.description ?? reqBody?.description ?? "Corpo da requisição (JSON)" };
          paramLocations.body = "body";
          wrappedBody = true;
          if (reqBody?.required) required.push("body");
        }
      }

      const description =
        [op.summary, op.description].filter((s) => s && s.trim()).join("\n\n") || `${method.toUpperCase()} ${path}`;

      tools.push({
        name,
        description,
        inputSchema: { type: "object", properties, ...(required.length ? { required: [...new Set(required)] } : {}) },
        method: method.toUpperCase(),
        path,
        paramLocations,
        ...(wrappedBody ? { wrappedBody } : {}),
      });
    }
  }
  return tools;
}
