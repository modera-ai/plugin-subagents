import { expect, test, vi } from "vitest";
import type {
  DelegationSnapshot,
  PluginDelegationApi,
  PluginContext,
} from "@modera/plugin-sdk";
import { activate } from "../src/index";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("settings-defined roles drive actual launches and disabled roles are excluded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "subagent-config-"));
  try {
    const spawn = vi.fn(async () => ({ id: "child", status: "running" }));
    const host = {
      storagePath: directory,
      delegation: { spawn },
      invalidateUi: vi.fn(),
    } as unknown as PluginContext;
    const plugin = (await activate(host))!;
    const settings = plugin.settings!;
    const context = { signal: new AbortController().signal };
    const role = {
      id: "news",
      name: "新闻智能体",
      enabled: true,
      description: "核实新闻",
      prompt: "Verify sources",
      tools: ["web_search"],
      selection: {
        profileId: "news-model",
        model: "model",
        reasoningEffort: "low",
      },
      limits: { maxSteps: 10 },
    };
    await settings.act(
      { id: "saveRole", value: JSON.stringify({ revision: 0, role }) },
      context,
    );
    const reopened = (await activate(host))!;
    const tool = reopened.tools!.find(
      (tool) => tool.definition.id === "subagent_spawn",
    )!;
    const toolContext = {
      sessionId: "parent",
      runId: "run",
      signal: context.signal,
    };
    await tool.execute({ agent: "news", task: "today" }, toolContext);
    expect(spawn).toHaveBeenCalledWith(
      toolContext,
      expect.objectContaining(role),
      "today",
    );
    await expect(
      tool.execute(
        { agent: "news", task: "today", tools: ["workspace_write"] },
        toolContext,
      ),
    ).rejects.toThrow("configured role tools");
    await reopened.settings!.act(
      {
        id: "saveRole",
        value: JSON.stringify({
          revision: 1,
          role: { ...role, enabled: false },
        }),
      },
      context,
    );
    await expect(
      tool.execute({ agent: "news", task: "today" }, toolContext),
    ).rejects.toThrow("available subagent");
    const catalog = reopened.tools!.find(
      (tool) => tool.definition.id === "subagent_catalog",
    )!;
    expect(await catalog.execute({}, toolContext)).not.toMatchObject({
      roles: expect.arrayContaining([expect.objectContaining({ id: "news" })]),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("routes model tools through the host and renders returned child links", async () => {
  const child: DelegationSnapshot = {
    id: "child" as never,
    agentId: "explorer",
    name: "Explorer",
    status: "running",
  };
  const api: PluginDelegationApi = {
    spawn: vi.fn(async () => child),
    list: vi.fn(async () => [child]),
    wait: vi.fn(async () => [child]),
    stop: vi.fn(async () => {}),
  };
  const context = {
    sessionId: "parent",
    projectId: "p",
    runId: "r",
    signal: new AbortController().signal,
  };
  const contribution = (await activate({ delegation: api } as PluginContext))!;
  const execute = (id: string, input: unknown) =>
    contribution
      .tools!.find((tool) => tool.definition.id === id)!
      .execute(input, context);
  expect(
    await execute("subagent_spawn", {
      agent: "explorer",
      task: "find evidence",
    }),
  ).toEqual({ child });
  expect(api.spawn).toHaveBeenCalledWith(
    context,
    expect.objectContaining({ id: "explorer" }),
    "find evidence",
  );
  expect(await execute("subagent_list", {})).toEqual({ children: [child] });
  expect(
    await execute("subagent_wait", { ids: ["child"], timeoutMs: 1000 }),
  ).toEqual({ children: [child] });
  expect(api.wait).toHaveBeenCalledWith(context, ["child"], 1000);
  await execute("subagent_stop", { id: "child" });
  expect(api.stop).toHaveBeenCalledWith(context, "child");
  const view = await contribution.ui![0]!.render(
    {
      id: "result",
      locale: "zh-CN",
      sessionId: "parent",
      tool: {
        name: "subagent_spawn",
        input: {},
        result: JSON.stringify({ child }),
      },
    },
    context,
  );
  expect(view.children[0]).toMatchObject({
    type: "row",
    children: [
      { type: "conversation-link", sessionId: "child" },
      { type: "text", text: "running" },
    ],
  });
  await expect(
    execute("subagent_spawn", { agent: "missing", task: "x" }),
  ).rejects.toThrow("available subagent");
});

test("requires the host capability and keeps explicit tool restrictions", async () => {
  await expect(activate({} as PluginContext)).rejects.toThrow(
    "host capability",
  );
  const spawn = vi.fn(async () => ({
    id: "child",
    agentId: "worker",
    name: "Worker",
    status: "running",
  }));
  const contributions = (await activate({
    delegation: { spawn },
  } as unknown as PluginContext))!;
  await contributions
    .tools!.find((tool) => tool.definition.id === "subagent_spawn")!
    .execute(
      { agent: "worker", task: "scoped work", tools: ["read"] },
      { sessionId: "parent", runId: "r", signal: new AbortController().signal },
    );
  expect(spawn.mock.calls[0]?.[1]).toMatchObject({
    id: "worker",
    tools: ["read"],
  });
});
