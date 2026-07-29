#!/usr/bin/env node
/**
 * Regression test for how the package is consumed.
 *
 * Guards the bug this script was written for: `import 'auto-parts-db'` used to
 * fail with "Unexpected token 'export'" because the ESM build was parsed as
 * CommonJS.
 *
 * It packs a real tarball, installs it into a throwaway project, and imports it
 * **by package name** in separate Node processes. That matters: loading
 * dist/esm/index.js by path bypasses the `exports` conditions in package.json,
 * which is the exact layer the bug lived in. Only a name-resolved import from
 * an installed tarball exercises the conditions, the nested ESM manifest, and
 * the `files` allowlist the way a consumer does.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

if (!existsSync(resolve(root, "dist"))) {
  console.error("dist/ is missing — run `npm run build` first.");
  process.exit(1);
}

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const workspace = mkdtempSync(join(tmpdir(), "auto-parts-db-packaging-"));
let failed = 0;

try {
  // 1. Pack exactly what `npm publish` would upload.
  const tarball = run("npm", ["pack", "--silent", "--pack-destination", workspace], root).trim();
  const tarballPath = join(workspace, tarball);
  assert.ok(existsSync(tarballPath), `npm pack did not produce ${tarball}`);

  // 2. Install it into an isolated ESM consumer.
  const consumer = join(workspace, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "packaging-consumer",
        version: "1.0.0",
        private: true,
        type: "module",
        dependencies: { [pkg.name]: `file:${tarballPath}` },
      },
      null,
      2
    )
  );
  run("npm", ["install", "--no-audit", "--no-fund", "--silent"], consumer);

  const installed = join(consumer, "node_modules", pkg.name);
  assert.ok(existsSync(installed), `${pkg.name} was not installed into the consumer`);

  // 3. Probe both module systems by package name, in separate processes, so
  //    Node resolves through the published `exports` map rather than a path.
  //    A probe that cannot even load is the failure mode this script exists to
  //    catch, so capture it as a result instead of letting it escape as an
  //    unhandled stack trace — the diagnosis is the whole point.
  const probe = (filename, source) => {
    writeFileSync(join(consumer, filename), source);
    try {
      return { ok: true, data: JSON.parse(run("node", [filename], consumer)) };
    } catch (err) {
      const detail = (err.stderr || err.message || "").toString().trim();
      return { ok: false, detail: detail.split("\n").slice(0, 6).join("\n      ") };
    }
  };

  const esm = probe(
    "probe-esm.mjs",
    `import * as db from ${JSON.stringify(pkg.name)};
     process.stdout.write(JSON.stringify({
       exports: Object.keys(db).filter((k) => k !== "default").sort(),
       brands: db.getBrands(),
       parts: db.getParts(),
     }));`
  );

  const cjs = probe(
    "probe-cjs.cjs",
    `const db = require(${JSON.stringify(pkg.name)});
     process.stdout.write(JSON.stringify({
       exports: Object.keys(db).sort(),
       brands: db.getBrands(),
       parts: db.getParts(),
     }));`
  );

  const loaded = (probeResult, style) => {
    assert.ok(
      probeResult.ok,
      `${style} consumers cannot load the published package:\n      ${probeResult.detail}`
    );
    return probeResult.data;
  };

  const checks = [
    [
      "the published tarball ships the ESM module marker",
      () => {
        const marker = join(installed, "dist/esm/package.json");
        assert.ok(
          existsSync(marker),
          "dist/esm/package.json is absent from the installed package — ESM consumers will get 'Unexpected token export'"
        );
        assert.equal(JSON.parse(readFileSync(marker, "utf8")).type, "module");
      },
    ],
    [
      "ESM consumers can import the package by name",
      () => {
        const db = loaded(esm, "ESM");
        assert.ok(db.exports.includes("getBrands"), "getBrands is not exported to ESM");
        assert.ok(db.brands.length > 0, "ESM import returned no brands");
      },
    ],
    [
      "CommonJS consumers can require the package by name",
      () => {
        const db = loaded(cjs, "CommonJS");
        assert.ok(db.exports.includes("getBrands"), "getBrands is not exported to CommonJS");
        assert.ok(db.brands.length > 0, "CommonJS require returned no brands");
      },
    ],
    [
      "both builds expose the same API and the same data",
      () => {
        const a = loaded(esm, "ESM");
        const b = loaded(cjs, "CommonJS");
        assert.deepEqual(a.exports, b.exports, "ESM and CommonJS export different names");
        assert.deepEqual(a.brands, b.brands, "brand data differs between builds");
        assert.deepEqual(a.parts, b.parts, "part data differs between builds");
      },
    ],
    [
      "every path named in package.json exists in the published package",
      () => {
        const paths = new Set();
        const collect = (value) => {
          if (typeof value === "string") {
            if (value.startsWith("./")) paths.add(value);
            return;
          }
          if (value && typeof value === "object") Object.values(value).forEach(collect);
        };
        collect(pkg.exports);
        for (const field of ["main", "module", "types", "browser"]) collect(pkg[field]);

        for (const relative of paths) {
          // embeddings.json is generated on demand by the consumer, not shipped.
          if (relative.endsWith("embeddings.json")) continue;
          assert.ok(
            existsSync(join(installed, relative)),
            `package.json points at ${relative}, which is missing from the published package`
          );
        }
      },
    ],
  ];

  for (const [name, fn] of checks) {
    try {
      fn();
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL  ${name}\n      ${err.message}`);
    }
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} packaging check(s) failed`);
  process.exit(1);
}
console.log("\nAll packaging checks passed against the installed tarball");
