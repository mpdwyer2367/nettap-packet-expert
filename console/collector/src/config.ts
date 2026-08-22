import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CollectorConfig } from "./contract.js";
import { DEFAULT_COLLECTOR_CONFIG, normalizeConfig } from "./contract.js";
import { log } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const COLLECTOR_ROOT = join(__dirname, "..");
export const CONFIG_DIR = join(COLLECTOR_ROOT, "config");
export const CONFIG_PATH = join(CONFIG_DIR, "collector.json");
export const EXAMPLE_CONFIG_PATH = join(CONFIG_DIR, "collector.example.json");
export const SPOOL_DIR = join(COLLECTOR_ROOT, "data", "spool");
export const DATA_DIR = join(COLLECTOR_ROOT, "data");

export type EnvSettings = {
  consoleUrl: string | null;
  token: string | null;
  localPg: string;
  apiPort: number | null;
};

export function loadEnv(): EnvSettings {
  return {
    consoleUrl: process.env.AMDAI_CONSOLE_URL?.replace(/\/+$/, "") || null,
    token: process.env.AMDAI_COLLECTOR_TOKEN || null,
    localPg:
      process.env.AMDAI_LOCAL_PG ||
      "postgresql://postgres:postgres@127.0.0.1:5432/amdai_collector",
    apiPort: process.env.AMDAI_API_PORT ? Number(process.env.AMDAI_API_PORT) : null,
  };
}

/** Loads config/collector.json, seeding it from the example file on first run. */
export function loadConfig(): CollectorConfig {
  mkdirSync(CONFIG_DIR, { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SPOOL_DIR, { recursive: true });

  if (!existsSync(EXAMPLE_CONFIG_PATH)) {
    writeFileSync(EXAMPLE_CONFIG_PATH, JSON.stringify(DEFAULT_COLLECTOR_CONFIG, null, 2) + "\n");
  }

  if (!existsSync(CONFIG_PATH)) {
    const seed = readFileSync(EXAMPLE_CONFIG_PATH, "utf8");
    writeFileSync(CONFIG_PATH, seed);
    log.info("config", "Seeded collector.json from collector.example.json", { path: CONFIG_PATH });
  }

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return normalizeConfig(raw);
  } catch (err) {
    log.error("config", "Failed to parse collector.json, falling back to defaults", {
      error: String(err),
    });
    return DEFAULT_COLLECTOR_CONFIG;
  }
}

export function saveConfig(config: CollectorConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}
