/* Isolated plugin settings; values are rendered with textContent, never HTML. */
const api = window.moderaPlugin;
const form = document.querySelector("#editor");
const field = (name) => form.elements.namedItem(name);
let catalog, selected;
let busy = false;
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
function edit(role, existing = false) {
  selected = existing ? role.id : undefined;
  form.hidden = false;
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
  renderList();
}
function renderList() {
  const root = document.querySelector("#roles");
  root.replaceChildren();
  for (const role of catalog.roles) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${role.name}${role.enabled ? "" : " · 已停用"}`;
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
    else form.hidden = true;
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
    catalog = { ...saved, options: catalog.options };
    selected = undefined;
    form.hidden = true;
    renderList();
    message("已删除");
  }
};
document.querySelector("#reload").onclick = load;
load()
  .then(() => api.ready())
  .catch((error) => message(String(error), true));
