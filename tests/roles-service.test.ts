import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";
import type { PluginContext, ServiceCallContext } from "@modera/plugin-sdk";
import manifest from "../plugin.json";
import { activate } from "../src/index";
import type { AgentRole } from "../src/role-store";

const require = createRequire(import.meta.url);
// Use the schema shipped with the plugin devkit without depending on a host checkout.
const { parsePluginManifest } = require(
  join(dirname(require.resolve("@modera/plugin-build")), "manifest.cjs"),
);
const serviceName = "modera.subagents.roles";
const role: AgentRole = {
  id: "research",
  name: "Research",
  description: "Find evidence",
  prompt: "Return evidence with sources",
  enabled: true,
  tools: ["web_search"],
  selection: { profileId: "research", model: "model", reasoningEffort: "low" },
  limits: { maxSteps: 10 },
};
const context: ServiceCallContext = {
  caller: "modera.kanban",
  projectId: "project",
  sessionId: "parent",
  depth: 1,
  signal: new AbortController().signal,
};
const toolContext = { ...context, runId: "run" };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "subagent-service-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const options = vi.fn(async (projectId?: string) => ({
    tools: [{ id: "web_search", title: projectId ?? "Global search" }],
    models: [{ profileId: "research", name: "Research", models: ["model"] }],
  }));
  const spawn = vi.fn(async () => ({ id: "child", status: "running" }));
  const invalidateUi = vi.fn();
  const host = {
    storagePath: directory,
    delegation: { options, spawn },
    invalidateUi,
  } as unknown as PluginContext;
  const plugin = (await activate(host))!;
  const service = plugin.services![serviceName]!;
  const call = (method: string, input: unknown = {}) =>
    service.methods[method]!.call(input, context);
  const settings = (id: string, input?: unknown) =>
    plugin.settings!.act(
      { id, ...(input === undefined ? {} : { value: JSON.stringify(input) }) },
      context,
    );
  const execute = (id: string, input: unknown = {}) =>
    plugin
      .tools!.find((tool) => tool.definition.id === id)!
      .execute(input, toolContext);
  return {
    host,
    plugin,
    service,
    call,
    settings,
    execute,
    options,
    spawn,
    invalidateUi,
  };
}

test("manifest schema accepts the provider and requires Kanban's explicit legacy dependency", () => {
  expect(parsePluginManifest(manifest).provides).toEqual(manifest.provides);
  const consumer = {
    apiVersion: 1,
    id: "modera.kanban",
    name: "Kanban",
    version: "0.1.0",
    main: "dist/index.cjs",
    permissions: ["storage.read", "storage.write"],
    dependencies: [{ id: manifest.id, version: "^0.1.0" }],
    consumes: { [serviceName]: { apiVersion: 1 } },
  };
  expect(parsePluginManifest(consumer).consumes).toEqual(consumer.consumes);
  expect(() => parsePluginManifest({ ...consumer, dependencies: [] })).toThrow(
    "dependencies",
  );
  expect(() =>
    parsePluginManifest({
      ...consumer,
      dependencies: [{ ...consumer.dependencies[0], optional: true }],
    }),
  ).toThrow("non-optional dependency");
});

test("advertises the role contract and declares permissions on each method", async () => {
  const { service } = await fixture();
  expect(manifest.provides).toEqual({
    [serviceName]: { contract: "modera.agent-roles", apiVersion: 1 },
  });
  expect(service).toMatchObject(manifest.provides[serviceName]);
  expect(Object.keys(service.methods)).toEqual(["catalog", "save", "remove"]);
  for (const [method, permission] of [
    ["catalog", "storage.read"],
    ["save", "storage.write"],
    ["remove", "storage.write"],
  ] as const) {
    expect(service.methods[method]!.requiredPermissions).toEqual([permission]);
    expect(manifest.permissions).toContain(permission);
  }
});

test("catalog includes prompts, templates and awaited options from the host call scope", async () => {
  const { call, settings, service, options, invalidateUi } = await fixture();
  const catalog = await call("catalog", { projectId: "untrusted-input" });
  expect(catalog).toMatchObject({
    revision: 0,
    roles: expect.arrayContaining([
      expect.objectContaining({
        id: "explorer",
        enabled: true,
        prompt: expect.any(String),
      }),
    ]),
    templates: expect.arrayContaining([
      expect.objectContaining({
        id: "worker",
        enabled: true,
        prompt: expect.any(String),
      }),
    ]),
    options: await options(context.projectId),
  });
  expect(
    options.mock.calls.every(([projectId]) => projectId === context.projectId),
  ).toBe(true);
  expect(await settings("catalog")).toEqual(catalog);
  await service.methods.catalog!.call({}, { ...context, projectId: undefined });
  expect(options).toHaveBeenLastCalledWith(undefined);
  expect(invalidateUi).not.toHaveBeenCalled();
});

test("service, settings and subagent tools observe the same role edits and removals", async () => {
  const { call, settings, execute, spawn, invalidateUi } = await fixture();
  const saved = await call("save", { revision: 0, role });
  expect(saved).toMatchObject({
    revision: 1,
    roles: expect.arrayContaining([role]),
  });
  expect(await settings("catalog")).toMatchObject(saved);
  await execute("subagent_spawn", { agent: role.id, task: "Find sources" });
  expect(spawn).toHaveBeenLastCalledWith(
    toolContext,
    expect.objectContaining(role),
    "Find sources",
  );
  const toolCatalog = await execute("subagent_catalog");
  expect(toolCatalog).toMatchObject({
    roles: expect.arrayContaining([expect.objectContaining({ id: role.id })]),
  });
  expect(JSON.stringify(toolCatalog)).not.toContain(role.prompt);

  const edited = {
    ...role,
    prompt: "Use primary sources",
    mode: "background" as const,
  };
  await settings("saveRole", { revision: 1, role: edited });
  expect(await call("catalog")).toMatchObject({
    revision: 2,
    roles: expect.arrayContaining([edited]),
  });
  await execute("subagent_spawn", { agent: role.id, task: "Verify" });
  expect(spawn).toHaveBeenLastCalledWith(
    toolContext,
    expect.objectContaining(edited),
    "Verify",
  );

  const removed = await call("remove", { revision: 2, id: role.id });
  expect(removed).toMatchObject({ revision: 3 });
  expect(await settings("catalog")).toMatchObject(removed);
  expect(await execute("subagent_catalog")).not.toMatchObject({
    roles: expect.arrayContaining([expect.objectContaining({ id: role.id })]),
  });
  await expect(
    execute("subagent_spawn", { agent: role.id, task: "Verify" }),
  ).rejects.toThrow("available subagent");

  await settings("removeRole", { revision: 3, id: "worker" });
  expect(await call("catalog")).toMatchObject({ revision: 4 });
  expect(await call("catalog")).not.toMatchObject({
    roles: expect.arrayContaining([expect.objectContaining({ id: "worker" })]),
  });
  expect(invalidateUi).toHaveBeenCalledTimes(4);
});

test("disabled roles and prompts persist after reactivation while tools exclude them", async () => {
  const { host, call, invalidateUi } = await fixture();
  const disabled = { ...role, id: "explorer", enabled: false };
  const saved = await call("save", { revision: 0, role: disabled });
  const reopened = (await activate(host))!;
  const catalog = await reopened.services![serviceName]!.methods.catalog!.call(
    {},
    context,
  );
  expect(catalog).toMatchObject(saved);
  expect(catalog).toMatchObject({
    roles: expect.arrayContaining([disabled]),
    templates: expect.arrayContaining([
      expect.objectContaining({ id: "explorer", enabled: true }),
    ]),
  });
  expect(await reopened.settings!.act({ id: "catalog" }, context)).toEqual(
    catalog,
  );
  const tool = (id: string) =>
    reopened.tools!.find((tool) => tool.definition.id === id)!;
  expect(
    await tool("subagent_catalog").execute({}, toolContext),
  ).not.toMatchObject({
    roles: expect.arrayContaining([
      expect.objectContaining({ id: disabled.id }),
    ]),
  });
  await expect(
    tool("subagent_spawn").execute(
      { agent: disabled.id, task: "Find sources" },
      toolContext,
    ),
  ).rejects.toThrow("available subagent");
  expect(invalidateUi).toHaveBeenCalledTimes(1);
});

test("stale revisions across service and settings cannot overwrite roles or invalidate UI", async () => {
  const { host, call, settings, invalidateUi } = await fixture();
  await settings("saveRole", { revision: 0, role });
  const original = await call("catalog");
  await expect(
    call("save", { revision: 0, role: { ...role, enabled: false } }),
  ).rejects.toThrow();
  await expect(call("remove", { revision: 0, id: role.id })).rejects.toThrow();
  expect(await call("catalog")).toEqual(original);
  expect(invalidateUi).toHaveBeenCalledTimes(1);

  const otherEditor = (await activate(host))!;
  const results = await Promise.allSettled([
    call("save", { revision: 1, role: { ...role, prompt: "Updated prompt" } }),
    otherEditor.settings!.act(
      { id: "removeRole", value: JSON.stringify({ revision: 1, id: role.id }) },
      context,
    ),
  ]);
  expect(results.map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect(await settings("catalog")).toMatchObject({
    revision: 2,
    roles: expect.arrayContaining([
      expect.objectContaining({ id: role.id, prompt: "Updated prompt" }),
    ]),
  });
  expect(invalidateUi).toHaveBeenCalledTimes(2);
});

test("invalid roles and aborted calls leave the catalog unchanged", async () => {
  const { call, service, options, invalidateUi } = await fixture();
  const original = await call("catalog");
  for (const change of [
    { enabled: "false" },
    { prompt: "" },
    { tools: ["read", "read"] },
  ]) {
    await expect(
      call("save", { revision: 0, role: { ...role, ...change } }),
    ).rejects.toThrow();
  }
  const controller = new AbortController();
  controller.abort(new Error("Cancelled"));
  options.mockClear();
  for (const method of ["catalog", "save", "remove"]) {
    await expect(
      service.methods[method]!.call(
        { revision: 0, role, id: "explorer" },
        { ...context, signal: controller.signal },
      ),
    ).rejects.toThrow("Cancelled");
  }
  expect(options).not.toHaveBeenCalled();
  expect(await call("catalog")).toEqual(original);
  expect(invalidateUi).not.toHaveBeenCalled();
});

test("catalog supports an older host without options and writes require storage", async () => {
  const plugin = (await activate({ delegation: {} } as PluginContext))!;
  const methods = plugin.services![serviceName]!.methods;
  expect(await methods.catalog!.call({}, context)).toMatchObject({
    revision: 0,
    roles: expect.any(Array),
    templates: expect.any(Array),
    options: undefined,
  });
  await expect(
    methods.save!.call({ revision: 0, role }, context),
  ).rejects.toThrow("Role storage unavailable");
  await expect(
    methods.remove!.call({ revision: 0, id: role.id }, context),
  ).rejects.toThrow("Role storage unavailable");
});
