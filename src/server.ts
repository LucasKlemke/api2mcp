import { createServer, type IncomingMessage } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { executeTool } from "./executor.js";
import type { ToolDef } from "./tools.js";

export type ServerOptions = {
  name: string;
  tools: ToolDef[];
  baseUrl: string;
  headers: Record<string, string>;
};

export function createMcpServer({ name, tools, baseUrl, headers }: ServerOptions): Server {
  const server = new Server({ name, version: "0.1.0" }, { capabilities: { tools: {} } });
  const byName = new Map(tools.map((t) => [t.name, t]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Tool "${req.params.name}" não existe. Tools disponíveis: ${[...byName.keys()].join(", ")}` }],
        isError: true,
      };
    }
    console.error(`[api2mcp] ${tool.name} -> ${tool.method} ${tool.path}`);
    return executeTool(tool, (req.params.arguments ?? {}) as Record<string, unknown>, baseUrl, headers);
  });

  return server;
}

export async function runStdio(opts: ServerOptions): Promise<void> {
  // stdout é o canal do protocolo: logs só em stderr
  await createMcpServer(opts).connect(new StdioServerTransport());
  console.error(`[api2mcp] "${opts.name}" pronto via stdio com ${opts.tools.length} tools (API: ${opts.baseUrl})`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

export async function runHttp(opts: ServerOptions, port: number): Promise<void> {
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Use o endpoint /mcp");
      return;
    }
    if (req.method !== "POST") {
      // modo stateless: sem streams GET nem encerramento de sessão
      res
        .writeHead(405, { "Content-Type": "application/json", Allow: "POST" })
        .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
      return;
    }

    try {
      const body = await readJson(req);
      const server = createMcpServer(opts);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("[api2mcp] erro no request HTTP:", err);
      if (!res.headersSent) {
        res
          .writeHead(500, { "Content-Type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: (err as Error).message }, id: null }));
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  console.error(`[api2mcp] "${opts.name}" pronto em http://localhost:${port}/mcp com ${opts.tools.length} tools (API: ${opts.baseUrl})`);
}
