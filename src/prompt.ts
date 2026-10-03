/**
 * Prompt para o usuário colar no assistente de IA dele (Claude Code, Cursor, ChatGPT...) quando a API
 * não tem spec OpenAPI: o assistente mapeia as rotas do código e gera o openapi.json.
 */
export function specPrompt(baseUrl = "http://localhost:3000"): string {
  return `Gere um documento OpenAPI 3.0 (JSON) que descreva a API HTTP deste projeto. Ele será convertido em tools para agentes de IA (MCP) pelo api2mcp, então precisa ser fiel ao código e bem descrito.

## Como fazer

1. Encontre todas as rotas HTTP do projeto. Exemplos de onde procurar:
   - Express/Fastify/Hono: app.get, router.post, app.route...
   - Next.js: app/**/route.ts (GET, POST...) e pages/api/**
   - NestJS: @Controller, @Get, @Post...
   - FastAPI/Flask: @app.get, @router.post, @app.route
   - Django: urls.py e views/viewsets; Laravel: routes/api.php; Rails: config/routes.rb; Spring: @RequestMapping, @GetMapping
   Se você não tiver acesso ao código, me peça para colar os arquivos de rotas e controllers antes de continuar.
2. Para cada rota, leia o handler e descubra:
   - método e caminho (parâmetros de rota no formato {id});
   - parâmetros de query e headers relevantes;
   - corpo da requisição: campos, tipos, obrigatórios e validações (veja zod, joi, yup, class-validator, DTOs, pydantic, serializers);
   - formato da resposta de sucesso e os principais erros.
3. Ignore rotas que um agente não deve usar: health checks, webhooks, login/logout/refresh, callbacks de OAuth, arquivos estáticos e rotas internas de admin.

## Regras do documento

- "openapi": "3.0.3"; "info.title" com o nome do sistema; "servers": [{ "url": "${baseUrl}" }].
- Toda operação com "operationId" único em snake_case no formato verbo_objeto (ex: list_orders, get_order, create_order, update_order, delete_order).
- "summary" curto e "description" explicando o que faz, quando usar e de onde vêm os ids necessários (ex: "use list_orders para descobrir o id").
- Todo parâmetro e todo campo de body com "type" e "description" (com um exemplo de valor).
- Body em "application/json" com schema "type": "object", "properties" e "required".
- Modelos reutilizados em "components.schemas", referenciados com "$ref".
- Se a API exige autenticação, descreva em "components.securitySchemes" (ex: bearer) e aplique em "security".
- Escreva summaries e descriptions em português.
- Não invente rotas nem campos: tudo precisa existir no código. Se algo for incerto, explique em "x-todo" na própria operação.

## Saída

- Se você consegue criar arquivos: salve como openapi.json na raiz do projeto.
- Se não: responda com o JSON completo dentro de um único bloco \`\`\`json.
- Depois, liste em poucas linhas quais rotas entraram e quais foram ignoradas (e por quê).`;
}
