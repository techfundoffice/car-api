/**
 * Natural-language querying over the database, powered by Claude.
 *
 * `askVehicle("what brake parts fit a 2010 Audi A4?")` runs an agentic tool-use
 * loop: Claude picks tools from the shared registry, this module executes them
 * against the local data, and Claude answers from the results. No vehicle or
 * parts data is invented — every fact comes back through a tool call.
 *
 * The Anthropic SDK is an optional peer dependency, imported lazily so the core
 * database stays dependency-free for consumers who never call this.
 */

import { autoPartsTools, executeAutoPartsTool } from "./tools";

/** Default model. Opus 5 handles the multi-step lookups these questions need. */
export const DEFAULT_MODEL = "claude-opus-5";

const DEFAULT_SYSTEM = `You answer questions about cars and auto parts using the auto-parts-db tools.

Every factual claim about a brand, model, generation, production year, or part must come from a tool result. If the tools do not cover something, say so plainly rather than answering from memory — the database is the authority here, not your training data.

When the user names a model year, call identify_vehicle to pin down the exact generation before answering.

Part slugs are English; part display names are Russian. Search with English keywords, and give the user the slug alongside the name so they have something stable to reference.

Answer in the language the user wrote in. Keep responses focused and brief — lead with the answer, then supporting detail.`;

export type AskVehicleOptions = {
  /** Anthropic API key. Defaults to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /**
   * A pre-configured Anthropic client. Supply this to reuse a client, point at
   * a gateway, or run on Bedrock/Vertex. Takes precedence over `apiKey`.
   */
  client?: any;
  /** Model ID. Defaults to `claude-opus-5`. */
  model?: string;
  /** Output token cap. Defaults to 4096. */
  maxTokens?: number;
  /** Reasoning effort: "low" | "medium" | "high" | "xhigh" | "max". Defaults to "medium". */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Replaces the default system prompt entirely. */
  system?: string;
  /** Caps the tool-use loop so a pathological question cannot spin. Defaults to 10. */
  maxIterations?: number;
};

export type AskVehicleResult = {
  /** Claude's answer as plain text. */
  answer: string;
  /** Every tool call made, in order — useful for debugging and for auditing. */
  toolCalls: { name: string; input: Record<string, any> }[];
  /** Why the final turn ended. `"refusal"` means safety classifiers declined. */
  stopReason: string | null;
  /** Token usage of the final turn. */
  usage: unknown;
};

async function resolveClient(options: AskVehicleOptions): Promise<any> {
  if (options.client) return options.client;

  let sdk: any;
  try {
    sdk = await import("@anthropic-ai/sdk");
  } catch {
    throw new Error(
      "askVehicle() needs the Anthropic SDK. Install it with 'npm install @anthropic-ai/sdk', or pass your own client via the `client` option."
    );
  }
  const Anthropic = sdk.default ?? sdk.Anthropic;
  return options.apiKey ? new Anthropic({ apiKey: options.apiKey }) : new Anthropic();
}

function textOf(message: any): string {
  if (!message?.content) return "";
  return message.content
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("")
    .trim();
}

/**
 * Ask a free-form question about the vehicle and parts database.
 *
 * @example
 * const { answer } = await askVehicle("Which generation is a 2010 Audi A4?");
 */
export async function askVehicle(
  query: string,
  options: AskVehicleOptions = {}
): Promise<AskVehicleResult> {
  if (!query || !query.trim()) throw new Error("askVehicle() requires a question");

  const {
    model = DEFAULT_MODEL,
    maxTokens = 4096,
    effort = "medium",
    system = DEFAULT_SYSTEM,
    maxIterations = 10,
  } = options;

  const client = await resolveClient(options);
  const toolCalls: { name: string; input: Record<string, any> }[] = [];
  const messages: any[] = [{ role: "user", content: query }];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      output_config: { effort },
      tools: autoPartsTools,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return {
        answer: textOf(response),
        toolCalls,
        stopReason: "refusal",
        usage: response.usage,
      };
    }

    if (response.stop_reason !== "tool_use") {
      return {
        answer: textOf(response),
        toolCalls,
        stopReason: response.stop_reason ?? null,
        usage: response.usage,
      };
    }

    messages.push({ role: "assistant", content: response.content });

    // Every tool_use block must get a matching tool_result, all in one user
    // message — splitting them trains Claude out of calling tools in parallel.
    const results = response.content
      .filter((block: any) => block.type === "tool_use")
      .map((block: any) => {
        toolCalls.push({ name: block.name, input: block.input });
        const result = executeAutoPartsTool(block.name, block.input);
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      });

    messages.push({ role: "user", content: results });
  }

  throw new Error(
    `askVehicle() hit the ${maxIterations}-iteration limit without a final answer. Raise \`maxIterations\` or simplify the question.`
  );
}
