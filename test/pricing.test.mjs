import test from "node:test";
import assert from "node:assert/strict";
import {
  PriceBook,
  PricingSource,
  eventCost,
  modelCandidates,
  trimLiteLLM,
} from "../server/pricing.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const raw = {
  sample_spec: { input_cost_per_token: 1 },
  "claude-opus-5-5": {
    input_cost_per_token: 4e-6,
    output_cost_per_token: 20e-6,
    cache_read_input_token_cost: 0.4e-6,
    cache_creation_input_token_cost: 5e-6,
  },
  "github_copilot/kimi-k3": {
    input_cost_per_token: 0,
    output_cost_per_token: 0,
  },
  "sail/moonshotai/Kimi-K3": {
    input_cost_per_token: 9e-6,
    output_cost_per_token: 9e-6,
  },
  "moonshot/kimi-k3": {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
  },
  "coralbricks/glm-5.2": {
    input_cost_per_token: 9e-6,
    output_cost_per_token: 9e-6,
  },
  "zai/glm-5.2": {
    input_cost_per_token: 1.4e-6,
    output_cost_per_token: 4.4e-6,
  },
  "embedding-only": { mode: "embedding" },
};

test("trimLiteLLM keeps priced entries only", () => {
  const table = trimLiteLLM(raw);
  assert.equal(table["embedding-only"], undefined);
  assert.deepEqual(table["claude-opus-5-5"], {
    input: 4e-6,
    output: 20e-6,
    cacheRead: 0.4e-6,
    cacheWrite: 5e-6,
    cacheWrite1h: null,
  });
});

test("modelCandidates strips relay prefixes, paths and dates", () => {
  assert.deepEqual(modelCandidates("relay/OAI-GLM-5.2-20260101").slice(0, 4), [
    "relay/oai-glm-5.2-20260101",
    "oai-glm-5.2-20260101",
    "glm-5.2-20260101",
    "relay/oai-glm-5.2",
  ]);
  assert.ok(modelCandidates("oai-glm-5.2").includes("glm-5.2"));
});

test("PriceBook prefers exact keys, then the model's own vendor", () => {
  const book = new PriceBook(trimLiteLLM(raw));
  assert.equal(book.resolve("claude-opus-5-5").source, "claude-opus-5-5");
  assert.equal(book.resolve("kimi-k3").source, "moonshot/kimi-k3");
  assert.equal(book.resolve("oai-glm-5.2").source, "zai/glm-5.2");
  assert.equal(book.resolve("codex-auto-review"), null);
});

test("custom prices win and are given per million tokens", () => {
  const book = new PriceBook(trimLiteLLM(raw), [
    {
      model: "Kimi-K3",
      input: 1,
      output: 2,
      cacheRead: null,
      cacheWrite: null,
    },
  ]);
  const resolved = book.resolve("oai-kimi-k3");
  assert.equal(resolved.source, "override");
  assert.equal(resolved.price.input, 1e-6);
  assert.equal(resolved.price.cacheRead, null);
});

test("eventCost bills cache tiers, with one-hour writes at twice the input rate", () => {
  const price = trimLiteLLM(raw)["claude-opus-5-5"];
  const cost = eventCost(
    {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite: 2_000_000,
      cacheWrite1h: 1_000_000,
    },
    price,
  );
  assert.ok(Math.abs(cost - (4 + 20 + 0.4 + 5 + 8)) < 1e-9);
});

test("PricingSource caches the fetched list and reports failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paseo-stats-pricing-"));
  let calls = 0;
  const ok = new PricingSource(dir, async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => raw };
  });
  const first = await ok.load(true, 1000);
  assert.equal(first.status.source, "online");
  assert.ok(first.table["moonshot/kimi-k3"]);
  await ok.load(true, 1000);
  assert.equal(calls, 1);

  const offline = new PricingSource(dir, async () => {
    throw new Error("offline");
  });
  const cached = await offline.load(false, 1000);
  assert.equal(cached.status.source, "disabled");
  assert.ok(cached.table["claude-opus-5-5"]);

  const empty = new PricingSource(
    mkdtempSync(join(tmpdir(), "paseo-stats-pricing-")),
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
  );
  const failed = await empty.load(true, 1000);
  assert.equal(failed.status.source, "none");
  assert.equal(failed.status.error, "HTTP 503");
});
