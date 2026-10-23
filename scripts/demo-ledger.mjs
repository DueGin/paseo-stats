#!/usr/bin/env node
// Writes a synthetic usage ledger for README screenshots, so no real project
// names, prompts or spend end up in the docs.
//
//   node scripts/demo-ledger.mjs <ledger dir> --lang zh|en
//
// Point a throwaway daemon's PASEO_HOME at a directory whose
// plugin-data/paseo-stats is <ledger dir>. Values are seeded, so both
// languages show the same numbers.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir] = process.argv.slice(2);
const lang = process.argv[process.argv.indexOf("--lang") + 1] ?? "en";
if (!dir || !["zh", "en"].includes(lang)) {
  console.error("usage: demo-ledger.mjs <ledger dir> --lang zh|en");
  process.exit(1);
}

let seed = 20261023;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (low, high) => Math.round(low + (high - low) * random());

const HOUR = 3_600_000;
const now = Date.now();

const PROJECTS = {
  web: ["acme-web", "/work/acme-web"],
  billing: ["billing-service", "/work/billing-service"],
  mobile: ["mobile-app", "/work/mobile-app"],
  data: ["data-pipeline", "/work/data-pipeline"],
  docs: ["docs-site", "/work/docs-site"],
};

const MODELS = {
  claude: "claude-opus-5-5",
  codex: "gpt-6.1-sol",
  kimi: "kimi-k3",
  glm: "glm-5.3",
  flash: "deepseek-v4.1-flash",
  grok: "grok-4.7",
};

// [id, provider, model, project, parent, zh title, en title]
const AGENTS = [
  [
    "web-lead",
    "claude",
    "claude",
    "web",
    null,
    "重构结账流程并补齐端到端测试",
    "Refactor the checkout flow and add end-to-end tests",
  ],
  [
    "web-api",
    "codex",
    "codex",
    "web",
    "web-lead",
    "结账 API：订单状态机与幂等重试",
    "Checkout API: order state machine and idempotent retries",
  ],
  [
    "web-pay",
    "codex",
    "codex",
    "web",
    "web-lead",
    "接入新的支付网关与回调校验",
    "Integrate the new payment gateway and verify callbacks",
  ],
  [
    "web-cart",
    "codex",
    "codex",
    "web",
    "web-lead",
    "购物车并发更新与库存锁",
    "Concurrent cart updates and stock locks",
  ],
  [
    "web-e2e",
    "codex",
    "codex",
    "web",
    "web-lead",
    "补齐结账端到端测试",
    "Fill in checkout end-to-end tests",
  ],
  [
    "web-ui",
    "pi",
    "kimi",
    "web",
    "web-lead",
    "结账页 UI 与表单校验",
    "Checkout page UI and form validation",
  ],
  [
    "web-a11y",
    "pi",
    "kimi",
    "web",
    "web-lead",
    "结账页无障碍与键盘操作",
    "Checkout accessibility and keyboard support",
  ],
  [
    "web-copy",
    "pi",
    "glm",
    "web",
    "web-lead",
    "错误提示文案与多语言",
    "Error messages and translations",
  ],
  [
    "web-review",
    "codex",
    "codex",
    "web",
    "web-lead",
    "对抗式代码审查：结账改动",
    "Adversarial review of the checkout changes",
  ],
  [
    "bill-lead",
    "claude",
    "claude",
    "billing",
    null,
    "新增按量计费与发票导出",
    "Add usage-based billing and invoice export",
  ],
  [
    "bill-meter",
    "codex",
    "codex",
    "billing",
    "bill-lead",
    "用量计量管道与聚合任务",
    "Usage metering pipeline and rollups",
  ],
  [
    "bill-rate",
    "codex",
    "codex",
    "billing",
    "bill-lead",
    "阶梯价格与折扣规则引擎",
    "Tiered pricing and discount rules",
  ],
  [
    "bill-pdf",
    "pi",
    "kimi",
    "billing",
    "bill-lead",
    "发票 PDF 模板与导出",
    "Invoice PDF templates and export",
  ],
  [
    "bill-admin",
    "pi",
    "kimi",
    "billing",
    "bill-lead",
    "管理后台账单页面",
    "Admin billing pages",
  ],
  [
    "bill-audit",
    "omp",
    "grok",
    "billing",
    "bill-lead",
    "账单数据一致性核对",
    "Billing data consistency audit",
  ],
  [
    "bill-migrate",
    "codex",
    "codex",
    "billing",
    "bill-lead",
    "历史账单数据迁移脚本",
    "Migration script for historical invoices",
  ],
  [
    "data-lead",
    "codex",
    "codex",
    "data",
    null,
    "迁移 ETL 到增量同步",
    "Move the ETL jobs to incremental sync",
  ],
  [
    "data-cdc",
    "codex",
    "codex",
    "data",
    "data-lead",
    "变更数据捕获与断点续传",
    "Change data capture with resumable checkpoints",
  ],
  [
    "data-schema",
    "pi",
    "glm",
    "data",
    "data-lead",
    "Schema 演进与兼容性检查",
    "Schema evolution and compatibility checks",
  ],
  [
    "data-dq",
    "pi",
    "glm",
    "data",
    "data-lead",
    "数据质量规则与告警",
    "Data quality rules and alerts",
  ],
  [
    "data-backfill",
    "pi",
    "flash",
    "data",
    "data-cdc",
    "历史数据回填与校验",
    "Backfill and verify historical data",
  ],
  [
    "mob-lead",
    "claude",
    "claude",
    "mobile",
    null,
    "离线模式与同步冲突处理",
    "Offline mode and sync conflict handling",
  ],
  [
    "mob-store",
    "codex",
    "codex",
    "mobile",
    "mob-lead",
    "本地存储与增量同步队列",
    "Local storage and incremental sync queue",
  ],
  [
    "mob-merge",
    "codex",
    "codex",
    "mobile",
    "mob-lead",
    "冲突合并策略与单元测试",
    "Conflict merge strategy and unit tests",
  ],
  [
    "mob-ui",
    "pi",
    "kimi",
    "mobile",
    "mob-lead",
    "离线状态提示与重试交互",
    "Offline banners and retry interactions",
  ],
  [
    "mob-qa",
    "codex",
    "codex",
    "mobile",
    "mob-lead",
    "弱网与断网场景回归",
    "Regression on flaky and offline networks",
  ],
  [
    "docs-solo",
    "claude",
    "claude",
    "docs",
    null,
    "整理 API 文档与示例",
    "Tidy the API docs and examples",
  ],
  [
    "web-hotfix",
    "codex",
    "codex",
    "web",
    null,
    "修复优惠券叠加计算错误",
    "Fix stacked coupon calculation",
  ],
  [
    "data-explore",
    "pi",
    "kimi",
    "data",
    null,
    "分析慢查询并给出索引建议",
    "Analyse slow queries and suggest indexes",
  ],
  [
    "bill-spike",
    "pi",
    "flash",
    "billing",
    null,
    "调研税率服务接入方案",
    "Spike: tax rate service options",
  ],
  [
    "mob-crash",
    "omp",
    "grok",
    "mobile",
    null,
    "排查启动崩溃日志",
    "Investigate startup crash logs",
  ],
  [
    "scratch",
    "claude",
    "claude",
    null,
    null,
    "评估新的发布流程",
    "Evaluate the new release process",
  ],
];

const LABELS = { claude: "Claude", codex: "Codex", pi: "Pi", omp: "Oh My Pi" };

// Rough per-request token shapes: [input, cacheRead, output, cacheWrite].
const SHAPES = {
  claude: () => [
    between(2, 40),
    between(60_000, 180_000),
    between(800, 4_000),
    between(0, 6_000),
  ],
  codex: () => [
    between(4_000, 30_000),
    between(40_000, 160_000),
    between(300, 3_000),
    0,
  ],
  pi: () => [
    between(2_000, 20_000),
    between(20_000, 120_000),
    between(200, 2_500),
    between(0, 4_000),
  ],
  omp: () => [
    between(2_000, 18_000),
    between(20_000, 90_000),
    between(200, 2_000),
    0,
  ],
};

const agents = {};
const events = [];
let sequence = 0;

function event(agentId, model, ts, shape, native = null) {
  const [input, cacheRead, output, cacheWrite] = shape;
  sequence += 1;
  events.push({
    k: `demo:${sequence}`,
    t: Math.round(ts),
    a: agentId,
    m: model,
    i: input,
    o: output,
    r: cacheRead,
    w: cacheWrite,
    s: native ?? agentId,
    ...(native ? { n: 1 } : {}),
  });
}

for (const [id, provider, model, project, parent, zh, en] of AGENTS) {
  const isRoot = parent === null;
  const old = id === "scratch" || id === "docs-solo";
  // Most work lands in the last day so the default 24-hour view is busy.
  const start = old
    ? now - between(40, 120) * HOUR
    : now - (isRoot ? between(18, 22) : between(4, 17)) * HOUR;
  const [projectName, projectPath] = project ? PROJECTS[project] : [null, null];
  agents[id] = {
    id,
    provider,
    title: lang === "zh" ? zh : en,
    cwd: projectPath ?? "/work/scratch",
    projectKey: project ? `prj_demo_${project}` : null,
    projectName,
    projectPath,
    parentId: parent,
    createdAt: Math.round(start),
    model: MODELS[model],
    sessionId: null,
  };
  const requests = isRoot ? between(25, 60) : between(15, 70);
  const span = between(1, 4) * HOUR;
  for (let i = 0; i < requests; i += 1) {
    event(id, MODELS[model], start + (span * i) / requests, SHAPES[provider]());
  }
  // Codex runs its own subthreads; a few are the auto-review guardian.
  if (provider === "codex" && !isRoot) {
    const threads = between(1, 3);
    for (let thread = 0; thread < threads; thread += 1) {
      const session = `${id}/thread-${thread + 1}`;
      for (let i = 0; i < between(6, 18); i += 1) {
        event(
          id,
          MODELS.codex,
          start + span * random(),
          SHAPES.codex(),
          session,
        );
      }
    }
    if (random() < 0.5) {
      const session = `${id}/guardian`;
      for (let i = 0; i < 3; i += 1) {
        event(
          id,
          "codex-auto-review",
          start + span * random(),
          [between(3_000, 9_000), 0, between(100, 400), 0],
          session,
        );
      }
    }
  }
}

mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "events.jsonl"),
  events.map((line) => JSON.stringify(line)).join("\n") + "\n",
);
writeFileSync(
  join(dir, "state.json"),
  JSON.stringify({
    version: 1,
    files: {},
    agents,
    codexThreads: {},
    providerLabels: LABELS,
    lastSyncAt: now,
  }),
);
console.log(
  `${Object.keys(agents).length} agents, ${events.length} events -> ${dir}`,
);
