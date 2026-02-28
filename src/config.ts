import type { UserConfig } from "./types";

const CONFIG_KEY = "github_meter_config";

export function loadConfig(): UserConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? (JSON.parse(raw) as UserConfig) : null;
  } catch {
    return null;
  }
}

export function saveConfig(config: UserConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function clearConfig(): void {
  localStorage.removeItem(CONFIG_KEY);
}
