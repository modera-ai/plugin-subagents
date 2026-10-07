# 子智能体设置页设计计划

## 参考与原则

- 项目现有设置页采用克制的卡片、柔和边界和强调色；插件页应延续这一套视觉语言。
- [VS Code 自定义智能体](https://code.visualstudio.com/docs/agent-customization/custom-agents)将角色说明、工具和模型视为一个可复用配置；因此编辑顺序以身份、工作指令、权限、模型为主线。
- [OpenAI Agents 配置文档](https://developers.openai.com/api/docs/guides/agents-api/configuration)区分已保存的配置和运行中的会话；页面应明确提示修改只影响后续任务。
- [Linear 界面重设计](https://linear.app/now/how-we-redesigned-the-linear-ui)强调减少导航噪声并提高层级与密度；目录卡片保持短信息，编辑区通过分区标题展开细节。
- [Raycast 设置](https://manual.raycast.com/settings)将扩展配置集中在清晰入口；角色目录加入快速搜索，让角色数量较多时仍能直接定位。
- `D:\modera-reference\Modera_pre` 的 [子智能体管理页](D:/modera-reference/Modera_pre/apps/desktop/src/components/settings/AgentSubagentsPage.tsx)和 [设置样式](D:/modera-reference/Modera_pre/apps/desktop/src/styles/settings.css)提供了直接对照：安静的目录行、搜索入口、紧凑的角色摘要和把模型设置后置的编辑流程。当前插件仍保留自己的运行字段和双栏编辑方式，不照搬参考项目不同的存储与作用域机制。

## 分阶段实施

1. **信息架构**：角色目录和编辑台并列，当前角色、启用状态和用途一眼可见；支持按名称、标识和用途搜索。目录在角色较多时独立滚动，删除当前角色后自动选中下一位。
2. **视觉设计**：使用宿主主题色、柔和底色、分区编号、留白与细致交互态，兼容深色主题和窄窗口。编辑区顶部用紧凑摘要展示执行方式、工具范围与模型。
3. **交互完整性**：保留模板、创建、编辑、保存、删除、模型与工具选择；改善空状态与默认选择。切换角色时在本页暂存未保存的表单内容，明确提示并提供放弃更改操作。
4. **验证**：检查脚本语法、插件构建、桌面端增删改与重启持久化，并在实际桌面窗口检查滚动、对齐和密度。

## 后续打磨

- 继续按 `modera-reference` 的中性色密度校准颜色、间距和层级；主题色使用宿主注入的 `--mu-accent`，而非固定色值。
- 在可用的桌面测试环境中截图检查亮色、暗色、窄窗口，并修正溢出或对比度问题。

## 当前验证状态

- JavaScript 语法检查与 `git diff --check` 已通过。
- 借用主项目已安装依赖后，插件 TypeScript 检查通过；独立插件打包在隔离工作树中仍失败，esbuild 报 `Cannot read directory "../../../../../../..": Access is denied`。已试过临时复制插件依赖，失败相同，临时目录已清理。当前 npm 镜像无法取得 `@modera/contracts`，需在正常安装的工作树中复验打包。
- 内置浏览器的安全策略禁止打开本地 `file:` 页面，因此暂未获得真实页面截图；需要通过可用的桌面应用或测试环境继续视觉核验。
