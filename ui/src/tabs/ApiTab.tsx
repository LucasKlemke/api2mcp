import { useEffect, useState } from "react";
import { backend, exampleFor, type ToolDef } from "../api";

type Inspect = { title?: string; source: string; tools: ToolDef[] };

type Result = { status: number; ok: boolean; ms: number; body: string; url: string; curl: string };

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function Operation({ tool, apiUrl }: { tool: ToolDef; apiUrl: string }) {
  const locs = tool.paramLocations ?? {};
  const required = new Set(tool.inputSchema.required ?? []);
  const fields = Object.entries(tool.inputSchema.properties).filter(([k]) => locs[k] !== "body");
  const bodyKeys = Object.keys(locs).filter((k) => locs[k] === "body");

  const initialBody = () => {
    if (!bodyKeys.length) return "";
    const value = tool.wrappedBody
      ? exampleFor(tool.inputSchema.properties.body)
      : Object.fromEntries(bodyKeys.map((k) => [k, exampleFor(tool.inputSchema.properties[k])]));
    return JSON.stringify(value, null, 2);
  };

  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState(initialBody);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const execute = async () => {
    setError("");
    let path = tool.path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = {};
    for (const [k] of fields) {
      const v = values[k]?.trim();
      if (!v) {
        if (required.has(k)) return setError(`Preencha "${k}".`);
        continue;
      }
      if (locs[k] === "path") path = path.replace(`{${k}}`, encodeURIComponent(v));
      else if (locs[k] === "query") query.append(k, v);
      else if (locs[k] === "header") headers[k] = v;
    }
    let payload: string | undefined;
    if (bodyKeys.length && body.trim()) {
      try {
        payload = JSON.stringify(JSON.parse(body));
      } catch {
        return setError("O body não é um JSON válido.");
      }
      headers["Content-Type"] = "application/json";
    }
    const qs = query.toString();
    const url = apiUrl.replace(/\/+$/, "") + path + (qs ? `?${qs}` : "");
    const curl = [
      `curl -X ${tool.method} '${url}'`,
      ...Object.entries(headers).map(([k, v]) => `  -H '${k}: ${v}'`),
      ...(payload ? [`  -d '${payload}'`] : []),
    ].join(" \\\n");

    setBusy(true);
    const t0 = performance.now();
    try {
      const res = await fetch(url, { method: tool.method, headers, body: payload });
      const text = await res.text();
      setResult({ status: res.status, ok: res.ok, ms: Math.round(performance.now() - t0), body: pretty(text), url, curl });
    } catch (err) {
      setError(`Falha de rede: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`op ${tool.method.toLowerCase()} ${open ? "open" : ""}`}>
      <button className="op-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="method">{tool.method}</span>
        <code className="path">{tool.path}</code>
        <span className="summary">{tool.description.split("\n")[0]}</span>
        <code className="opname">{tool.name}</code>
      </button>

      {open && (
        <div className="op-body">
          {tool.description.includes("\n") && <p className="muted pre">{tool.description}</p>}

          {fields.length > 0 && (
            <div className="params">
              <h4>Parâmetros</h4>
              {fields.map(([k, s]) => (
                <label key={k} className="param">
                  <span className="pname">
                    {k}
                    {required.has(k) && <b className="req">*</b>}
                    <small>
                      {Array.isArray(s.type) ? s.type.join(" | ") : s.type} · {locs[k]}
                    </small>
                  </span>
                  <input
                    value={values[k] ?? ""}
                    placeholder={s.examples?.[0] !== undefined ? String(s.examples[0]) : s.description ?? ""}
                    onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                  />
                  {s.description && <small className="muted">{s.description}</small>}
                </label>
              ))}
            </div>
          )}

          {bodyKeys.length > 0 && (
            <div className="params">
              <h4>
                Body <small className="muted">application/json</small>
              </h4>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(12, body.split("\n").length + 1)} spellCheck={false} />
              <ul className="schema-hints">
                {bodyKeys.map((k) => {
                  const s = tool.inputSchema.properties[k];
                  return (
                    <li key={k}>
                      <code>{k}</code>
                      {required.has(k) && <b className="req">*</b>} <small className="muted">{s?.type}</small> {s?.description}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="actions">
            <button className="primary" onClick={execute} disabled={busy}>
              {busy ? "Executando…" : "Executar"}
            </button>
            {result && (
              <button className="ghost" onClick={() => setResult(null)}>
                Limpar
              </button>
            )}
          </div>
          {error && <div className="alert error">{error}</div>}

          {result && (
            <div className="result">
              <h4>Requisição</h4>
              <pre className="code">{result.curl}</pre>
              <h4>
                Resposta <span className={`status ${result.ok ? "ok" : "bad"}`}>{result.status}</span>
                <small className="muted"> · {result.ms} ms</small>
              </h4>
              <pre className="code">{result.body || "(sem corpo)"}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ApiTab({ apiUrl }: { apiUrl: string }) {
  const [data, setData] = useState<Inspect | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    // debounce: o campo de URL muda a cada tecla
    const t = setTimeout(() => {
      setError("");
      backend<Inspect>("/api/inspect", { body: { baseUrl: apiUrl } })
        .then(setData)
        .catch((err: Error) => {
          setData(null);
          setError(err.message);
        });
    }, 400);
    return () => clearTimeout(t);
  }, [apiUrl, reload]);

  return (
    <div className="api">
      <div className="api-head">
        <div>
          <h2>{data?.title ?? "API"}</h2>
          {data && (
            <p className="muted">
              Spec: <a href={data.source} target="_blank" rel="noreferrer">{data.source}</a> · {data.tools.length} operações
            </p>
          )}
        </div>
        <button className="ghost" onClick={() => setReload((n) => n + 1)}>
          Recarregar spec
        </button>
      </div>
      {error && <div className="alert error pre">{error}</div>}
      {data?.tools.map((t) => <Operation key={`${t.method} ${t.path}`} tool={t} apiUrl={apiUrl} />)}
    </div>
  );
}
