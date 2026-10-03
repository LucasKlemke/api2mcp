import { useEffect, useRef, useState, type FormEvent } from "react";
import { backend, type Config } from "./api";

export function Settings({ config, onSaved, onClose }: { config: Config; onSaved: (c: Config) => void; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(config.model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    keyRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const body: Record<string, string> = { openaiModel: model };
      if (key.trim()) body.openaiApiKey = key.trim();
      onSaved(await backend<Config>("/api/settings", { method: "PUT", body }));
      setKey("");
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    setBusy(true);
    setError("");
    try {
      onSaved(await backend<Config>("/api/settings/openai-key", { method: "DELETE" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal card" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className="modal-head">
          <h3 id="settings-title">Configurações</h3>
          <button type="button" className="icon" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <p className="muted small">A chave da OpenAI é usada no chat, em “Gerar com IA” e no --enhance.</p>

        <div className={`key-status ${config.openai ? "ok" : ""}`}>
          {config.openai ? (
            <>
              <span>
                ● Chave configurada <code>{config.keyPreview}</code>
                <small className="muted">{config.keySource === "env" ? " (do .env / ambiente)" : " (salva pela interface)"}</small>
              </span>
              {config.keySource === "interface" && (
                <button type="button" className="ghost small" onClick={removeKey} disabled={busy}>
                  Remover
                </button>
              )}
            </>
          ) : (
            <span>○ Nenhuma chave configurada</span>
          )}
        </div>

        <label>
          {config.openai ? "Trocar a chave da OpenAI" : "Chave da OpenAI"}
          <input
            ref={keyRef}
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
          />
          <small className="muted">
            Crie uma em{" "}
            <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
              platform.openai.com/api-keys
            </a>
            . Ela é testada antes de salvar e fica só na sua máquina, em <code>{config.settingsFile ?? "~/.api2mcp/settings.json"}</code>.
          </small>
        </label>

        <label>
          Modelo
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-5-mini" spellCheck={false} />
        </label>

        {error && <div className="alert error">{error}</div>}
        {saved && <div className="alert ok">Configurações salvas.</div>}

        <div className="actions">
          <button className="primary" disabled={busy}>
            {busy ? (key.trim() ? "Testando a chave…" : "Salvando…") : "Salvar"}
          </button>
          <button type="button" className="ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
      </form>
    </div>
  );
}
