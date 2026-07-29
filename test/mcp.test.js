const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const BIN = path.resolve(__dirname, "../dist/cjs/mcp/bin.js");

/**
 * Drives the real server over a real stdio transport, as an MCP client would.
 * The SDK is ESM-only on the import side, so it is loaded dynamically.
 */
async function withClient(run) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/stdio.js"
  );

  const transport = new StdioClientTransport({ command: "node", args: [BIN] });
  const client = new Client({ name: "auto-parts-db-tests", version: "1.0.0" }, {
    capabilities: {},
  });
  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

const parse = (result) => JSON.parse(result.content[0].text);

test("server starts on stdio and advertises its tools", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    for (const expected of [
      "list_car_brands",
      "get_car_models",
      "get_model_generations",
      "identify_vehicle",
      "search_car_models",
      "search_auto_parts",
      "get_auto_part",
      "get_database_stats",
    ]) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }

    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} has no description`);
      // MCP uses inputSchema; the Messages API spelling would be rejected.
      assert.equal(tool.inputSchema.type, "object");
    }
  });
});

test("identify_vehicle returns the correct generation over the wire", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "identify_vehicle",
      arguments: { brand: "Audi", model: "A4", year: 2010 },
    });
    assert.ok(!result.isError);

    const payload = parse(result);
    assert.equal(payload.found, true);
    assert.ok(payload.generation.yearFrom <= 2010);
    assert.ok(payload.generation.yearTo === null || payload.generation.yearTo >= 2010);
  });
});

test("search_auto_parts respects limit and reports the full count", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "search_auto_parts",
      arguments: { query: "brake", limit: 2 },
    });
    const payload = parse(result);

    assert.equal(payload.parts.length, 2);
    assert.ok(payload.count > 2);
    assert.equal(payload.truncated, true);
  });
});

test("get_auto_part resolves a slug taken from a search result", async () => {
  await withClient(async (client) => {
    const search = parse(
      await client.callTool({
        name: "search_auto_parts",
        arguments: { query: "brake", limit: 1 },
      })
    );
    const { slug } = search.parts[0];

    const part = parse(
      await client.callTool({ name: "get_auto_part", arguments: { slug } })
    );
    assert.equal(part.found, true);
    assert.equal(part.part.slug, slug);
  });
});

test("get_database_stats reports the shipped coverage", async () => {
  await withClient(async (client) => {
    const stats = parse(
      await client.callTool({ name: "get_database_stats", arguments: {} })
    );
    assert.ok(stats.brands >= 100);
    assert.ok(stats.models >= 2000);
    assert.ok(stats.parts >= 1200);
    assert.ok(stats.generations > stats.models);
  });
});

test("an unknown tool is flagged with isError rather than killing the server", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "no_such_tool", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(parse(result).error, /Unknown tool/);

    // The connection must survive so the client can carry on.
    const stats = await client.callTool({
      name: "get_database_stats",
      arguments: {},
    });
    assert.ok(!stats.isError);
  });
});

test("a missing required argument is reported, not thrown away", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "get_car_models",
      arguments: {},
    });
    // Either the SDK rejects it against the schema, or the handler reports that
    // no such brand exists. Both are acceptable; a silent success is not.
    const payload = parse(result);
    assert.ok(result.isError || payload.found === false);
  });
});
