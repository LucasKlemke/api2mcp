import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { completeJson, modelFor, pickProvider, type Provider } from "./llm.js";
import type { ToolDef } from "./tools.js";

type Enhancement = { description?: string; parameters?: Record<string, string> };
type EnhancementMap = Record<string, Enhancement>;
type CacheFile = Record<string, { model: string; createdAt: string; tools: EnhancementMap }>;

const CACHE_DIR = ".api2mcp";
const CACHE_FILE = join(CACHE_DIR, "enhanced.json");

const SYSTEM_PROMPT = `Você é especialista em projetar tools para agentes de IA (Model Context Protocol).
Recebe uma lista de tools geradas automaticamente a partir de uma API OpenAPI e reescreve as descrições para que um LLM escolha a tool certa e preencha os parâmetros corretamente.

Para cada tool, escreva uma "description" que diga, de forma concisa (2 a 5 frases):
- o que a tool faz e o que retorna;
- quando usar;
- quando NÃO usar (aponte a tool alternativa certa pelo nome);
- qual tool chamar antes, se algum parâmetro depende de outra (ex: "use list_tasks para descobrir o id").

Para cada parâmetro existente, escreva uma descrição clara com formato esperado e um exemplo.

Regras:
- Mantenha o idioma das descrições originais.
- NUNCA invente tools ou parâmetros, nem mude nomes, tipos, obrigatoriedade, método ou rota.
- Responda APENAS com JSON válido, sem texto extra, no formato:
{"tools":[{"name":"<nome exato>","description":"<nova descrição>","parameters":{"<nome do parâmetro>":"<nova descrição>"}}]}`;

function cacheKey(specHash: string, provider: string, model: string): string {
  return createHash("sha256").update(`${specHash}:${provider}:${model}:${SYSTEM_PROMPT}`).digest("hex");
}

async function readCache(): Promise<CacheFile> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8")) as CacheFile;
  } catch {
    return {};
  }
}

async function writeCache(cache: CacheFile): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error(`[api2mcp] aviso: não foi possível salvar o cache em ${CACHE_FILE}: ${(err as Error).message}`);
  }
}

/** Converte a resposta do LLM em um mapa validado: só descrições de tools/parâmetros que existem. */
function validate(parsed: unknown, tools: ToolDef[]): EnhancementMap {
  const list = (parsed as { tools?: unknown })?.tools;
  if (!Array.isArray(list)) throw new Error('resposta sem o array "tools"');
  const byName = new Map(tools.map((t) => [t.name, t]));
  const out: EnhancementMap = {};

  for (const item of list as Array<Record<string, unknown>>) {
    const tool = typeof item?.name === "string" ? byName.get(item.name) : undefined;
    if (!tool) {
      console.error(`[api2mcp] aviso: descartando tool desconhecida "${String(item?.name)}" vinda do LLM`);
      continue;
    }
    const entry: Enhancement = {};
    if (typeof item.description === "string" && item.description.trim()) entry.description = item.description.trim();
    const params = item.parameters;
    if (params && typeof params === "object") {
      for (const [p, desc] of Object.entries(params)) {
        if (!(p in tool.inputSchema.properties)) {
          console.error(`[api2mcp] aviso: descartando parâmetro inexistente "${tool.name}.${p}"`);
          continue;
        }
        if (typeof desc === "string" && desc.trim()) (entry.parameters ??= {})[p] = desc.trim();
      }
    }
    out[tool.name] = entry;
  }
  return out;
}

/** Aplica as descrições sem tocar em nomes, tipos, required, método ou rota. */
function apply(tools: ToolDef[], enh: EnhancementMap): ToolDef[] {
  return tools.map((tool) => {
    const e = enh[tool.name];
    if (!e) return tool;
    const copy: ToolDef = structuredClone(tool);
    if (e.description) copy.description = e.description;
    for (const [p, desc] of Object.entries(e.parameters ?? {})) {
      const prop = copy.inputSchema.properties[p];
      if (prop) prop.description = desc;
    }
    return copy;
  });
}

async function callLlm(tools: ToolDef[], provider: Provider, model: string): Promise<EnhancementMap> {
  const payload = tools.map(({ name, description, method, path, inputSchema }) => ({
    name,
    description,
    method,
    path,
    inputSchema,
  }));
  const parsed = await completeJson(provider, model, SYSTEM_PROMPT, `Tools da API:\n\n${JSON.stringify(payload, null, 2)}`);
  return validate(parsed, tools);
}

/** Retorna as tools melhoradas; em qualquer falha, avisa e devolve as originais. */
export async function enhanceTools(tools: ToolDef[], specHash: string): Promise<ToolDef[]> {
  const provider = pickProvider();
  if (!provider) {
    console.error("[api2mcp] aviso: defina OPENAI_API_KEY (ou ANTHROPIC_API_KEY) para usar --enhance; seguindo com as descrições originais.");
    return tools;
  }
  const model = modelFor(provider);
  const key = cacheKey(specHash, provider, model);
  const cache = await readCache();

  if (cache[key]) {
    console.error(`[api2mcp] --enhance: usando cache (${CACHE_FILE})`);
    return apply(tools, cache[key].tools);
  }

  try {
    console.error(`[api2mcp] --enhance: melhorando ${tools.length} tools com ${provider}/${model}...`);
    const enh = await callLlm(tools, provider, model);
    cache[key] = { model, createdAt: new Date().toISOString(), tools: enh };
    await writeCache(cache);
    return apply(tools, enh);
  } catch (err) {
    console.error(`[api2mcp] aviso: --enhance falhou (${(err as Error).message}); seguindo com as descrições originais.`);
    return tools;
  }
}
