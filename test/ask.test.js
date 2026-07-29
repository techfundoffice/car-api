const test = require("node:test");
const assert = require("node:assert/strict");
const { askVehicle, DEFAULT_MODEL } = require("../dist/cjs/ai/index.js");

/**
 * A scripted stand-in for the Anthropic client. Each entry in `script` is
 * returned by one call to messages.create, so a test can drive the full
 * tool-use loop without an API key or a network call.
 */
function mockClient(script) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        const next = script[calls.length - 1];
        if (!next) throw new Error("mock client ran out of scripted responses");
        return next;
      },
    },
  };
}

const answerOnly = (text) => ({
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5 },
});

test("uses claude-opus-5 by default", () => {
  assert.equal(DEFAULT_MODEL, "claude-opus-5");
});

test("returns the answer directly when Claude calls no tools", async () => {
  const client = mockClient([answerOnly("The A4 is an Audi sedan.")]);
  const result = await askVehicle("What is an Audi A4?", { client });

  assert.equal(result.answer, "The A4 is an Audi sedan.");
  assert.deepEqual(result.toolCalls, []);
  assert.equal(result.stopReason, "end_turn");
  assert.equal(client.calls.length, 1);
});

test("sends the tool schemas and the configured model, effort, and system prompt", async () => {
  const client = mockClient([answerOnly("ok")]);
  await askVehicle("hello", {
    client,
    model: "claude-sonnet-5",
    effort: "high",
    maxTokens: 512,
    system: "custom system prompt",
  });

  const [params] = client.calls;
  assert.equal(params.model, "claude-sonnet-5");
  assert.equal(params.max_tokens, 512);
  assert.equal(params.system, "custom system prompt");
  assert.deepEqual(params.output_config, { effort: "high" });
  assert.ok(params.tools.some((t) => t.name === "identify_vehicle"));
  // Sampling parameters are rejected by current models.
  assert.ok(!("temperature" in params));
  assert.ok(!("top_p" in params));
});

test("executes requested tools and feeds real results back", async () => {
  const client = mockClient([
    {
      content: [
        { type: "text", text: "Let me check." },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "identify_vehicle",
          input: { brand: "Audi", model: "A4", year: 2010 },
        },
      ],
      stop_reason: "tool_use",
      usage: {},
    },
    answerOnly("That is a B8 (Type 8K)."),
  ]);

  const result = await askVehicle("Which generation is a 2010 Audi A4?", { client });

  assert.equal(result.answer, "That is a B8 (Type 8K).");
  assert.deepEqual(result.toolCalls, [
    { name: "identify_vehicle", input: { brand: "Audi", model: "A4", year: 2010 } },
  ]);

  // The second request must carry the assistant turn plus a matching tool_result.
  const followUp = client.calls[1];
  assert.equal(followUp.messages.length, 3);
  assert.equal(followUp.messages[1].role, "assistant");
  assert.equal(followUp.messages[2].role, "user");

  const [toolResult] = followUp.messages[2].content;
  assert.equal(toolResult.type, "tool_result");
  assert.equal(toolResult.tool_use_id, "toolu_1");
  // The tool result must be the real database answer, not a placeholder.
  assert.match(JSON.parse(toolResult.content).generation.name, /B8/);
});

test("returns every parallel tool result in a single user message", async () => {
  const client = mockClient([
    {
      content: [
        { type: "tool_use", id: "a", name: "list_car_brands", input: {} },
        { type: "tool_use", id: "b", name: "get_database_stats", input: {} },
      ],
      stop_reason: "tool_use",
      usage: {},
    },
    answerOnly("done"),
  ]);

  await askVehicle("How big is the database?", { client });

  const results = client.calls[1].messages[2].content;
  assert.equal(results.length, 2, "parallel tool results must not be split across messages");
  assert.deepEqual(results.map((r) => r.tool_use_id), ["a", "b"]);
});

test("surfaces a refusal instead of treating it as an answer", async () => {
  const client = mockClient([
    {
      content: [],
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
      usage: {},
    },
  ]);

  const result = await askVehicle("something declined", { client });
  assert.equal(result.stopReason, "refusal");
  assert.equal(client.calls.length, 1, "a refusal must not be retried in the loop");
});

test("stops at maxIterations rather than looping forever", async () => {
  const looping = {
    content: [{ type: "tool_use", id: "x", name: "get_database_stats", input: {} }],
    stop_reason: "tool_use",
    usage: {},
  };
  const client = mockClient(new Array(10).fill(looping));

  await assert.rejects(
    () => askVehicle("loop", { client, maxIterations: 3 }),
    /3-iteration limit/
  );
  assert.equal(client.calls.length, 3);
});

test("rejects an empty question before making a request", async () => {
  await assert.rejects(() => askVehicle("   "), /requires a question/);
  await assert.rejects(() => askVehicle(""), /requires a question/);
});

test("an unknown tool name comes back as an error result, not a crash", async () => {
  const client = mockClient([
    {
      content: [{ type: "tool_use", id: "z", name: "not_a_tool", input: {} }],
      stop_reason: "tool_use",
      usage: {},
    },
    answerOnly("recovered"),
  ]);

  const result = await askVehicle("weird", { client });
  assert.equal(result.answer, "recovered");
  const payload = JSON.parse(client.calls[1].messages[2].content[0].content);
  assert.match(payload.error, /Unknown tool/);
});
