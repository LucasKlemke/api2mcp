import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";

export type LoadedSpec = { spec: OpenAPIV3.Document; source: string; hash: string };

const CANDIDATE_PATHS = ["/openapi.json", "/swagger.json", "/v3/api-docs", "/docs/openapi.json"];

const isUrl = (s: string) => /^https?:\/\//i.test(s);

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  if (!body || (typeof body.openapi !== "string" && typeof body.swagger !== "string")) {
    throw new Error("resposta não é um spec OpenAPI");
  }
  return body;
}

/** Parece o conteúdo de um spec (colado), e não uma URL ou caminho? */
const looksLikeContent = (s: string) => /```|^\s*\{|^\s*(openapi|swagger)\s*:/m.test(s);

/**
 * Extrai o spec de um texto colado: aceita JSON/YAML puro ou a resposta inteira de um chat,
 * com texto antes/depois e o spec dentro de um bloco ```json / ```yaml.
 * Devolve um objeto (JSON) ou o caminho de um arquivo temporário (YAML).
 */
async function parseContent(text: string): Promise<unknown> {
  const fenced = [...text.matchAll(/```[a-zA-Z]*\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const body = (fenced.find((b) => /"?(openapi|swagger)"?\s*:/.test(b)) ?? text).trim();
  if (body.startsWith("{")) {
    try {
      return JSON.parse(body);
    } catch (err) {
      throw new Error(`O spec colado não é um JSON válido: ${(err as Error).message}`);
    }
  }
  if (/^(openapi|swagger)\s*:/m.test(body)) {
    const file = join(tmpdir(), `api2mcp-spec-${createHash("sha256").update(body).digest("hex").slice(0, 12)}.yaml`);
    await writeFile(file, body);
    return file;
  }
  throw new Error("Não encontrei um spec OpenAPI no texto colado (esperava JSON ou YAML começando com openapi:).");
}

export async function loadSpec(baseUrl: string, specOption?: string): Promise<LoadedSpec> {
  let raw: unknown;
  let source: string;

  if (specOption) {
    source = specOption;
    if (isUrl(specOption)) {
      try {
        raw = await fetchJson(specOption);
      } catch (err) {
        throw new Error(`Não foi possível carregar o spec em ${specOption}: ${(err as Error).message}`);
      }
    } else if (existsSync(specOption)) {
      // swagger-parser lê arquivos locais (JSON ou YAML) direto pelo caminho
      raw = specOption;
    } else if (looksLikeContent(specOption)) {
      raw = await parseContent(specOption);
      source = "spec colado";
    } else {
      throw new Error(`Arquivo de spec não encontrado: ${specOption}`);
    }
  } else {
    const base = baseUrl.replace(/\/+$/, "");
    const tried: string[] = [];
    for (const path of CANDIDATE_PATHS) {
      const url = base + path;
      try {
        raw = await fetchJson(url);
        source = url;
        break;
      } catch (err) {
        tried.push(`  - ${url} (${(err as Error).message})`);
      }
    }
    if (!raw) {
      throw new Error(
        `Nenhum spec OpenAPI encontrado em ${base}. Caminhos tentados:\n${tried.join("\n")}\n` +
          `Informe o spec manualmente com --spec <url-ou-arquivo>.\n` +
          `Não tem spec? Rode "api2mcp prompt ${base}" e cole o prompt no seu assistente de IA (Claude Code, Cursor, ChatGPT) para gerar um openapi.json a partir do código.`,
      );
    }
    source ??= base;
  }

  const spec = (await SwaggerParser.dereference(raw as never)) as OpenAPIV3.Document;
  if (!("openapi" in spec)) {
    throw new Error("Specs Swagger 2.0 não são suportados ainda; use um spec OpenAPI 3.x.");
  }
  const hash = createHash("sha256").update(JSON.stringify(spec)).digest("hex");
  return { spec, source: source!, hash };
}
