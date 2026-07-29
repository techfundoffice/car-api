#!/usr/bin/env node
/**
 * Regression test for how the package is consumed.
 *
 * Guards the bug this script was written for: `import 'auto-parts-db'` used to
 * fail with "Unexpected token 'export'" because the ESM build was parsed as
 * CommonJS. A unit test importing source files would not have caught it — the
 * failure only appears when Node resolves the built artifacts the way a real
 * consumer does.
 */

import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check("dist/esm is marked as an ES module subtree", () => {
  const marker = resolve(root, "dist/esm/package.json");
  assert.ok(existsSync(marker), "dist/esm/package.json is missing");
  assert.equal(JSON.parse(readFileSync(marker, "utf8")).type, "module");
});

check("ESM consumers can import the package", async () => {
  const esm = await import(resolve(root, "dist/esm/index.js"));
  assert.equal(typeof esm.getBrands, "function");
  assert.ok(esm.getBrands().length > 0);
});

check("CommonJS consumers can require the package", () => {
  const cjs = require(resolve(root, "dist/cjs/index.js"));
  assert.equal(typeof cjs.getBrands, "function");
  assert.ok(cjs.getBrands().length > 0);
});

check("both builds expose the same API and the same data", async () => {
  const esm = await import(resolve(root, "dist/esm/index.js"));
  const cjs = require(resolve(root, "dist/cjs/index.js"));

  const esmExports = Object.keys(esm).filter((k) => k !== "default").sort();
  const cjsExports = Object.keys(cjs).sort();
  assert.deepEqual(
    esmExports,
    cjsExports,
    "the ESM and CommonJS builds export different names"
  );

  assert.deepEqual(esm.getBrands(), cjs.getBrands());
  assert.equal(esm.getParts().length, cjs.getParts().length);
});

check("every path named in package.json exports actually exists", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const paths = new Set();

  const collect = (value) => {
    if (typeof value === "string") {
      if (value.startsWith("./")) paths.add(value);
      return;
    }
    if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(pkg.exports);
  for (const field of ["main", "module", "types", "browser"]) {
    collect(pkg[field]);
  }

  for (const relative of paths) {
    // embeddings.json is generated on demand by the consumer, not shipped.
    if (relative.endsWith("embeddings.json")) continue;
    assert.ok(
      existsSync(resolve(root, relative)),
      `package.json points at ${relative}, which does not exist after a build`
    );
  }
});

let failed = 0;
for (const { name, fn } of checks) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${checks.length} packaging checks failed`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} packaging checks passed`);
