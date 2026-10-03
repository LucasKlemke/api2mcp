# api2mcp

Transforma qualquer API com spec OpenAPI 3.x em um servidor MCP, com um comando:

```bash
npx api2mcp-cli https://sua-api.com
```

Com `--enhance`, um LLM (OpenAI ou Claude) reescreve as descrições das tools para agentes: o que fazem, quando usar, quando **não** usar, qual tool chamar antes, e exemplos para cada parâmetro. Nomes, tipos, `required`, método e rota nunca são alterados (validado no código).

Inclui uma interface web (`api2mcp ui`) para explorar a API, criar MCPs e testá-los num chat.

## Instalação

```bash
npm install -g api2mcp-cli    # instala o comando `api2mcp`
# ou, sem instalar:
npx api2mcp-cli <url>
```

Requer Node.js 20.12+.

## Uso

```bash
api2mcp http://localhost:8000 --list              # lista as tools geradas
api2mcp http://localhost:8000                     # servidor MCP via stdio
api2mcp http://localhost:8000 --transport http    # servidor MCP em http://localhost:9000/mcp
```

### Opções

```
api2mcp <baseUrl>
  --spec <urlOuArquivo>     spec OpenAPI (opcional; JSON ou YAML)
  --name <nome>             nome do servidor (padrão: info.title do spec)
  --transport <stdio|http>  padrão: stdio
  --port <n>                padrão: 9000 (só http)
  --header <"K: V">         header extra em toda chamada (repetível)
  --list                    só lista as tools geradas e sai
  --enhance                 melhora as descrições com um LLM

api2mcp ui [--port 4100]    interface web
```

Sem `--spec`, o spec é procurado em `/openapi.json`, `/swagger.json`, `/v3/api-docs` e `/docs/openapi.json`.

API com autenticação:

```bash
api2mcp https://api.exemplo.com --spec ./openapi.yaml --header "Authorization: Bearer $TOKEN"
```

## Interface web

```bash
api2mcp ui        # http://localhost:4100
```

- **API**: explorer estilo Swagger/FastAPI gerado do spec; preencha parâmetros/body, execute e veja o `curl`, status e resposta.
- **MCP**: crie um servidor MCP a partir da URL da API (com spec, headers de autenticação e `--enhance` opcionais). Cada MCP criado é um servidor MCP real em `http://localhost:4100/mcp/<id>` (Streamable HTTP), com o comando `claude mcp add` pronto para copiar. Ao lado, um chat com um modelo da OpenAI que chama as tools desse MCP para testar.

Os MCPs criados ficam em `.api2mcp/servers.json` no diretório onde você rodou o comando (inclusive os headers, em texto puro: prefira tokens de teste). Os endpoints `/mcp/<id>` não têm autenticação: use só em localhost.

## `--enhance` e chat

Configure num `.env` no diretório atual (ou como variáveis de ambiente):

```bash
OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-5-mini       modelo do chat da interface
# API2MCP_MODEL=gpt-5-mini      modelo do --enhance
# API2MCP_PROVIDER=openai       ou anthropic (com ANTHROPIC_API_KEY)
```

```bash
api2mcp http://localhost:8000 --enhance --list    # mostra ANTES / DEPOIS lado a lado
```

O resultado fica em cache em `.api2mcp/enhanced.json` (chave = hash do spec + provedor + modelo); se o spec não mudou, o LLM não é chamado de novo. Sem key, a CLI avisa e segue com as descrições originais.

## Conectar a agentes

Claude Code:

```bash
claude mcp add minha-api -- npx api2mcp-cli http://localhost:8000 --enhance
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "minha-api": { "command": "npx", "args": ["api2mcp-cli", "http://localhost:8000", "--enhance"] }
  }
}
```

## Desenvolvimento

```bash
npm install
npm run dev          # `api2mcp ui` com reload (4100) + Vite com HMR (5173)
npm run build        # CLI em dist/ + interface em dist/ui
npm link             # deixa o comando `api2mcp` local disponível globalmente
npm run typecheck
```

Para testar ponta a ponta, rode a API de exemplo do repositório **todo-api** em `http://localhost:8000` e:

```bash
npm run demo                 # cliente MCP via stdio
npm run demo -- --http       # cliente MCP via http (rode `api2mcp <url> --transport http` antes)
```

| Arquivo | Papel |
|---|---|
| `src/spec.ts` | descobre/baixa o spec e dereferencia `$ref` (swagger-parser) |
| `src/tools.ts` | operação OpenAPI → tool (path/query/header/body viram propriedades de topo; colisão → `body`) |
| `src/executor.ts` | monta a requisição, chama a API e devolve `HTTP <status>: <corpo>` com `isError` em falhas |
| `src/server.ts` | `Server` MCP de baixo nível, transports stdio e Streamable HTTP |
| `src/enhance.ts` | reescrita das descrições via LLM (OpenAI ou Claude), validação e cache |
| `src/cli.ts` | CLI (commander) |
| `src/web/` | `api2mcp ui`: hospeda MCPs em `/mcp/:id`, explorer e chat (OpenAI ↔ MCP) |
| `ui/` | interface React (Vite), buildada em `dist/ui` |

## Limitações

Só OpenAPI 3.x com body JSON (sem form-encoded, upload de arquivos ou paginação automática), sem OAuth, e todas as operações do spec viram tools (APIs muito grandes precisam de um spec recortado).
