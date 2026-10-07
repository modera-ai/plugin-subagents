/* Isolated plugin settings; values are rendered with textContent, never HTML. */
const api = window.moderaPlugin;
const form = document.querySelector("#editor");
const field = (name) => form.elements.namedItem(name);
let catalog, selected;
let busy = false;
let editingKey;
let dirty = false;
const drafts = new Map();
const draftFields = [
  "id",
  "name",
  "description",
  "prompt",
  "enabled",
  "mode",
  "policy",
  "tools",
  "customModel",
  "profileId",
  "model",
  "reasoning",
  "maxSteps",
  "duration",
  "maxTokens",
];
function captureDraft() {
  return Object.fromEntries(
    draftFields.map((name) => {
      const control = field(name);
      return [
        name,
        control.type === "checkbox" ? control.checked : control.value,
      ];
    }),
  );
}
function restoreDraft(draft) {
  for (const [name, value] of Object.entries(draft)) {
    const control = field(name);
    if (control.type === "checkbox") control.checked = value;
    else control.value = value;
  }
  visibility();
  renderChoices();
}
function markDirty() {
  dirty = true;
  document.querySelector("#draft-indicator").hidden = false;
  document.querySelector("#discard").hidden = false;
}
const message = (text, error = false) => {
  const node = document.querySelector("#message");
  node.textContent = text;
  node.dataset.error = String(error);
  document.querySelector("#reload").hidden = !error;
};
async function action(id, value) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button").forEach((node) => (node.disabled = true));
  try {
    const result = await api.settings.action(
      id,
      value === undefined ? undefined : JSON.stringify(value),
    );
    message("");
    return result;
  } catch (error) {
    message(String(error), true);
  } finally {
    busy = false;
    document
      .querySelectorAll("button")
      .forEach((node) => (node.disabled = false));
  }
}
function visibility() {
  document.querySelector("#tool-field").hidden =
    field("policy").value !== "custom";
  document.querySelector("#model-fields").hidden =
    !field("customModel").checked;
  field("profileId").required = field("customModel").checked;
  field("model").required = field("customModel").checked;
}
function renderSummary() {
  const root = document.querySelector("#role-summary");
  root.replaceChildren();
  const policy = field("policy").value;
  const tools = field("tools")
    .value.split(/\r?\n/)
    .map((id) => id.trim())
    .filter(Boolean);
  const items = [
    field("mode").value === "background" ? "后台执行" : "等待结果",
    policy === "custom"
      ? `指定 ${tools.length} 个工具`
      : policy === "inherit"
        ? "继承操作工具"
        : "只读工具",
    field("customModel").checked
      ? field("model").value.trim() || "待选模型"
      : "继承模型",
  ];
  for (const item of items) {
    const chip = document.createElement("span");
    chip.textContent = item;
    root.append(chip);
  }
}
function edit(role, existing = false) {
  if (dirty && editingKey) drafts.set(editingKey, captureDraft());
  editingKey = existing ? role.id : `new:${role.id || "blank"}`;
  selected = existing ? role.id : undefined;
  if (!existing) document.querySelector("#role-search").value = "";
  form.hidden = false;
  document.querySelector("#empty-state").hidden = true;
  document.querySelector("#editor-title").textContent = existing
    ? role.name
    : "创建新角色";
  document.querySelector("#editor-subtitle").textContent = existing
    ? "调整这个角色的职责、能力与运行边界。"
    : "从一个清晰的角色定位开始，打造你的专属搭档。";
  form.reset();
  for (const name of ["id", "name", "description", "prompt"])
    field(name).value = role[name] || "";
  field("id").readOnly = existing;
  field("enabled").checked = role.enabled !== false;
  field("mode").value = role.mode || "foreground";
  field("policy").value = Array.isArray(role.tools)
    ? "custom"
    : role.tools === "inherit"
      ? "inherit"
      : "readonly";
  field("tools").value = Array.isArray(role.tools) ? role.tools.join("\n") : "";
  field("customModel").checked = !!role.selection;
  const profileId = role.selection?.profileId || "";
  if (
    profileId &&
    ![...field("profileId").options].some(
      (option) => option.value === profileId,
    )
  ) {
    const option = document.createElement("option");
    option.value = profileId;
    option.textContent = `${profileId}（当前不可用）`;
    field("profileId").append(option);
  }
  field("profileId").value = profileId;
  field("model").value = role.selection?.model || "";
  field("reasoning").value = role.selection?.reasoningEffort || "medium";
  field("maxSteps").value = role.limits?.maxSteps || "";
  field("duration").value = role.limits?.maxDurationMs
    ? role.limits.maxDurationMs / 1000
    : "";
  field("maxTokens").value = role.limits?.maxTokens || "";
  document.querySelector("#remove").hidden = !existing;
  document.querySelector("#remove").textContent = "删除角色";
  visibility();
  renderChoices();
  dirty = false;
  document.querySelector("#draft-indicator").hidden = true;
  document.querySelector("#discard").hidden = true;
  const draft = drafts.get(editingKey);
  if (draft) {
    restoreDraft(draft);
    markDirty();
  }
  renderSummary();
  renderList();
}
function renderList() {
  if (!catalog) return;
  const root = document.querySelector("#roles");
  root.replaceChildren();
  document.querySelector("#role-count").textContent = String(
    catalog.roles.length,
  );
  const query = document
    .querySelector("#role-search")
    .value.trim()
    .toLocaleLowerCase();
  const visibleRoles = catalog.roles.filter((role) =>
    [role.name, role.id, role.description].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  );
  if (!visibleRoles.length && query) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = "没有匹配的角色";
    root.append(empty);
  }
  for (const role of visibleRoles) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "role-card";
    const avatar = document.createElement("span");
    avatar.className = "role-avatar";
    avatar.textContent = role.name.trim().slice(0, 1) || "✦";
    const copy = document.createElement("span");
    copy.className = "role-copy";
    const name = document.createElement("span");
    name.className = "role-name";
    name.textContent = role.name;
    const description = document.createElement("span");
    description.className = "role-description";
    description.textContent = role.description;
    const meta = document.createElement("span");
    meta.className = "role-meta";
    const dot = document.createElement("span");
    dot.className = `status-dot${role.enabled ? "" : " off"}`;
    meta.append(
      dot,
      document.createTextNode(role.enabled ? "已启用" : "已停用"),
    );
    copy.append(name, description, meta);
    button.append(avatar, copy);
    button.setAttribute("aria-current", String(role.id === selected));
    button.onclick = () => edit(role, true);
    root.append(button);
  }
}
async function load() {
  const next = await action("catalog");
  if (!next) return;
  catalog = next;
  renderList();
  field("profileId").replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "选择模型配置…";
  field("profileId").append(placeholder);
  for (const profile of catalog.options?.models || []) {
    const option = document.createElement("option");
    option.value = profile.profileId;
    option.textContent = profile.name;
    field("profileId").append(option);
  }
  const select = document.querySelector("#template");
  while (select.options.length > 1) select.remove(1);
  for (const role of catalog.templates) {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.name;
    select.append(option);
  }
  if (selected) {
    const role = catalog.roles.find((role) => role.id === selected);
    if (role) edit(role, true);
    else {
      selected = undefined;
      form.hidden = true;
      document.querySelector("#empty-state").hidden = false;
    }
  } else if (catalog.roles.length) {
    edit(catalog.roles[0], true);
  }
}
function renderChoices() {
  const tools = document.querySelector("#tool-choices");
  tools.replaceChildren();
  const selected = new Set(field("tools").value.split(/\r?\n/).filter(Boolean));
  for (const tool of catalog.options?.tools || []) {
    const label = document.createElement("label");
    label.className = "check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.has(tool.id);
    input.onchange = () => {
      const ids = new Set(field("tools").value.split(/\r?\n/).filter(Boolean));
      if (input.checked) ids.add(tool.id);
      else ids.delete(tool.id);
      field("tools").value = [...ids].join("\n");
    };
    label.append(input, document.createTextNode(`${tool.title} (${tool.id})`));
    tools.append(label);
  }
  const models = document.querySelector("#model-choices");
  models.replaceChildren();
  for (const model of catalog.options?.models.find(
    (profile) => profile.profileId === field("profileId").value,
  )?.models || []) {
    const option = document.createElement("option");
    option.value = model;
    models.append(option);
  }
}
form.addEventListener("change", (event) => {
  visibility();
  if (["profileId", "tools"].includes(event.target.name)) renderChoices();
  renderSummary();
  markDirty();
});
form.addEventListener("input", () => {
  renderSummary();
  markDirty();
});
form.onsubmit = async (event) => {
  event.preventDefault();
  if (!catalog || busy) return;
  if (!selected && catalog.roles.some((role) => role.id === field("id").value))
    return message("角色标识已存在，请使用其他标识", true);
  const role = {
    id: field("id").value,
    name: field("name").value,
    description: field("description").value,
    prompt: field("prompt").value,
    enabled: field("enabled").checked,
    mode: field("mode").value,
  };
  if (field("policy").value === "inherit") role.tools = "inherit";
  if (field("policy").value === "custom")
    role.tools = field("tools")
      .value.split(/\r?\n/)
      .map((id) => id.trim())
      .filter(Boolean);
  if (field("customModel").checked)
    role.selection = {
      profileId: field("profileId").value,
      model: field("model").value,
      reasoningEffort: field("reasoning").value,
    };
  const limits = {};
  for (const [name, key, multiplier] of [
    ["maxSteps", "maxSteps", 1],
    ["duration", "maxDurationMs", 1000],
    ["maxTokens", "maxTokens", 1],
  ])
    if (field(name).value) limits[key] = Number(field(name).value) * multiplier;
  if (Object.keys(limits).length) role.limits = limits;
  const saved = await action("saveRole", { revision: catalog.revision, role });
  if (saved) {
    drafts.delete(editingKey);
    dirty = false;
    catalog = { ...saved, options: catalog.options };
    edit(
      catalog.roles.find((item) => item.id === role.id),
      true,
    );
    message("已保存，后续启动的任务使用此配置");
  }
};
document.querySelector("#add").onclick = () => edit({ enabled: true });
document.querySelector("#template").onchange = (event) => {
  const template = catalog.templates.find(
    (role) => role.id === event.target.value,
  );
  if (!template) return;
  let id = `${template.id}_custom`,
    n = 2;
  while (catalog.roles.some((role) => role.id === id))
    id = `${template.id}_custom${n++}`;
  edit({
    ...structuredClone(template),
    id,
    name: `${template.name}（自定义）`,
  });
  event.target.value = "";
};
document.querySelector("#remove").onclick = async () => {
  if (!selected) return;
  const button = document.querySelector("#remove");
  if (button.textContent !== "确认删除") {
    button.textContent = "确认删除";
    return;
  }
  button.textContent = "删除角色";
  const saved = await action("removeRole", {
    revision: catalog.revision,
    id: selected,
  });
  if (saved) {
    drafts.delete(editingKey);
    dirty = false;
    catalog = { ...saved, options: catalog.options };
    selected = undefined;
    editingKey = undefined;
    document.querySelector("#role-search").value = "";
    if (catalog.roles.length) edit(catalog.roles[0], true);
    else {
      form.hidden = true;
      document.querySelector("#empty-state").hidden = false;
      renderList();
    }
    message("已删除");
  }
};
document.querySelector("#reload").onclick = load;
document.querySelector("#role-search").oninput = renderList;
document.querySelector("#empty-add").onclick = () => edit({ enabled: true });
document.querySelector("#discard").onclick = () => {
  drafts.delete(editingKey);
  dirty = false;
  const role = catalog.roles.find((item) => item.id === selected);
  if (role) edit(role, true);
  else {
    selected = undefined;
    editingKey = undefined;
    form.hidden = true;
    document.querySelector("#empty-state").hidden = false;
    renderList();
  }
  message("已放弃未保存更改");
};
load()
  .then(() => api.ready())
  .catch((error) => message(String(error), true));
