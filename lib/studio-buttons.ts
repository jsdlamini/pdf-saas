import { db, ensureMigrated } from "@/lib/db";

export const BUTTON_KEYS = ["newProject", "template", "learn", "contests", "groups"] as const;
export type ButtonKey = (typeof BUTTON_KEYS)[number];
export type ButtonVisibility = Record<ButtonKey, boolean>;
export type ButtonRole = "user" | "assistant" | "admin";
export type ButtonConfig = Record<ButtonRole, ButtonVisibility>;

const KEY = "studio_button_visibility";

export const DEFAULT_BUTTON_CONFIG: ButtonConfig = {
  user: { newProject: true, template: true, learn: true, contests: true, groups: true },
  assistant: { newProject: false, template: false, learn: false, contests: false, groups: true },
  admin: { newProject: true, template: true, learn: true, contests: true, groups: true },
};

export const BUTTON_LABELS: Record<ButtonKey, string> = {
  newProject: "New Project",
  template: "Start from a template",
  learn: "Learn to Code",
  contests: "Contests",
  groups: "Practical Groups",
};

export async function getButtonConfig(): Promise<ButtonConfig> {
  await ensureMigrated();
  const r = await db.query(`SELECT value FROM wiserfiles_settings WHERE key = $1`, [KEY]);
  const raw = r.rows[0]?.value;
  if (!raw) return DEFAULT_BUTTON_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Partial<ButtonConfig>;
    return {
      user: { ...DEFAULT_BUTTON_CONFIG.user, ...(parsed.user || {}) },
      assistant: { ...DEFAULT_BUTTON_CONFIG.assistant, ...(parsed.assistant || {}) },
      admin: { ...DEFAULT_BUTTON_CONFIG.admin, ...(parsed.admin || {}) },
    };
  } catch {
    return DEFAULT_BUTTON_CONFIG;
  }
}

export async function setButtonConfig(config: ButtonConfig): Promise<void> {
  await ensureMigrated();
  await db.query(
    `INSERT INTO wiserfiles_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [KEY, JSON.stringify(config)]
  );
}

export async function getButtonsForRole(role: string): Promise<ButtonVisibility> {
  const config = await getButtonConfig();
  return config[role as ButtonRole] || config.user;
}
