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
} from "./tools";
export type { ToolDefinition, JSONSchema } from "./tools";

export { askVehicle, DEFAULT_MODEL } from "./ask";
export type { AskVehicleOptions, AskVehicleResult } from "./ask";

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
} from "./semantic";
export type {
  EmbeddingIndex,
  EmbeddingProvider,
  SemanticSearchOptions,
  SemanticSearchResult,
} from "./semantic";
