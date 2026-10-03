import { useEffect, useState } from "react";
import { backend } from "./api";

export const isNoSpecError = (msg: string) => msg.includes("Nenhum spec OpenAPI encontrado");

/** Tira as dicas de terminal (--spec, "api2mcp prompt") da mensagem; na interface a ajuda aparece embaixo. */
export const cleanSpecError = (msg: string) => msg.split("\nInforme o spec manualmente")[0];

/**
 * Ajuda para APIs sem spec: prompt para o usuário colar no assistente de IA dele,
 * e um campo para colar de volta o openapi.json gerado.
 */
export function SpecHelp({ baseUrl, busy, onUseSpec }: { baseUrl: string; busy?: boolean; onUseSpec: (spec: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [spec, setSpec] = useState("");

  useEffect(() => {
    backend<{ prompt: string }>(`/api/spec-prompt?baseUrl=${encodeURIComponent(baseUrl)}`)
      .then((r) => setPrompt(r.prompt))
      .catch(() => {});
  }, [baseUrl]);

  const copy = () => {
    navigator.clipboard?.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="spec-help">
      <h4>Não tem Swagger? Gere um com a sua IA</h4>
      <ol>
        <li>
          Copie o prompt e cole no assistente que tem acesso ao código do sistema (Claude Code, Cursor, Copilot). Também funciona num chat (ChatGPT, Claude) se você
          colar os arquivos de rotas junto.
          <div className="spec-help-actions">
            <button type="button" className="primary small" onClick={copy} disabled={!prompt}>
              {copied ? "Copiado ✓" : "Copiar prompt"}
            </button>
            <details>
              <summary>ver prompt</summary>
              <pre className="code">{prompt}</pre>
            </details>
          </div>
        </li>
        <li>
          Cole aqui o resultado: o conteúdo do <code>openapi.json</code> gerado, ou a resposta inteira do chat. Se ele salvou o arquivo no projeto, você também pode
          informar o caminho.
          <textarea value={spec} onChange={(e) => setSpec(e.target.value)} rows={4} placeholder='{ "openapi": "3.0.3", ... }  ou  /caminho/do/projeto/openapi.json' spellCheck={false} />
        </li>
      </ol>
      <button type="button" className="primary" disabled={busy || !spec.trim()} onClick={() => onUseSpec(spec.trim())}>
        {busy ? "Carregando…" : "Usar este spec"}
      </button>
    </div>
  );
}
