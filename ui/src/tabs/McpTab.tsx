import { useEffect, useRef, useState, type FormEvent } from "react";
import { backend, type ChatMessage, type Config, type McpSummary } from "../api";
import { SpecHelp, cleanSpecError, isNoSpecError } from "../SpecHelp";
import { ToolsManager } from "./ToolsManager";

const SUGGESTIONS = [
  "O que você consegue fazer com esta API?",
  "Liste o que existe hoje",
  "Crie um item de exemplo e me mostre o resultado",
]

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "api";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ghost small"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

function CreateForm({ apiUrl, config, onCreated, openSettings }: { apiUrl: string; config: Config; onCreated: (m: McpSummary) => void; openSettings: () => void }) {
  const [baseUrl, setBaseUrl] = useState(apiUrl);
  const [name, setName] = useState("");
  const [enhance, setEnhance] = useState(false);
  const [spec, setSpec] = useState("");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setBaseUrl(apiUrl);
  }, [apiUrl]);

  const create = async (specValue: string) => {
    setBusy(true);
    setError("");
    try {
      onCreated(await backend<McpSummary>("/api/mcps", { body: { baseUrl, name, enhance, spec: specValue, headers } }));
      setName("");
      setSpec("");
      setHeaders("");
      setShowHelp(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create(spec);
  };

  return (
    <form className="card create" onSubmit={submit}>
      <h3>Novo MCP</h3>
      <label>
        URL da API
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} required />
      </label>
      <label>
        Nome <small className="muted">(opcional, padrão: título do spec)</small>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="todo" />
      </label>
      <details className="advanced">
        <summary>Avançado: spec e autenticação</summary>
        <label>
          Spec OpenAPI <small className="muted">(URL, arquivo ou o conteúdo colado; padrão: procura em /openapi.json etc.)</small>
          <textarea value={spec} onChange={(e) => setSpec(e.target.value)} rows={2} placeholder="https://.../openapi.json" spellCheck={false} />
        </label>
        <button type="button" className="link" onClick={() => setShowHelp(!showHelp)}>
          Não tem spec? Gere um com a sua IA
        </button>
        <label>
          Headers <small className="muted">(um por linha, enviados em toda chamada)</small>
          <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={2} placeholder="Authorization: Bearer sk_test_..." spellCheck={false} />
        </label>
        <small className="muted">Os headers ficam salvos em texto puro em .api2mcp/servers.json; prefira tokens de teste.</small>
      </details>
      <label className="check">
        <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} />
        <span>
          Melhorar descrições com LLM <code>--enhance</code>
          {!config.openai && (
            <small className="muted">
              {" "}
              · requer{" "}
              <button type="button" className="link" onClick={openSettings}>
                chave da OpenAI
              </button>
            </small>
          )}
        </span>
      </label>
      <button className="primary" disabled={busy}>
        {busy ? (enhance ? "Gerando e melhorando…" : "Gerando…") : "Criar MCP"}
      </button>
      {error && <div className="alert error pre">{cleanSpecError(error)}</div>}
      {(showHelp || isNoSpecError(error)) && (
        <SpecHelp
          baseUrl={baseUrl}
          busy={busy}
          onUseSpec={(s) => {
            setSpec(s);
            create(s);
          }}
        />
      )}
    </form>
  );
}

function ToolStep({ name, args, result }: { name: string; args: string; result?: string }) {
  const isError = result?.startsWith("ERRO:");
  let prettyArgs = args;
  try {
    prettyArgs = JSON.stringify(JSON.parse(args || "{}"));
  } catch {
    // mantém como veio
  }
  return (
    <details className={`tool-step ${isError ? "error" : ""} ${result === undefined ? "pending" : ""}`}>
      <summary>
        <span className="tool-icon">{isError ? "⚠" : "⚙"}</span>
        <code>
          {name}({prettyArgs === "{}" ? "" : prettyArgs})
        </code>
      </summary>
      <pre className="code">{result ?? "…"}</pre>
    </details>
  );
}

function Chat({
  mcp,
  config,
  messages,
  setMessages,
  openSettings,
}: {
  mcp: McpSummary;
  config: Config;
  messages: ChatMessage[];
  setMessages: (m: ChatMessage[]) => void;
  openSettings: () => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  // rola só o log do chat (scrollIntoView rolaria a página inteira)
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const res = await backend<{ messages: ChatMessage[] }>("/api/chat", { body: { mcpId: mcp.id, messages: next } });
      setMessages(res.messages);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const results = new Map(messages.filter((m) => m.role === "tool").map((m) => [(m as { tool_call_id: string }).tool_call_id, m.content]));

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              Converse com o MCP <b>{mcp.name}</b>. O modelo <code>{config.model || "OpenAI"}</code> chama as tools via protocolo MCP.
            </p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)} disabled={!config.openai}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === "user")
            return (
              <div key={i} className="bubble user">
                {m.content}
              </div>
            );
          if (m.role === "assistant")
            return (
              <div key={i} className="assistant-turn">
                {m.tool_calls?.map((c) => <ToolStep key={c.id} name={c.function.name} args={c.function.arguments} result={results.get(c.id)} />)}
                {m.content && <div className="bubble assistant">{m.content}</div>}
              </div>
            );
          return null;
        })}
        {busy && <div className="bubble assistant typing">pensando e chamando tools…</div>}
      </div>

      {!config.openai && (
        <div className="alert warn needs-key">
          <span>Para usar o chat, configure sua chave da OpenAI.</span>
          <button className="primary small" onClick={openSettings}>
            ⚙ Configurar
          </button>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Peça algo em linguagem natural…" disabled={!config.openai} />
        <button className="primary" disabled={busy || !input.trim() || !config.openai}>
          Enviar
        </button>
        {messages.length > 0 && (
          <button type="button" className="ghost" onClick={() => setMessages([])} disabled={busy}>
            Limpar
          </button>
        )}
      </form>
    </div>
  );
}

export function McpTab({ apiUrl, config, openSettings }: { apiUrl: string; config: Config; openSettings: () => void }) {
  const [mcps, setMcps] = useState<McpSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const [error, setError] = useState("");
  const [view, setView] = useState<"tools" | "chat">("chat");

  useEffect(() => {
    backend<McpSummary[]>("/api/mcps")
      .then((list) => {
        setMcps(list);
        setSelected((s) => s ?? list[0]?.id ?? null);
      })
      .catch((err: Error) => setError(`Backend web indisponível: ${err.message}`));
  }, []);

  const remove = async (id: string) => {
    await backend(`/api/mcps/${id}`, { method: "DELETE" }).catch(() => {});
    setMcps((list) => list.filter((m) => m.id !== id));
    if (selected === id) setSelected(null);
  };

  const current = mcps.find((m) => m.id === selected);

  return (
    <div className="mcp">
      <aside className="mcp-side">
        <CreateForm
          apiUrl={apiUrl}
          config={config}
          openSettings={openSettings}
          onCreated={(m) => {
            setMcps((list) => [...list, m]);
            setSelected(m.id);
          }}
        />
        {error && <div className="alert error">{error}</div>}
        <h3 className="side-title">Servidores MCP</h3>
        {mcps.length === 0 ? (
          <p className="empty small">Nenhum MCP ainda. Crie um a partir da URL da API.</p>
        ) : (
          <ul className="mcp-list">
            {mcps.map((m) => (
              <li key={m.id} className={m.id === selected ? "selected" : ""}>
                <button className="mcp-item" onClick={() => setSelected(m.id)}>
                  <span className="mcp-name">{m.name}</span>
                  <span className="muted small">
                    {m.tools.filter((t) => t.enabled).length} tools{m.enhanced && " · ✦ enhanced"}
                  </span>
                </button>
                <button className="icon danger" onClick={() => remove(m.id)} aria-label={`Remover ${m.name}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="mcp-main">
        {current ? (
          <>
            <div className="card mcp-info">
              <div className="mcp-info-head">
                <h2>
                  {current.name} {current.enhanced && <span className="badge">✦ enhanced</span>}
                </h2>
                <span className="muted small">
                  {current.baseUrl}
                  {current.headerNames?.length ? ` · headers: ${current.headerNames.join(", ")}` : ""}
                </span>
              </div>
              <div className="snippet">
                <code>{current.url}</code>
                <CopyButton text={current.url} />
              </div>
              <div className="snippet">
                <code>claude mcp add --transport http {slug(current.name)} {current.url}</code>
                <CopyButton text={`claude mcp add --transport http ${slug(current.name)} ${current.url}`} />
              </div>
            </div>
            <div className="segmented view-switch" role="tablist">
              <button role="tab" aria-selected={view === "chat"} className={view === "chat" ? "active" : ""} onClick={() => setView("chat")}>
                Chat
              </button>
              <button role="tab" aria-selected={view === "tools"} className={view === "tools" ? "active" : ""} onClick={() => setView("tools")}>
                Tools ({current.tools.filter((t) => t.enabled).length})
              </button>
            </div>
            {view === "tools" ? (
              <ToolsManager
                key={current.id}
                mcp={current}
                config={config}
                openSettings={openSettings}
                onChange={(updated) => setMcps((list) => list.map((m) => (m.id === updated.id ? updated : m)))}
              />
            ) : (
              <Chat key={current.id} mcp={current} config={config} openSettings={openSettings} messages={chats[current.id] ?? []} setMessages={(msgs) => setChats((c) => ({ ...c, [current.id]: msgs }))} />
            )}
          </>
        ) : (
          <div className="empty big">
            <p>Crie um servidor MCP a partir da sua API para conversar com ele aqui.</p>
          </div>
        )}
      </div>
    </div>
  );
}
