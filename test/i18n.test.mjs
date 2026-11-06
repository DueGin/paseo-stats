import test from "node:test";
import assert from "node:assert/strict";
import { en, nest, placeholders, zh } from "../client/messages.ts";
import { resolveLanguage } from "../client/locale.ts";
import { localizeError } from "../client/errors.ts";

const pluralBase = (key) => key.replace(/_(one|other)$/, "");

test("every English message has Chinese text with the same placeholders", () => {
  for (const key of Object.keys(en)) {
    const chinese = zh[key] ?? zh[`${pluralBase(key)}_other`];
    assert.ok(chinese, `missing Chinese text for ${key}`);
    assert.deepEqual(placeholders(chinese), placeholders(en[key]), key);
  }
  for (const key of Object.keys(zh)) {
    assert.ok(key in en, `Chinese key ${key} has no English source`);
  }
});

test("plural messages come in pairs and count with `count`", () => {
  for (const key of Object.keys(en)) {
    if (!/_(one|other)$/.test(key)) continue;
    const base = pluralBase(key);
    assert.ok(`${base}_one` in en && `${base}_other` in en, base);
    assert.ok(placeholders(en[key]).includes("count"), key);
    assert.ok(!(base in en), `${base} is both plural and plain`);
  }
});

test("messages use i18next placeholders only", () => {
  for (const table of [en, zh]) {
    for (const [key, value] of Object.entries(table)) {
      const stray = value.replace(/\{\{\w+\}\}/g, "");
      assert.ok(!/[{}]/.test(stray), `${key}: ${value}`);
    }
  }
});

test("nest builds the host's resource tree and rejects clashes", () => {
  assert.deepEqual(nest({ "a.b": "x", "a.c_one": "y", d: "z" }), {
    a: { b: "x", c_one: "y" },
    d: "z",
  });
  assert.throws(() => nest({ a: "x", "a.b": "y" }));
  assert.throws(() => nest({ "a.b": "y", a: "x" }));
  assert.equal(nest(en).app.title, "Usage stats");
  assert.equal(nest(zh).app.title, "用量统计");
});

test("language follows the first supported preference", () => {
  assert.equal(resolveLanguage(["zh-CN"]), "zh");
  assert.equal(resolveLanguage(["zh-Hant-TW"]), "zh");
  assert.equal(resolveLanguage(["zh_HK"]), "zh");
  assert.equal(resolveLanguage(["fr-FR", "zh-CN", "en"]), "zh");
  assert.equal(resolveLanguage(["en-GB", "zh-CN"]), "en");
  assert.equal(resolveLanguage(["ja", null]), "en");
  assert.equal(resolveLanguage([]), "en");
});

test("server errors the plugin owns are shown in the reader's language", () => {
  const t = (key, params) =>
    params ? `${key} ${JSON.stringify(params)}` : key;
  assert.equal(localizeError("empty price list", t), "error.emptyPrices");
  assert.equal(
    localizeError("GitHub HTTP 403", t),
    'error.githubHttp {"status":"403"}',
  );
  assert.equal(localizeError("HTTP 502", t), 'error.http {"status":"502"}');
  assert.equal(
    localizeError("timed out after 15000ms", t),
    'error.timeout {"seconds":15}',
  );
  assert.equal(
    localizeError("No update to v1.2.0 is available", t),
    'error.noUpdate {"tag":"v1.2.0"}',
  );
  assert.equal(localizeError("fetch failed", t), "error.network");
  assert.equal(
    localizeError("EACCES: permission denied", t),
    "EACCES: permission denied",
  );
});
