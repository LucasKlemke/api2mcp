import { useEffect, useState } from "react";
import { backend, type Config } from "./api";
import { ApiTab } from "./tabs/ApiTab";
import { McpTab } from "./tabs/McpTab";

const TABS = [
  { id: "api", label: "API" },
  { id: "mcp", label: "MCP" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const storage = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // ignora (modo privado etc.)
    }
  },
};

export function App() {
  const [tab, setTab] = useState<TabId>(() => (TABS.some((t) => t.id === storage.get("tab")) ? (storage.get("tab") as TabId) : "api"));
  const [apiUrl, setApiUrl] = useState(() => storage.get("apiUrl") || "http://localhost:8000");
  const [config, setConfig] = useState<Config>({ openai: false, model: "" });

  useEffect(() => {
    storage.set("tab", tab);
  }, [tab]);
  useEffect(() => {
    storage.set("apiUrl", apiUrl);
  }, [apiUrl]);
  useEffect(() => {
    backend<Config>("/api/config").then(setConfig).catch(() => {});
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⇄</span> api2mcp
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <label className="api-url">
          API
          <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value.trim())} spellCheck={false} />
        </label>
      </header>

      {/* as abas ficam montadas para preservar estado (chat, formulários) ao alternar */}
      <main>
        <section hidden={tab !== "api"}>
          <ApiTab apiUrl={apiUrl} />
        </section>
        <section hidden={tab !== "mcp"}>
          <McpTab apiUrl={apiUrl} config={config} />
        </section>
      </main>
    </div>
  );
}
