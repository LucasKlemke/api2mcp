#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { enhanceTools } from "./enhance.js";
import { runHttp, runStdio } from "./server.js";
import { loadSpec } from "./spec.js";
import { specToTools, type ToolDef } from "./tools.js";

try {
  // .env do diretório atual (OPENAI_API_KEY etc.), se existir
  process.loadEnvFile();
} catch {
  // sem .env: segue com as variáveis do ambiente
}

type Options = {
  spec?: string;
  name?: string;
  transport: "stdio" | "http";
  port: number;
  header: Record<string, string>;
  list?: boolean;
  enhance?: boolean;
};

function parseHeader(value: string, acc: Record<string, string>): Record<string, string> {
  const idx = value.indexOf(":");
  if (idx <= 0) throw new InvalidArgumentError(`Header inválido "${value}". Use o formato "Nome: valor".`);
  return { ...acc, [value.slice(0, idx).trim()]: value.slice(idx + 1).trim() };
}

function parsePort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) throw new InvalidArgumentError("Porta inválida.");
  return n;
}

function parseTransport(value: string): "stdio" | "http" {
  if (value !== "stdio" && value !== "http") throw new InvalidArgumentError('Use "stdio" ou "http".');
  return value;
}

function indent(s: string, pad = "    "): string {
  return s
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

function paramLines(tool: ToolDef): string[] {
  const required = new Set(tool.inputSchema.required ?? []);
  return Object.entries(tool.inputSchema.properties).map(([k, s]) => {
    const type = Array.isArray(s.type) ? s.type.join("|") : (s.type ?? "any");
    return `${k}${required.has(k) ? "*" : ""} (${tool.paramLocations[k]}, ${type})${s.description ? `: ${s.description}` : ""}`;
  });
}

// --list imprime em stdout: o servidor não sobe, então não há conflito com o protocolo
function printTools(tools: ToolDef[], original?: ToolDef[]): void {
  for (const [i, tool] of tools.entries()) {
    console.log(`\n${tool.name}  [${tool.method} ${tool.path}]`);
    const before = original?.[i];
    if (before) {
      console.log("  ANTES:");
      console.log(indent(before.description));
      for (const l of paramLines(before)) console.log(indent(`- ${l}`, "      "));
      console.log("  DEPOIS:");
      console.log(indent(tool.description));
      for (const l of paramLines(tool)) console.log(indent(`- ${l}`, "      "));
    } else {
      console.log(indent(tool.description));
      for (const l of paramLines(tool)) console.log(indent(`- ${l}`, "      "));
    }
  }
  console.log(`\n${tools.length} tools (* = obrigatório)`);
}

const program = new Command()
  .name("api2mcp")
  // opções depois de `ui` pertencem ao subcomando (ex: api2mcp ui --port 4200)
  .enablePositionalOptions()
  .description("Transforma uma API com spec OpenAPI em um servidor MCP")
  .argument("<baseUrl>", "URL base da API, ex: http://localhost:8000")
  .option("--spec <urlOuArquivo>", "spec OpenAPI (URL ou arquivo local)")
  .option("--name <nome>", "nome do servidor (padrão: info.title do spec)")
  .option("--transport <stdio|http>", "transporte MCP", parseTransport, "stdio")
  .option("--port <n>", "porta do transporte http", parsePort, 9000)
  .option("--header <K: V>", "header extra em toda chamada (repetível)", parseHeader, {})
  .option("--list", "só lista as tools geradas e sai")
  .option("--enhance", "usa um LLM para reescrever as descrições para agentes")
  .action(async (baseUrl: string, opts: Options) => {
    const { spec, source, hash } = await loadSpec(baseUrl, opts.spec);
    console.error(`[api2mcp] spec carregado de ${source}`);

    const original = specToTools(spec);
    const tools = opts.enhance ? await enhanceTools(original, hash) : original;

    if (opts.list) {
      printTools(tools, opts.enhance && tools !== original ? original : undefined);
      return;
    }

    const serverOpts = { name: opts.name ?? spec.info?.title ?? "api2mcp", tools, baseUrl, headers: opts.header };
    if (opts.transport === "http") await runHttp(serverOpts, opts.port);
    else await runStdio(serverOpts);
  });

program
  .command("ui")
  .description("abre a interface web: explorer da API, criação de MCPs e chat de teste")
  .option("--port <n>", "porta da interface", parsePort, Number(process.env.WEB_PORT ?? 4100))
  .action(async (opts: { port: number }) => {
    const { startWeb } = await import("./web/server.js");
    await startWeb({ port: opts.port });
  });

program.parseAsync().catch((err: Error) => {
  console.error(`[api2mcp] erro: ${err.message}`);
  process.exit(1);
});
