/**
 * Shared tool registry.
 *
 * One definition per capability, consumed by three surfaces:
 *   - the MCP server (src/mcp/server.ts)
 *   - Anthropic tool-use schemas (`autoPartsTools`)
 *   - the natural-language search loop (src/ai/ask.ts)
 *
 * Handlers are pure and synchronous — they only read the bundled data, so they
 * need no network, no key, and no I/O.
 */

import {
  getBrands,
  getModelsByBrand,
  getGenerations,
  getGenerationByYear,
  searchModels,
  getPartBySlug,
  searchParts,
  getParts,
} from "../index";

/** JSON Schema for a tool's input. Kept loose so it can be handed to any consumer. */
export type JSONSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (input: Record<string, any>) => unknown;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

function clampLimit(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * Every tool the database exposes to an AI agent.
 *
 * Descriptions are written prescriptively — they say *when* to call the tool,
 * not just what it does, which measurably improves tool selection.
 */
export const autoPartsToolRegistry: ToolDefinition[] = [
  {
    name: "list_car_brands",
    description:
      "List car manufacturer names in the database. Call this when the user asks which brands are covered, or when you need to confirm the exact spelling of a brand before calling another tool. Pass `query` to filter by substring.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Optional case-insensitive substring filter, e.g. 'volk' matches 'Volkswagen'.",
        },
      },
      additionalProperties: false,
    },
    handler: ({ query }) => {
      const brands = getBrands();
      if (!query) return { count: brands.length, brands };
      const q = String(query).toLowerCase();
      const filtered = brands.filter((b) => b.toLowerCase().includes(q));
      return { count: filtered.length, brands: filtered };
    },
  },
  {
    name: "get_car_models",
    description:
      "Get every model for one brand, each with its generations and production years. Call this when the user names a brand and wants to know what it makes, or before narrowing to a specific model.",
    inputSchema: {
      type: "object",
      properties: {
        brand: {
          type: "string",
          description: "Exact brand name, e.g. 'Audi'. Case-insensitive.",
        },
      },
      required: ["brand"],
      additionalProperties: false,
    },
    handler: ({ brand }) => {
      const models = getModelsByBrand(String(brand));
      if (models.length === 0) {
        return {
          brand,
          found: false,
          message: `No brand named '${brand}'. Call list_car_brands to see valid names.`,
        };
      }
      return {
        brand,
        found: true,
        count: models.length,
        models: models.map((m) => ({
          name: m.name,
          generations: m.generations,
        })),
      };
    },
  },
  {
    name: "get_model_generations",
    description:
      "Get the generations of one specific model, with the year each began and ended (`yearTo` is null for models still in production). Call this when the user asks which generation or facelift a model has.",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Brand name, e.g. 'BMW'." },
        model: { type: "string", description: "Model name, e.g. '3 Series'." },
      },
      required: ["brand", "model"],
      additionalProperties: false,
    },
    handler: ({ brand, model }) => {
      const generations = getGenerations(String(brand), String(model));
      return {
        brand,
        model,
        found: generations.length > 0,
        generations,
      };
    },
  },
  {
    name: "identify_vehicle",
    description:
      "Resolve a brand + model + year to the exact generation that was in production that year. Call this whenever the user mentions a model year (e.g. '2010 Audi A4') — it is the precise way to pin down which generation they mean.",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Brand name, e.g. 'Audi'." },
        model: { type: "string", description: "Model name, e.g. 'A4'." },
        year: {
          type: "integer",
          description: "Four-digit model year, e.g. 2010.",
        },
      },
      required: ["brand", "model", "year"],
      additionalProperties: false,
    },
    handler: ({ brand, model, year }) => {
      const generation = getGenerationByYear(
        String(brand),
        String(model),
        Number(year)
      );
      if (!generation) {
        return {
          brand,
          model,
          year,
          found: false,
          message:
            "No generation covers that year. Call get_model_generations to see the years that are covered.",
        };
      }
      return { brand, model, year, found: true, generation };
    },
  },
  {
    name: "search_car_models",
    description:
      "Search model names across every brand at once. Call this when the user names a model but not its brand (e.g. 'Golf', 'Mustang').",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Substring to match against model names.",
        },
        limit: {
          type: "integer",
          description: `Maximum results to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: ({ query, limit }) => {
      const all = searchModels(String(query));
      const capped = clampLimit(limit);
      return {
        query,
        count: all.length,
        truncated: all.length > capped,
        results: all.slice(0, capped).map((r) => ({
          brand: r.brand,
          model: r.model.name,
          generations: r.model.generations,
        })),
      };
    },
  },
  {
    name: "search_auto_parts",
    description:
      "Search the auto-parts catalogue by keyword. Matches the English slug and the part name. Call this when the user asks about a component ('brake pads', 'shock absorber', 'oil filter'). Slugs are English; display names are Russian, so prefer English keywords.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keyword to search for, e.g. 'brake', 'absorber', 'filter'.",
        },
        limit: {
          type: "integer",
          description: `Maximum results to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: ({ query, limit }) => {
      const all = searchParts(String(query));
      const capped = clampLimit(limit);
      return {
        query,
        count: all.length,
        truncated: all.length > capped,
        parts: all.slice(0, capped),
      };
    },
  },
  {
    name: "get_auto_part",
    description:
      "Look up one part by its exact slug. Call this after search_auto_parts when you need to confirm a specific part.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Exact part slug, e.g. 'front-brake-pads'.",
        },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    handler: ({ slug }) => {
      const part = getPartBySlug(String(slug));
      return part
        ? { found: true, part }
        : {
            found: false,
            slug,
            message: "No part with that slug. Use search_auto_parts instead.",
          };
    },
  },
  {
    name: "get_database_stats",
    description:
      "Report how much data the database holds (brand, model, generation, and part counts). Call this when the user asks about coverage or completeness.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: () => {
      const brandNames = getBrands();
      let models = 0;
      let generations = 0;
      for (const brand of brandNames) {
        const brandModels = getModelsByBrand(brand);
        models += brandModels.length;
        for (const m of brandModels) generations += m.generations.length;
      }
      return {
        brands: brandNames.length,
        models,
        generations,
        parts: getParts().length,
      };
    },
  },
];

/** Look up a tool definition by name. */
export function getAutoPartsTool(name: string): ToolDefinition | undefined {
  return autoPartsToolRegistry.find((t) => t.name === name);
}

/**
 * Tool schemas in Anthropic Messages API shape — drop straight into the
 * `tools` array of `client.messages.create()` or `client.beta.messages.toolRunner()`.
 */
export const autoPartsTools = autoPartsToolRegistry.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema,
}));

/**
 * Execute one tool by name. Returns the tool's result, or an error-shaped
 * object for an unknown tool or a handler that throws — never rejects, so it
 * is safe to call directly from an agent loop.
 */
export function executeAutoPartsTool(
  name: string,
  input: Record<string, any> = {}
): unknown {
  const tool = getAutoPartsTool(name);
  if (!tool) {
    return {
      error: `Unknown tool '${name}'. Available: ${autoPartsToolRegistry
        .map((t) => t.name)
        .join(", ")}`,
    };
  }
  try {
    return tool.handler(input ?? {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
