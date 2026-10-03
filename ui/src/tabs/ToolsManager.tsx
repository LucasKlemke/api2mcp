import { useState, type FormEvent } from "react";
import { backend, type Config, type McpSummary, type ParamDraft, type ParamLocation, type ToolDraft } from "../api";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const LOCATIONS: ParamLocation[] = ["path", "query", "header", "body"];
const TYPES = ["string", "number", "integer", "boolean", "array", "object"];

const emptyDraft = (): ToolDraft => ({ name: "", description: "", method: "GET", path: "/", enabled: true, params: [] });
const emptyParam = (): ParamDraft => ({ name: "", in: "query", type: "string", required: false, description: "" });

type Editing = { original: string | null; draft: ToolDraft };

function ToolEditor({
  editing,
  busy,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  editing: Editing;
  busy: boolean;
  error: string;
  onChange: (d: ToolDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const d = editing.draft;
  const set = (patch: Partial<ToolDraft>) => onChange({ ...d, ...patch });
  const setParam = (i: number, patch: Partial<ParamDraft>) => set({ params: d.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  // ao digitar {x} na rota, já cria o parâmetro de path correspondente
  const setPath = (path: string) => {
    const names = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const missing = names.filter((n) => !d.params.some((p) => p.name === n));
    set({ path, params: [...missing.map((n) => ({ ...emptyParam(), name: n, in: "path" as const, required: true })), ...d.params] });
  };

  return (
    <form
      className="tool-editor"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSave();
      }}
    >
      <h4>{editing.original ? `Editar ${editing.original}` : "Nova tool"}</h4>
      <div className="row">
        <label className="grow">
          Nome
          <input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="listar_pedidos" spellCheck={false} required />
        </label>
        <label>
          Método
          <select value={d.method} onChange={(e) => set({ method: e.target.value })}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="grow">
          Rota
          <input value={d.path} onChange={(e) => setPath(e.target.value)} placeholder="/orders/{id}" spellCheck={false} required />
        </label>
      </div>
      <label>
        Descrição <small className="muted">(é o que o agente lê para decidir quando usar a tool)</small>
        <textarea value={d.description} onChange={(e) => set({ description: e.target.value })} rows={3} />
      </label>

      <div className="params-head">
        <h4>Parâmetros</h4>
        <button type="button" className="ghost small" onClick={() => set({ params: [...d.params, emptyParam()] })}>
          + parâmetro
        </button>
      </div>
      {d.params.length === 0 && <p className="muted small">Sem parâmetros.</p>}
      {d.params.map((p, i) => (
        <div key={i} className="param-row">
          <input value={p.name} onChange={(e) => setParam(i, { name: e.target.value })} placeholder="nome" aria-label="Nome do parâmetro" spellCheck={false} />
          <select value={p.in} onChange={(e) => setParam(i, { in: e.target.value as ParamLocation })} aria-label="Onde vai">
            {LOCATIONS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select value={p.type} onChange={(e) => setParam(i, { type: e.target.value })} aria-label="Tipo">
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <label className="check" title="Obrigatório">
            <input type="checkbox" checked={p.required || p.in === "path"} disabled={p.in === "path"} onChange={(e) => setParam(i, { required: e.target.checked })} />
            obrig.
          </label>
          <input className="grow" value={p.description} onChange={(e) => setParam(i, { description: e.target.value })} placeholder="descrição, com exemplo" aria-label="Descrição do parâmetro" />
          <button type="button" className="icon danger" onClick={() => set({ params: d.params.filter((_, j) => j !== i) })} aria-label={`Remover ${p.name || "parâmetro"}`}>
            ✕
          </button>
        </div>
      ))}

      {error && <div className="alert error pre">{error}</div>}
      <div className="actions">
        <button className="primary" disabled={busy}>
          {busy ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" className="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function ToolsManager({
  mcp,
  config,
  onChange,
  openSettings,
}: {
  mcp: McpSummary;
  config: Config;
  onChange: (m: McpSummary) => void;
  openSettings: () => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  const base = `/api/mcps/${mcp.id}/tools`;
  const active = mcp.tools.filter((t) => t.enabled).length;

  const startEdit = (e: Editing | null) => {
    setError("");
    setEditing(e);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const url = editing.original ? `${base}/${encodeURIComponent(editing.original)}` : base;
      onChange(await backend<McpSummary>(url, { method: editing.original ? "PUT" : "POST", body: editing.draft }));
      setEditing(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (tool: ToolDraft) => {
    setListError("");
    try {
      onChange(await backend<McpSummary>(`${base}/${encodeURIComponent(tool.name)}`, { method: "PUT", body: { ...tool, enabled: !tool.enabled } }));
    } catch (err) {
      setListError((err as Error).message);
    }
  };

  const remove = async (tool: ToolDraft) => {
    if (!window.confirm(`Remover a tool "${tool.name}"? Isso não pode ser desfeito.`)) return;
    setListError("");
    try {
      onChange(await backend<McpSummary>(`${base}/${encodeURIComponent(tool.name)}`, { method: "DELETE" }));
      if (editing?.original === tool.name) setEditing(null);
    } catch (err) {
      setListError((err as Error).message);
    }
  };

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setGenerating(true);
    setListError("");
    try {
      const { draft } = await backend<{ draft: ToolDraft }>(`${base}/generate`, { body: { prompt } });
      startEdit({ original: null, draft });
      setPrompt("");
    } catch (err) {
      setListError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="tools-manager">
      <div className="tools-head">
        <span className="muted small">
          {active} de {mcp.tools.length} tools ativas · só as ativas aparecem para o agente
        </span>
        <button className="primary small" onClick={() => startEdit({ original: null, draft: emptyDraft() })} disabled={editing?.original === null}>
          + Nova tool
        </button>
      </div>

      <form className="ai-gen" onSubmit={generate}>
        <span className="ai-icon">✦</span>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={config.openai ? "Gerar com IA: descreva a tool, ex. “buscar só as tarefas pendentes”" : "Gerar com IA: configure sua chave da OpenAI →"}
          disabled={!config.openai || generating}
        />
        {config.openai ? (
          <button className="ghost small" disabled={generating || !prompt.trim()}>
            {generating ? "Gerando…" : "Gerar"}
          </button>
        ) : (
          <button type="button" className="primary small" onClick={openSettings}>
            ⚙ Configurar
          </button>
        )}
      </form>

      {listError && <div className="alert error">{listError}</div>}

      {editing?.original === null && (
        <ToolEditor editing={editing} busy={busy} error={error} onChange={(draft) => setEditing({ ...editing, draft })} onSave={save} onCancel={() => setEditing(null)} />
      )}

      <ul className="tool-rows">
        {mcp.tools.map((t) =>
          editing?.original === t.name ? (
            <li key={t.name}>
              <ToolEditor editing={editing} busy={busy} error={error} onChange={(draft) => setEditing({ ...editing, draft })} onSave={save} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={t.name} className={t.enabled ? "" : "disabled"}>
              <label className="switch" title={t.enabled ? "Desativar" : "Ativar"}>
                <input type="checkbox" checked={t.enabled} onChange={() => toggle(t)} aria-label={`${t.enabled ? "Desativar" : "Ativar"} ${t.name}`} />
                <span />
              </label>
              <div className="tool-main">
                <div className="tool-title">
                  <code className="tool-name">{t.name}</code>
                  <span className={`method-tag ${t.method.toLowerCase()}`}>{t.method}</span>
                  <code className="muted small">{t.path}</code>
                </div>
                <p className="tool-text">{t.description}</p>
                {t.params.length > 0 && (
                  <p className="muted small">
                    {t.params.map((p) => `${p.name}${p.required || p.in === "path" ? "*" : ""}`).join(", ")}
                  </p>
                )}
              </div>
              <div className="tool-actions">
                <button className="ghost small" onClick={() => startEdit({ original: t.name, draft: structuredClone(t) })}>
                  Editar
                </button>
                <button className="icon danger" onClick={() => remove(t)} aria-label={`Remover ${t.name}`}>
                  ✕
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
      {mcp.tools.length === 0 && !editing && <p className="empty small">Nenhuma tool. Crie uma ou gere com IA.</p>}
    </div>
  );
}
