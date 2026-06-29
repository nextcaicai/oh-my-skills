# AGENTS.md

## 项目定位

`oh-my-skills` 是一个 Tauri v2 + React/Vite 桌面应用，用来发现、查看和同步本机不同 Agent 工具里的 Skills。这个项目的体验重点是：轻量、本地、小工具、列表优先、预览后再写入，避免把文件系统和多 Agent 差异转嫁给用户。

## 沟通与决策

- 默认用中文说明；代码、命令、变量名保持英文。
- 结论先行，再解释原因和对用户的影响。
- 用户不是程序员出身，技术决策要说明“为什么这么做”以及“用户会感受到什么变化”。
- 不确定时明确说不确定，并通过读取代码、配置或运行命令验证，不要凭印象下结论。
- 如果用户明确要求诊断、评审或讨论，不要擅自改文件；如果用户要求实现，范围清楚后直接动手。

## 修改边界

- 只改与当前任务直接相关的文件。发现旁支问题先说明，不顺手大改。
- 不要覆盖、回滚或整理用户已有改动，除非用户明确要求。
- 不要自动 commit、push、创建 PR。
- 不要把密钥、token、密码写进代码或文档。
- 对小修小补和诊断任务，不要为了“补规范”阻塞当前任务；规范更新应服务于已经暴露的真实协作问题。

## 目录与技术栈

- 前端入口在 `src/`，使用 React、TypeScript、Vite。
- 样式分布在 `src/styles*.css` 和 `src/styles/` 下，优先沿用现有 class、变量和布局节奏。
- Tauri/Rust 代码在 `src-tauri/src/`。
- Tauri 基础配置在 `src-tauri/tauri.conf.json`。
- 平台差异配置在 `src-tauri/tauri.macos.conf.json` 和 `src-tauri/tauri.windows.conf.json`。
- Tauri v2 会合并基础配置和平台配置；修改窗口、打包、系统效果等平台相关配置时，要同时检查基础配置与平台覆盖。

## 常用命令

- `npm run dev`：只启动 Vite 前端开发服务。
- `npm run tauri:dev`：启动 Tauri 开发应用。
- `npm run tauri:dev:hmr`：使用 `src-tauri/tauri.hmr.conf.json` 启动 Tauri HMR 开发应用。
- `npm run build`：TypeScript + Vite 构建，是前端和配置改动的基础验证。
- `npm run test:rust`：运行 Rust 测试。
- `npm run smoke`：运行 `npm run build` 和 `npm run test:rust`。
- `npm run tauri:build:macos`：构建 macOS 包。
- `npm run tauri:build:windows`：构建 Windows 包或用于 Windows 侧验证。

## 验证规则

- 前端、样式、配置改动后，优先运行 `npm run build`。
- Rust 逻辑、文件系统、扫描、同步计划相关改动后，运行 `npm run test:rust`；风险较高时运行 `npm run smoke`。
- 纯文档改动通常不需要跑 build，但要检查 diff，确认没有混入无关修改。
- UI 是否“好用”不能只靠 build/test 证明。涉及用户流程、布局、交互时，需要补充浏览器层路径检查、截图或人工确认。
- 验证失败时说明失败命令、核心错误和下一步判断，不要为了通过验证而注释掉报错。

## 产品与 UI 原则

- 默认做真正可用的工具界面，不做营销式首页。
- 保持列表优先、搜索优先、路径明确、预览后写入。
- 同步和迁移类操作必须让用户先看到影响范围，再执行写入。
- 区分“选择项目/目标”和“展开查看详情”，避免点击含义混乱。
- 文件路径、Agent 名称、目标项目要明确展示，避免使用含糊的“当前项目”。
- 桌面工具风格应克制、轻、本地感强；避免重仪表盘、过多容器和过度装饰。
- 新 UI 要延续现有视觉系统和 `design.md` 中的方向，除非用户明确要求重新设计。

## Tauri 与跨平台注意事项

- macOS 和 Windows 应保持功能与视觉一致，不要把 Windows 当成降级版本。
- 修改窗口尺寸、透明、背景、窗口效果时，同时检查：
  - `src-tauri/tauri.conf.json`
  - `src-tauri/tauri.macos.conf.json`
  - `src-tauri/tauri.windows.conf.json`
- Windows 的 symlink 能力取决于环境；不要默认一定可用，要保留清晰的 Developer Mode、管理员权限或 Copy fallback 提示。
- 文件系统路径处理要尊重平台差异，不要用只适用于 macOS/Linux 的路径假设覆盖 Windows。

## Git 规则

- 不要自动 commit、push、rebase、force push 或创建 PR。
- 不要使用 `git reset --hard`、`git checkout --` 等会覆盖本地改动的命令，除非用户明确要求。
- 如果用户要求 commit，commit message 用英文，格式参考：`type(scope): subject`。
