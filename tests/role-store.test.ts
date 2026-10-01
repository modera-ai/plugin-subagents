import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RoleStore, validateRole, type AgentRole } from "../src/role-store";

const role: AgentRole = {
  id: "research",
  name: "研究智能体",
  description: "查证资料",
  prompt: "Return evidence",
  enabled: true,
};
test("persists custom roles, disabled roles and removal across restart with revision conflicts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "subagent-roles-"));
  try {
    const store = new RoleStore(directory, [role]);
    expect(await store.read()).toEqual({ revision: 0, roles: [role] });
    const saved = await store.update(0, {
      save: {
        ...role,
        enabled: false,
        tools: ["web_search"],
        selection: {
          profileId: "api",
          model: "model",
          reasoningEffort: "medium",
        },
        limits: { maxSteps: 25, maxDurationMs: 60000, maxTokens: 10000 },
      },
    });
    expect(await new RoleStore(directory, []).read()).toEqual(saved);
    await expect(store.update(0, { remove: role.id })).rejects.toThrow("刷新");
    expect((await store.update(1, { remove: role.id })).roles).toEqual([]);
    expect((await new RoleStore(directory, [role]).read()).roles).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("serializes concurrent edits without silently overwriting another editor", async () => {
  const directory = await mkdtemp(join(tmpdir(), "subagent-roles-"));
  try {
    const store = new RoleStore(directory, []);
    const otherEditor = new RoleStore(directory, []);
    const results = await Promise.allSettled([
      store.update(0, { save: role }),
      otherEditor.update(0, { save: { ...role, id: "other" } }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((await store.read()).roles).toEqual([role]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("rejects invalid tool, model and runtime configurations", () => {
  for (const change of [
    { id: "../x" },
    { prompt: "" },
    { enabled: "yes" },
    { tools: ["read", "read"] },
    { selection: { profileId: "", model: "x", reasoningEffort: "low" } },
    { limits: { maxSteps: 0 } },
    { limits: { maxDurationMs: 1800001 } },
    { limits: { maxTokens: 2.5 } },
  ]) {
    expect(() => validateRole({ ...role, ...change })).toThrow();
  }
});
