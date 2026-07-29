const test = require("node:test");
const assert = require("node:assert/strict");
const {
  autoPartsTools,
  autoPartsToolRegistry,
  executeAutoPartsTool,
  getAutoPartsTool,
} = require("../dist/cjs/ai/index.js");

test("every tool has a name, a prescriptive description, and a valid schema", () => {
  assert.ok(autoPartsToolRegistry.length > 0);
  const names = new Set();

  for (const tool of autoPartsToolRegistry) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/, `bad tool name: ${tool.name}`);
    assert.ok(!names.has(tool.name), `duplicate tool name: ${tool.name}`);
    names.add(tool.name);

    assert.ok(
      tool.description.length > 40,
      `${tool.name}: description too thin to guide tool selection`
    );
    assert.match(
      tool.description,
      /Call this (when|after|before)/,
      `${tool.name}: description should say when to call the tool`
    );

    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.handler, "function");

    for (const required of tool.inputSchema.required ?? []) {
      assert.ok(
        required in tool.inputSchema.properties,
        `${tool.name}: '${required}' is required but not declared in properties`
      );
    }
    for (const [prop, schema] of Object.entries(tool.inputSchema.properties)) {
      assert.ok(schema.description, `${tool.name}.${prop} has no description`);
    }
  }
});

test("Anthropic tool schemas mirror the registry", () => {
  assert.equal(autoPartsTools.length, autoPartsToolRegistry.length);
  for (const tool of autoPartsTools) {
    assert.ok(tool.name && tool.description && tool.input_schema);
    assert.equal(tool.input_schema, getAutoPartsTool(tool.name).inputSchema);
    // The Messages API uses input_schema, not the MCP-style inputSchema.
    assert.ok(!("inputSchema" in tool));
  }
});

test("list_car_brands returns all brands, or filters by query", () => {
  const all = executeAutoPartsTool("list_car_brands", {});
  assert.ok(all.count >= 100);
  assert.equal(all.brands.length, all.count);

  const filtered = executeAutoPartsTool("list_car_brands", { query: "audi" });
  assert.ok(filtered.brands.includes("Audi"));
  assert.ok(filtered.count < all.count);
});

test("get_car_models resolves a brand and explains an unknown one", () => {
  const found = executeAutoPartsTool("get_car_models", { brand: "Audi" });
  assert.equal(found.found, true);
  assert.ok(found.count > 0);
  assert.ok(found.models[0].name);
  assert.ok(Array.isArray(found.models[0].generations));

  const missing = executeAutoPartsTool("get_car_models", { brand: "Nope Motors" });
  assert.equal(missing.found, false);
  // The message has to point the model at its next move, or it will guess.
  assert.match(missing.message, /list_car_brands/);
});

test("identify_vehicle pins a model year to one generation", () => {
  const result = executeAutoPartsTool("identify_vehicle", {
    brand: "Audi",
    model: "A4",
    year: 2010,
  });
  assert.equal(result.found, true);
  assert.ok(result.generation.yearFrom <= 2010);

  const impossible = executeAutoPartsTool("identify_vehicle", {
    brand: "Audi",
    model: "A4",
    year: 1800,
  });
  assert.equal(impossible.found, false);
  assert.match(impossible.message, /get_model_generations/);
});

test("search results are capped and report truncation honestly", () => {
  const parts = executeAutoPartsTool("search_auto_parts", { query: "brake", limit: 3 });
  assert.equal(parts.parts.length, 3);
  assert.ok(parts.count > 3);
  assert.equal(parts.truncated, true);

  // An over-large limit is clamped rather than rejected.
  const wide = executeAutoPartsTool("search_auto_parts", { query: "brake", limit: 99999 });
  assert.ok(wide.parts.length <= 200);

  const narrow = executeAutoPartsTool("search_auto_parts", { query: "brake", limit: 0 });
  assert.ok(narrow.parts.length > 0, "an invalid limit should fall back to the default");
});

test("get_database_stats matches the underlying data", () => {
  const db = require("../dist/cjs/index.js");
  const stats = executeAutoPartsTool("get_database_stats", {});
  assert.equal(stats.brands, db.getBrands().length);
  assert.equal(stats.parts, db.getParts().length);

  let models = 0;
  for (const brand of db.brands) models += brand.models.length;
  assert.equal(stats.models, models);
});

test("an unknown tool returns an error naming the valid tools", () => {
  const result = executeAutoPartsTool("teleport", {});
  assert.match(result.error, /Unknown tool/);
  assert.match(result.error, /list_car_brands/);
});

test("a handler that throws is reported, not propagated", () => {
  const tool = getAutoPartsTool("get_car_models");
  const original = tool.handler;
  tool.handler = () => {
    throw new Error("boom");
  };
  try {
    assert.deepEqual(executeAutoPartsTool("get_car_models", { brand: "Audi" }), {
      error: "boom",
    });
  } finally {
    tool.handler = original;
  }
});

test("every tool tolerates being called with no arguments", () => {
  for (const tool of autoPartsToolRegistry) {
    const result = executeAutoPartsTool(tool.name);
    assert.ok(result && typeof result === "object", `${tool.name} returned nothing`);
  }
});
