import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DelegateDefinition } from "@modera/plugin-sdk";

export interface AgentRole extends DelegateDefinition {
  description: string;
  enabled: boolean;
}
export interface RoleCatalog {
  revision: number;
  roles: AgentRole[];
}

export function validateRole(value: unknown): AgentRole {
  if (!value || typeof value !== "object") throw new Error("Invalid role");
  const role = value as AgentRole;
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(role.id))
    throw new Error("Invalid role ID");
  for (const [key, max] of [
    ["name", 120],
    ["description", 2000],
    ["prompt", 32000],
  ] as const) {
    if (
      typeof role[key] !== "string" ||
      !role[key].trim() ||
      role[key].length > max
    )
      throw new Error(`Invalid role ${key}`);
  }
  if (typeof role.enabled !== "boolean")
    throw new Error("Invalid role enabled state");
  if (
    role.mode !== undefined &&
    !["foreground", "background"].includes(role.mode)
  )
    throw new Error("Invalid execution mode");
  if (
    role.tools !== undefined &&
    role.tools !== "inherit" &&
    (!Array.isArray(role.tools) ||
      role.tools.length > 256 ||
      role.tools.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(role.tools).size !== role.tools.length)
  )
    throw new Error("Invalid tools");
  if (
    role.selection &&
    (!role.selection.profileId?.trim() ||
      !role.selection.model?.trim() ||
      !["none", "minimal", "low", "medium", "high", "xhigh"].includes(
        role.selection.reasoningEffort,
      ))
  )
    throw new Error("Invalid model selection");
  for (const [key, max] of [
    ["maxSteps", 1000],
    ["maxDurationMs", 1800000],
    ["maxTokens", 2000000],
  ] as const) {
    const n = role.limits?.[key];
    if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > max))
      throw new Error(`Invalid limit ${key}`);
  }
  return structuredClone({
    id: role.id,
    name: role.name.trim(),
    description: role.description.trim(),
    prompt: role.prompt,
    enabled: role.enabled,
    ...(role.mode ? { mode: role.mode } : {}),
    ...(role.tools !== undefined ? { tools: role.tools } : {}),
    ...(role.selection ? { selection: role.selection } : {}),
    ...(role.limits ? { limits: role.limits } : {}),
  });
}

/** A saved role affects future launches; running children retain their immutable snapshot. */
export class RoleStore {
  private static readonly queues = new Map<string, Promise<unknown>>();
  private get queue(): Promise<unknown> {
    return RoleStore.queues.get(this.path) ?? Promise.resolve();
  }
  private set queue(value: Promise<unknown>) {
    RoleStore.queues.set(this.path, value);
  }
  private readonly path: string;
  constructor(
    private readonly directory: string,
    private readonly defaults: readonly AgentRole[],
  ) {
    this.path = join(directory, "roles.json");
  }
  async read(): Promise<RoleCatalog> {
    await this.queue;
    return this.load();
  }
  private async load(): Promise<RoleCatalog> {
    let source: string;
    try {
      source = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { revision: 0, roles: this.defaults.map(validateRole) };
    }
    const saved = JSON.parse(source) as RoleCatalog;
    if (
      !Number.isInteger(saved.revision) ||
      saved.revision < 0 ||
      !Array.isArray(saved.roles) ||
      saved.roles.length > 64
    )
      throw new Error("Invalid saved role catalog");
    const roles = saved.roles.map(validateRole);
    if (new Set(roles.map((role) => role.id)).size !== roles.length)
      throw new Error("Duplicate role IDs");
    return { revision: saved.revision, roles };
  }
  update(
    revision: number,
    change: { save?: unknown; remove?: string },
  ): Promise<RoleCatalog> {
    const operation = this.queue.then(async () => {
      const catalog = await this.load();
      if (catalog.revision !== revision)
        throw new Error("配置已被修改，请刷新后重试");
      if (change.save !== undefined) {
        const role = validateRole(change.save);
        const index = catalog.roles.findIndex((item) => item.id === role.id);
        if (index < 0) catalog.roles.push(role);
        else catalog.roles[index] = role;
      } else if (change.remove)
        catalog.roles = catalog.roles.filter(
          (role) => role.id !== change.remove,
        );
      else throw new Error("Missing role change");
      if (catalog.roles.length > 64)
        throw new Error("最多可配置 64 个子智能体");
      catalog.revision++;
      await mkdir(this.directory, { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(catalog, null, 2), "utf8");
      await rename(temporary, this.path);
      return structuredClone(catalog);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
