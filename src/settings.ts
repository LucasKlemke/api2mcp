import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";

/**
 * Configurações feitas pela interface (chave e modelo da OpenAI).
 * Ficam na pasta do usuário, não do projeto, para a chave nunca ir parar num commit.
 */
const DIR = join(homedir(), ".api2mcp");
const FILE = join(DIR, "settings.json");
const DEFAULT_MODEL = "gpt-5-mini";

type Settings = { openaiApiKey?: string; openaiModel?: string };

let settings: Settings = {};
// valores do ambiente/.env na inicialização, para voltar a eles se algo da interface for removido
const fromEnv = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL, enhanceModel: process.env.API2MCP_MODEL };

function setEnv(name: string, value: string | undefined) {
  if (value) process.env[name] = value;
  else delete process.env[name];
}

/** O resto do código lê process.env (chat, --enhance, gerar com IA); a interface tem prioridade sobre o .env. */
function applyToEnv() {
  setEnv("OPENAI_API_KEY", settings.openaiApiKey || fromEnv.key);
  setEnv("OPENAI_MODEL", settings.openaiModel || fromEnv.model);
  setEnv("API2MCP_MODEL", settings.openaiModel || fromEnv.enhanceModel);
}

export async function loadSettings(): Promise<void> {
  try {
    settings = JSON.parse(await readFile(FILE, "utf8")) as Settings;
  } catch {
    settings = {};
  }
  applyToEnv();
}

async function persist() {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
  await chmod(FILE, 0o600);
}

/** Estado para a interface; nunca devolve a chave, só os últimos caracteres. */
export function settingsStatus() {
  const key = process.env.OPENAI_API_KEY;
  return {
    openai: Boolean(key),
    keySource: settings.openaiApiKey ? "interface" : key ? "env" : null,
    keyPreview: key ? `…${key.slice(-4)}` : null,
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    settingsFile: FILE.replace(homedir(), "~"),
  };
}

/** Valida a chave com uma chamada barata à OpenAI antes de salvar. */
export async function saveSettings(patch: { openaiApiKey?: string; openaiModel?: string }) {
  const key = patch.openaiApiKey?.trim();
  if (key) {
    try {
      await new OpenAI({ apiKey: key }).models.list();
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new Error(status === 401 ? "Chave inválida: a OpenAI recusou essa API key." : `Não foi possível validar a chave: ${(err as Error).message}`);
    }
    settings.openaiApiKey = key;
  }
  if (patch.openaiModel !== undefined) {
    const model = patch.openaiModel.trim();
    if (model) settings.openaiModel = model;
    else delete settings.openaiModel;
  }
  await persist();
  applyToEnv();
}

export async function removeApiKey() {
  delete settings.openaiApiKey;
  await persist();
  applyToEnv();
}
