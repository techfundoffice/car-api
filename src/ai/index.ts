/**
 * AI integration surface for auto-parts-db.
 *
 * Everything here is opt-in: importing `auto-parts-db` alone pulls none of it,
 * and the SDKs these modules use are optional peer dependencies.
 */

export {
  autoPartsTools,
  autoPartsToolRegistry,
  executeAutoPartsTool,
  getAutoPartsTool,
} from "./tools.js";
export type { ToolDefinition, JSONSchema } from "./tools.js";

export { askVehicle, DEFAULT_MODEL } from "./ask.js";
export type { AskVehicleOptions, AskVehicleResult } from "./ask.js";

export {
  semanticSearchParts,
  buildEmbeddingIndex,
  loadEmbeddingIndex,
  voyageEmbeddings,
  openAICompatibleEmbeddings,
  normalize,
  quantize,
  encodeBase64,
  decodeBase64,
} from "./semantic.js";
export type {
  EmbeddingIndex,
  EmbeddingProvider,
  SemanticSearchOptions,
  SemanticSearchResult,
} from "./semantic.js";
