/**
 * Cliente MCP de teste.
 *   npm run demo                 -> sobe o api2mcp via stdio e conversa com ele
 *   npm run demo -- --http       -> conecta em http://localhost:9000/mcp (rode o api2mcp --transport http antes)
 *   npm run demo -- --enhance    -> stdio com --enhance
 * Requer a API de exemplo (repositório todo-api) rodando em http://localhost:8000.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const API_URL = process.env.API_URL ?? "http://localhost:8000";
const MCP_URL = process.env.MCP_URL ?? "http://localhost:9000/mcp";
const useHttp = process.argv.includes("--http");
const enhance = process.argv.includes("--enhance");

const transport: Transport = useHttp
  ? new StreamableHTTPClientTransport(new URL(MCP_URL))
  : new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/cli.ts", API_URL, ...(enhance ? ["--enhance"] : [])],
      stderr: "inherit",
    });

const client = new Client({ name: "api2mcp-demo", version: "0.1.0" });
await client.connect(transport);
console.log(`Conectado via ${useHttp ? MCP_URL : "stdio"}\n`);

const { tools } = await client.listTools();
console.log("Tools:", tools.map((t) => t.name).join(", "), "\n");

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
  console.log(`> ${name}(${JSON.stringify(args)})${res.isError ? "  [isError]" : ""}\n${text}\n`);
  return text;
}

const a = JSON.parse(await call("create_task", { title: "Comprar pão" }));
await call("create_task", { title: "Estudar MCP" });
await call("update_task", { id: a.id, done: true });
await call("list_tasks");
await call("get_task", { id: 99 });

await client.close();
