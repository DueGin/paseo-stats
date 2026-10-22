# Paseo 用量统计 (Paseo Stats)

[English](./README.md)

[Paseo](https://paseo.sh) 插件：按客户端（provider）、模型、项目统计 agent 的 token 用量与 USD 费用，并统计多 agent 协作情况。

## 功能

- **三个维度**：按客户端、模型、项目查看输入、输出、缓存读、缓存写、总 tokens、费用与占比；可按费用或 tokens 排序，点击行即按其筛选。
- **时间范围**：近 24 小时（默认）、7 天、30 天、90 天、全部、自定义。
- **筛选**：客户端、模型、项目三个可搜索的多选下拉，组合作用于整页。
- **多 agent 协作**：协作任务数、子 agent 数、平均/最大扇出、层级、子 agent 费用占比、客户端组合（如 Claude → Codex），以及协作任务排行与成员明细。Codex 子线程、Claude 子代理等内置子代理单独计数。
- **协作具体到模型**：每个模型作为编排者、子 agent、内置子代理时各自的花费与协作占比，以该模型为主模型的编排者委派了多少子 agent、花了多少、扇出多少，以及按模型或客户端的父 → 子组合（如 `claude-opus-5-5 → gpt-6.1-sol ×93`）。点击模型即可按其筛选整页。
- **热更新**：检测 GitHub Release 新版本，统计页一键更新，可开启自动更新，Paseo 无需重启。

## 数据来源

Paseo 不保存用量历史，插件读取守护进程所在机器上各客户端的会话日志，并按会话关联到 Paseo agent：

| 客户端   | 日志目录                                                    |
| -------- | ----------------------------------------------------------- |
| Claude   | `~/.claude/projects`（或 `CLAUDE_CONFIG_DIR`）              |
| Codex    | `~/.codex/sessions`、`archived_sessions`（或 `CODEX_HOME`） |
| Pi       | `~/.pi/agent/sessions`（或 `PI_CODING_AGENT_DIR`）          |
| Oh My Pi | `~/.omp/agent/sessions`                                     |

用量会写入插件账本 `~/.paseo/plugin-data/paseo-stats`，客户端清理日志后数据仍保留。每轮对话结束、每 10 分钟以及打开页面时同步。

费用为估算：日志自带费用（Pi、Oh My Pi）时直接采用，否则按设置中的自定义单价或 [LiteLLM](https://github.com/BerriAI/litellm) 公开价格（含缓存读写价）计算。

## 安装

要求 Paseo `>= 0.12.0`，并在 设置 → 插件 中启用插件。

```bash
# 固定到某个发布版本（推荐，可使用应用内更新）
paseo plugin install github:DueGin/paseo-stats --ref v0.1.0
```

安装后在侧边栏底部打开“用量统计”，或在 ⌘K 中搜索“用量统计”。设置位于 设置 → 插件 → paseo-stats → ⋯ → 用量统计设置。

## 更新

- **应用内**：有新版本时统计页顶部出现提示，点“立即更新”；设置中可开启“自动更新”（每 6 小时检查）。
- **命令行**：`paseo plugin update paseo-stats --ref vX.Y.Z`。

更新通过 `paseo plugin update` 完成，插件会自动重新加载，守护进程不重启。从本地目录安装的副本不支持应用内更新，请 `git pull` 后执行 `paseo plugin reload paseo-stats`。若守护进程找不到 `paseo` 命令行，在其环境中设置 `PASEO_CLI`。

## 开发

使用 Node.js 24（`.nvmrc`）。

```bash
npm ci
npm run dev      # 热重载：链接本目录到本机 Paseo，保存即 reload
npm run check    # 类型检查、测试、格式、版本一致性
```

`npm run dev` 若发现同名插件已从其他来源安装，可用 `npm run dev -- --id paseo-stats-dev` 以另一个 ID 安装开发副本；`--home <path>` 指定守护进程目录。

## 发版

```bash
npm version patch   # 或 minor / major：同步 shared/version.ts，提交并打 vX.Y.Z tag
git push --follow-tags
```

推送 `v*` tag 会触发 [Release 工作流](.github/workflows/release.yml)：校验 tag 位于 main 且与版本号一致 → `npm run check` → 打包 → 创建 GitHub Release（附 `.tgz`，自动生成说明）。tag 含 `-`（如 `v0.2.0-beta.1`）时标记为预发布，不会推送给应用内更新。

可选：在仓库 Secrets 中配置 `NPM_TOKEN` 后，同一工作流会以 provenance 发布到 npm；未配置时跳过。

## 许可

[MIT](./LICENSE)
