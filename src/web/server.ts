import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { enhanceTools } from "../enhance.js";
import { createMcpServer } from "../server.js";
import { specPrompt } from "../prompt.js";
import { loadSpec } from "../spec.js";
import { specToTools } from "../tools.js";
import { chat } from "./chat.js";
import { loadSettings, removeApiKey, saveSettings, settingsStatus } from "../settings.js";
import { draftToTool, generateDraft, toolToDraft, type StoredTool, type ToolDraft } from "./tool-drafts.js";

export type McpEntry = {
  id: string;
  name: string;
  baseUrl: string;
  enhanced: boolean;
  createdAt: string;
  headers: Record<string, string>;
  tools: StoredTool[];
};

const STORE_FILE = ".api2mcp/servers.json";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

/** Pasta da interface buildada: dist/ui ao lado do bundle, ou ../../dist/ui rodando via tsx. */
function findUiDir(): string | undefined {
  for (const rel of ["./ui/", "../ui/", "../../dist/ui/"]) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return undefined;
}

/** Lê "Nome: valor" (um por linha) vindo da UI. */
function parseHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "string") return {};
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

export async function startWeb({ port }: { port: number }): Promise<void> {
  // MCPs criados pela UI; persistidos em disco para sobreviver a restarts
  const mcps = new Map<string, McpEntry>();
  try {
    for (const m of JSON.parse(await readFile(STORE_FILE, "utf8")) as McpEntry[]) mcps.set(m.id, m);
  } catch {
    // primeiro uso
  }
  const saveStore = async () => {
    await mkdir(".api2mcp", { recursive: true });
    await writeFile(STORE_FILE, JSON.stringify([...mcps.values()], null, 2));
  };

  const mcpUrl = (id: string) => `http://localhost:${port}/mcp/${id}`;

  // nunca devolve os valores dos headers (podem ser tokens) para o navegador
  const summary = (m: McpEntry) => ({
    id: m.id,
    name: m.name,
    baseUrl: m.baseUrl,
    enhanced: m.enhanced,
    createdAt: m.createdAt,
    url: mcpUrl(m.id),
    headerNames: Object.keys(m.headers ?? {}),
    tools: m.tools.map(toolToDraft),
  });

  const activeTools = (m: McpEntry) => m.tools.filter((t) => !t.disabled);

  const app = new Hono();
  app.onError((err, c) => c.json({ error: err.message }, 500));

  await loadSettings();

  app.get("/api/config", (c) => c.json(settingsStatus()));

  app.put("/api/settings", async (c) => {
    try {
      await saveSettings(await c.req.json<{ openaiApiKey?: string; openaiModel?: string }>());
      return c.json(settingsStatus());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.delete("/api/settings/openai-key", async (c) => {
    await removeApiKey();
    return c.json(settingsStatus());
  });

  app.get("/api/spec-prompt", (c) => c.json({ prompt: specPrompt(c.req.query("baseUrl") || undefined) }));

  // Spec -> tools, usado pela aba "API" para montar o explorer
  app.post("/api/inspect", async (c) => {
    const { baseUrl, spec } = await c.req.json<{ baseUrl: string; spec?: string }>();
    try {
      const loaded = await loadSpec(baseUrl, spec || undefined);
      return c.json({ title: loaded.spec.info?.title, source: loaded.source, tools: specToTools(loaded.spec) });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get("/api/mcps", (c) => c.json([...mcps.values()].map(summary)));

  app.post("/api/mcps", async (c) => {
    const body = await c.req.json<{ baseUrl: string; name?: string; enhance?: boolean; spec?: string; headers?: string }>();
    const baseUrl = body.baseUrl?.trim().replace(/\/+$/, "");
    if (!baseUrl) return c.json({ error: "Informe a URL base da API." }, 400);

    let loaded;
    try {
      loaded = await loadSpec(baseUrl, body.spec?.trim() || undefined);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
    const original = specToTools(loaded.spec);
    const tools = body.enhance ? await enhanceTools(original, loaded.hash) : original;

    const entry: McpEntry = {
      id: randomUUID().slice(0, 8),
      name: body.name?.trim() || loaded.spec.info?.title || "api",
      baseUrl,
      enhanced: tools !== original,
      createdAt: new Date().toISOString(),
      headers: parseHeaders(body.headers),
      tools,
    };
    mcps.set(entry.id, entry);
    await saveStore();
    return c.json(summary(entry), 201);
  });

  app.delete("/api/mcps/:id", async (c) => {
    if (!mcps.delete(c.req.param("id"))) return c.json({ error: "MCP não encontrado." }, 404);
    await saveStore();
    return c.body(null, 204);
  });

  // ---- gerenciamento de tools de um MCP ----

  const findEntry = (id: string) => {
    const entry = mcps.get(id);
    if (!entry) throw Object.assign(new Error("MCP não encontrado."), { status: 404 });
    return entry;
  };
  const toolError = (c: { json: (b: unknown, s: 400 | 404) => Response }, err: unknown) =>
    c.json({ error: (err as Error).message }, (err as { status?: number }).status === 404 ? 404 : 400);

  app.post("/api/mcps/:id/tools", async (c) => {
    try {
      const entry = findEntry(c.req.param("id"));
      const tool = draftToTool(await c.req.json<ToolDraft>(), new Set(entry.tools.map((t) => t.name)));
      entry.tools.push(tool);
      await saveStore();
      return c.json(summary(entry), 201);
    } catch (err) {
      return toolError(c, err);
    }
  });

  app.put("/api/mcps/:id/tools/:name", async (c) => {
    try {
      const entry = findEntry(c.req.param("id"));
      const idx = entry.tools.findIndex((t) => t.name === c.req.param("name"));
      if (idx === -1) return c.json({ error: "Tool não encontrada." }, 404);
      const others = new Set(entry.tools.filter((_, i) => i !== idx).map((t) => t.name));
      entry.tools[idx] = draftToTool(await c.req.json<ToolDraft>(), others);
      await saveStore();
      return c.json(summary(entry));
    } catch (err) {
      return toolError(c, err);
    }
  });

  app.delete("/api/mcps/:id/tools/:name", async (c) => {
    try {
      const entry = findEntry(c.req.param("id"));
      const before = entry.tools.length;
      entry.tools = entry.tools.filter((t) => t.name !== c.req.param("name"));
      if (entry.tools.length === before) return c.json({ error: "Tool não encontrada." }, 404);
      await saveStore();
      return c.json(summary(entry));
    } catch (err) {
      return toolError(c, err);
    }
  });

  // rascunho gerado por IA; não salva, a interface mostra para revisão
  app.post("/api/mcps/:id/tools/generate", async (c) => {
    try {
      const entry = findEntry(c.req.param("id"));
      const { prompt } = await c.req.json<{ prompt: string }>();
      if (!prompt?.trim()) return c.json({ error: "Descreva o que a tool deve fazer." }, 400);
      return c.json({ draft: await generateDraft(entry.name, entry.baseUrl, entry.tools, prompt) });
    } catch (err) {
      return toolError(c, err);
    }
  });

  app.post("/api/chat", async (c) => {
    const { mcpId, messages } = await c.req.json<{ mcpId: string; messages: unknown[] }>();
    const entry = mcps.get(mcpId);
    if (!entry) return c.json({ error: "MCP não encontrado." }, 404);
    try {
      return c.json(await chat(entry, mcpUrl(entry.id), messages as never));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Cada MCP criado é um servidor MCP real (Streamable HTTP, stateless) em /mcp/:id
  app.all("/mcp/:id", async (c) => {
    const entry = mcps.get(c.req.param("id"));
    if (!entry) return c.json({ jsonrpc: "2.0", error: { code: -32001, message: "MCP não encontrado." }, id: null }, 404);
    if (c.req.method !== "POST") {
      return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, 405);
    }
    const server = createMcpServer({ name: entry.name, tools: activeTools(entry), baseUrl: entry.baseUrl, headers: entry.headers ?? {} });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(c.req.raw);
    void server.close();
    return res;
  });

  // Interface web buildada (SPA): arquivo se existir, senão index.html
  const uiDir = findUiDir();
  if (uiDir) {
    app.get("*", async (c) => {
      const rel = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
      const file = join(uiDir, rel);
      const target = file.startsWith(uiDir) && extname(file) && existsSync(file) ? file : join(uiDir, "index.html");
      return c.body(await readFile(target), 200, { "Content-Type": MIME[extname(target)] ?? "application/octet-stream" });
    });
  }

  await new Promise<void>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port }, () => resolve());
    server.once("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "EADDRINUSE" ? new Error(`a porta ${port} já está em uso; use --port <outra>`) : err),
    );
  });
  console.error(`[api2mcp] interface web em http://localhost:${port} (${mcps.size} MCPs carregados)`);
  if (!uiDir) console.error("[api2mcp] aviso: interface não buildada (rode npm run build:ui); só a API /api e /mcp estão ativas.");
}
