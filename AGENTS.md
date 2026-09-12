# AGENTS.md — dsh-skills-manager

DSH Web GUI 的**技能中心**插件：侧边栏「技能中心」入口打开面板，按来源分级
浏览已加载 skill（系统内置 / 项目 / 用户 / 自定义 / 运行时 / **面板添加的目录**），
支持启用/禁用（改写 frontmatter `disable-model-invocation`）、创建、删除
（移入 .trash），以及**在面板里增删扫描目录**。

本仓库是 [`@linxin666/dsh-client-ui-skill-explorer@0.3.20`](https://github.com/zhu1090093659/dsh-web)
的 fork（BSD-3-Clause）。`src/`、`tests/` 大部分为上游逐字移植，每个文件顶部有
来源横幅并注明本地改动；新增文件在 README「Provenance」节列出。改上游文件时
保留其风格与注释密度，不要顺手重构无关代码。

## 本包要点

- host 半区（`src/index.ts` + `src/routes.ts` + `src/access.ts` +
  `src/collect.ts` + `src/frontmatter.ts` + `src/directories.ts`）提供
  `/api/dsh-skills-manager/*` 路由族（list / set-enabled / create / delete /
  **directories / add-directory / remove-directory** / health），默认 loopback
  围栏，已配对设备 cookie 为额外放行路径（不硬依赖 remote-web-ui）；数据来自
  文件系统扫描（官方根约定）+ `ctx.skills` 注册表合并。
- **目录管理（本 fork 的核心）**：`src/directories.ts` 是唯一的状态层。配置
  来源（`customSkillDirs`）与面板来源（`$DSH_HOME/dsh-skills-manager/custom-dirs.json`）
  合成一份有效列表；配置项在面板里只读，删除配置项返回 `CONFIG_MANAGED`。
  路由每次请求重读 store，所以面板加目录后无需重启即可生效。
  **不要把配置写回 profile 的 cordis.patch.yml**——那会覆盖用户手写的配置。
- client 半区（`src/client/`）注入侧边栏入口（DOM 级，MutationObserver
  自愈），面板为 React overlay 模态（`SkillPanel.tsx`，三个 tab），不接管中心列。
  样式由 `scripts/build.mjs` 编译期解析成 `src/client/skill-panel.css.ts`
  （已提交占位，构建时重写），`src/client/styles.ts` 负责注入一次。
- 纯逻辑（扫描/分组/frontmatter 解析/目录 store）在 host 侧单测锁定行为
  （`tests/collect.spec.ts`、`tests/frontmatter.spec.ts`、
  `tests/routes.spec.ts`、`tests/access.spec.ts`、`tests/directories.spec.ts`）；
  路由围栏与错误路径必须带测试（`tests/directory-routes.spec.ts`），
  面板交互用 jsdom（`tests/panel-directories.spec.tsx`）。
- 安全语义（loopback 围栏、已配对 cookie 额外放行、写路由只信任扫描路径、
  路径必须绝对且真实存在、删除目录只改配置不动文件）见 README「安全模型」节，
  修改安全语义时必须同步更新 README 与测试。
- **不要加遥测**：本 fork 已移除上游发往 dsh-market.com 的心跳，且不应引入
  任何外发请求。

## 提交前检查

```sh
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # esbuild -> lib/
```
