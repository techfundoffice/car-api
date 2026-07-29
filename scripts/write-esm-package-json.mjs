#!/usr/bin/env node
/**
 * Mark dist/esm as an ES module subtree.
 *
 * The package root is "type": "commonjs", so without this file Node parses
 * dist/esm/*.js as CommonJS and any `import 'auto-parts-db'` dies with
 * "Unexpected token 'export'". A nested package.json overrides the module type
 * for that directory only, leaving dist/cjs untouched.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "dist/esm/package.json");

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify({ type: "module" }, null, 2) + "\n");

console.log("wrote dist/esm/package.json ({ type: module })");
