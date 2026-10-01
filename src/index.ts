import {
  declaredTools,
  type DelegateDefinition,
  type DelegationSnapshot,
  type PluginModule,
  type PluginUiNode,
} from "@modera/plugin-sdk";
import manifest from "../plugin.json";
import { RoleStore, type AgentRole } from "./role-store";

export const presets: Readonly<Record<string, DelegateDefinition>> = {
  explorer: {
    id: "explorer",
    name: "探索智能体",
    prompt:
      "Investigate the assigned question using read-only tools. Return concrete findings with file paths and relevant evidence. Do not claim to have changed files.",
  },
  reviewer: {
    id: "reviewer",
    name: "审查智能体",
    prompt:
      "Review the assigned code or proposal. Prioritize actionable defects and risks, citing paths and evidence. Do not change files.",
  },
  worker: {
    id: "worker",
    name: "执行智能体",
    tools: "inherit",
    prompt:
      "Complete the assigned implementation task. Limit edits to its scope, preserve unrelated changes, and verify the result. Report what changed, the verification performed, and any remaining limitations.",
  },
};

export const activate: PluginModule["activate"] = async (host) => {
  if (!host.delegation) throw new Error("Subagent host capability unavailable");
  const api = host.delegation;
  const defaults: AgentRole[] = Object.values(presets).map((role) => ({
    ...role,
    enabled: true,
    description:
      role.id === "explorer"
        ? "只读探索与资料查证"
        : role.id === "reviewer"
          ? "只读审查与问题分析"
          : "执行实现并验证结果",
  }));
  const store = host.storagePath
    ? new RoleStore(host.storagePath, defaults)
    : undefined;
  const catalog = async () =>
    store ? store.read() : { revision: 0, roles: defaults };

  const tools = declaredTools(manifest).map((definition) => ({
    definition,
    async execute(raw: unknown, context: Parameters<typeof api.list>[0]) {
      const input = raw as {
        agent?: string;
        task?: string;
        tools?: string[];
        id?: string;
        ids?: string[];
        timeoutMs?: number;
        mode?: "foreground" | "background";
      };
      switch (definition.id) {
        case "subagent_spawn": {
          const preset = (await catalog()).roles.find(
            (role) => role.id === input.agent && role.enabled,
          );
          if (!preset || !input.task)
            throw new Error(
              "Select an available subagent and provide its task",
            );
          if (
            input.tools &&
            Array.isArray(preset.tools) &&
            input.tools.some((id) => !preset.tools!.includes(id))
          )
            throw new Error("Requested tools exceed the configured role tools");
          return {
            child: await api.spawn(
              context,
              {
                ...preset,
                mode: input.mode ?? preset.mode ?? "foreground",
                ...(input.tools ? { tools: input.tools } : {}),
              },
              input.task,
            ),
          };
        }
        case "subagent_catalog":
          return {
            roles: (await catalog()).roles
              .filter((role) => role.enabled)
              .map(({ prompt, enabled, ...role }) => role),
          };
        case "subagent_list":
          return { children: await api.list(context) };
        case "subagent_wait":
          return {
            children: await api.wait(context, input.ids ?? [], input.timeoutMs),
          };
        case "subagent_stop":
          await api.stop(context, input.id ?? "");
          return { stopped: input.id };
        default:
          throw new Error("Unknown subagent operation");
      }
    },
  }));
  return {
    tools,
    settings: {
      actions: ["catalog", "saveRole", "removeRole"],
      async act(action, context) {
        context.signal.throwIfAborted();
        if (action.id === "catalog")
          return {
            ...(await catalog()),
            templates: defaults,
            options: await api.options?.(context.projectId),
          };
        if (!store) throw new Error("Role storage unavailable");
        const input = JSON.parse(action.value ?? "{}");
        const result = await store.update(
          input.revision,
          action.id === "saveRole"
            ? { save: input.role }
            : action.id === "removeRole"
              ? { remove: input.id }
              : {},
        );
        host.invalidateUi?.();
        return { ...result, templates: defaults };
      },
    },
    ui: [
      {
        id: "modera.subagents.result",
        slot: "tool.result",
        requiredPermissions: [],
        toolNames: tools.map((tool) => tool.definition.id),
        async render(request) {
          let output:
            | {
                child?: DelegationSnapshot;
                children?: DelegationSnapshot[];
                roles?: AgentRole[];
                stopped?: string;
              }
            | undefined;
          try {
            output = request.tool?.result
              ? JSON.parse(request.tool.result)
              : undefined;
          } catch {
            /* Host falls back to raw output for invalid results. */
          }
          if (output?.roles)
            return {
              title: request.locale.startsWith("zh")
                ? "可用子智能体"
                : "Available subagents",
              children: [
                {
                  type: "table",
                  columns: request.locale.startsWith("zh")
                    ? ["名称", "标识", "用途"]
                    : ["Name", "ID", "Purpose"],
                  rows: output.roles.map((role) => [
                    role.name,
                    role.id,
                    role.description,
                  ]),
                },
              ],
            };
          const snapshots = output?.child
            ? [output.child]
            : (output?.children ?? []);
          const nodes: PluginUiNode[] = snapshots.map((child) => ({
            type: "row",
            children: [
              {
                type: "conversation-link",
                label: child.name,
                sessionId: child.id,
              },
              { type: "text", text: child.status },
              ...(child.error
                ? [{ type: "text" as const, text: child.error }]
                : []),
            ],
          }));
          if (!nodes.length)
            nodes.push({
              type: "text",
              text: output?.stopped
                ? request.locale.startsWith("zh")
                  ? "已请求停止子智能体"
                  : "Subagent stop requested"
                : request.locale.startsWith("zh")
                  ? "暂无子智能体"
                  : "No subagents",
            });
          return {
            title: request.locale.startsWith("zh") ? "子智能体" : "Subagents",
            children: nodes,
          };
        },
      },
    ],
  };
};
