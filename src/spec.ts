import { createHash } from "node:crypto";
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

export async function loadSpec(baseUrl: string, specOption?: string): Promise<LoadedSpec> {
  let raw: unknown;
  let source: string;

  if (specOption) {
    source = specOption;
    try {
      // swagger-parser lê arquivos locais (JSON ou YAML) direto pelo caminho
      raw = isUrl(specOption) ? await fetchJson(specOption) : specOption;
    } catch (err) {
      throw new Error(`Não foi possível carregar o spec em ${specOption}: ${(err as Error).message}`);
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
          `Informe o spec manualmente com --spec <url-ou-arquivo>.`,
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
