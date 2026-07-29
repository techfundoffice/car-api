# 🚗 Car Brands, Models & Parts Database

[![npm version](https://img.shields.io/npm/v/auto-parts-db)](https://www.npmjs.com/package/auto-parts-db)
[![npm downloads](https://img.shields.io/npm/dm/auto-parts-db)](https://www.npmjs.com/package/auto-parts-db)
[![GitHub stars](https://img.shields.io/github/stars/lifeofcapo/car-list?style=social)](https://github.com/lifeofcapo/car-list/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/lifeofcapo/car-list)]()
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

📚 [Documentation](https://lifeofcapo.github.io/car-api/) · [NPM](https://npmjs.com/package/auto-parts-db)

**Save hundreds of euros on commercial APIs!** 

The most comprehensive **automotive database** for JavaScript/TypeScript. 
Includes 100+ car brands, 2000+ models with generations (1968-present), 
and 1200+ auto parts. Perfect for dealerships, e-commerce, and automotive apps.

## ✨ Features

- 🚙 **100+ Car Brands** - Audi, BMW, Toyota, Ford, Tesla, and more
- 📅 **Generations with years** - Exact production years (1968-present)
- 🔧 **1200+ Auto Parts** - Comprehensive parts catalog
- 🤖 **AI ready** - MCP server, Claude tool definitions, natural-language search
- 📦 **Lightweight & Tree-shakeable** - Use only what you need
- 🌐 **Works everywhere** - Node.js, browsers, React, Vue, Angular
- 📘 **TypeScript ready** - Full type definitions included

## 📦 Installation 

```bash
npm install auto-parts-db

yarn add auto-parts-db

pnpm add auto-parts-db
```
---

## 🚀 Quick Start
```js
import { getBrands, getModelsByBrand, searchParts } from 'auto-parts-db';

const brands = getBrands();
console.log(brands);

const audiModels = getModelsByBrand('Audi');
console.log(audiModels[0]); 

const brakeParts = searchParts('brake');
console.log(brakeParts);
```

## Auto parts store integration
```js
import { searchParts } from 'auto-parts-db';

const parts = searchParts('absorber');
// Returns all parts containing 'absorber' in name or slug
```
## 🌐 Browser (CDN / Script tag)
```js
    <script src="https://cdn.jsdelivr.net/npm/auto-parts-db/dist/browser/auto-parts-db.min.js"></script>

    const brands = AutoPartsDB.getBrands();
    const parts = AutoPartsDB.searchParts('absorber');
    console.log(brands); 

```

All functions are available via the global `AutoPartsDB` object.

---

## 🤖 AI Integration

Four ways to put the database behind an AI agent. All of them are opt-in — the
core import stays dependency-free, and the SDKs below are **optional** peer
dependencies you only install if you use them.

### 1. MCP server

Expose the whole database to Claude Desktop, Claude Code, Cursor, or any other
MCP client. No API key, no per-call cost — every tool reads the bundled data.

```bash
npm install auto-parts-db @modelcontextprotocol/sdk
```

Add it to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "auto-parts-db": {
      "command": "npx",
      "args": ["-y", "auto-parts-mcp"]
    }
  }
}
```

Tools exposed: `list_car_brands`, `get_car_models`, `get_model_generations`,
`identify_vehicle`, `search_car_models`, `search_auto_parts`, `get_auto_part`,
`get_database_stats`.

To embed the server in your own process instead:

```js
import { createAutoPartsMcpServer } from 'auto-parts-db/mcp';

const server = await createAutoPartsMcpServer();
await server.connect(myTransport);
```

### 2. Claude tool definitions

Ready-made Anthropic tool schemas plus an executor, for dropping the database
into your own agent loop.

```js
import Anthropic from '@anthropic-ai/sdk';
import { autoPartsTools, executeAutoPartsTool } from 'auto-parts-db/ai';

const response = await new Anthropic().messages.create({
  model: 'claude-opus-5',
  max_tokens: 4096,
  tools: autoPartsTools,
  messages: [{ role: 'user', content: 'Which generation is a 2010 Audi A4?' }],
});

// Execute any tool Claude asks for — pure, synchronous, no network:
const result = executeAutoPartsTool('identify_vehicle', {
  brand: 'Audi', model: 'A4', year: 2010,
});
// → { found: true, generation: { name: 'B8 (Type 8K)', yearFrom: 2007, yearTo: 2015 } }
```

### 3. Natural-language search

`askVehicle()` runs the tool-use loop for you. Every fact in the answer comes
back through a tool call against the local data — nothing is answered from the
model's own memory.

```bash
npm install auto-parts-db @anthropic-ai/sdk
```

```js
import { askVehicle } from 'auto-parts-db/ai';

const { answer, toolCalls } = await askVehicle(
  'What brake parts would fit a 2010 Audi A4?',
  { apiKey: process.env.ANTHROPIC_API_KEY }   // or set ANTHROPIC_API_KEY
);

console.log(answer);
console.log(toolCalls); // every lookup made, for auditing
```

Options: `model` (default `claude-opus-5`), `effort`, `maxTokens`, `system`,
`maxIterations`, or `client` to supply your own configured SDK client.

### 4. Semantic parts search

Part **names are Russian** while **slugs are English**, so plain `searchParts()`
only matches when you guess the right language and wording. Embedding search
matches meaning across both.

Build the index once (needs an embedding provider — Anthropic's API does not
serve embeddings, so this uses a dedicated embedding model):

```bash
npm run build          # required first
VOYAGE_API_KEY=... npm run build:embeddings
```

Or point it at any OpenAI-compatible endpoint — Ollama, LM Studio,
text-embeddings-inference — with no third-party service at all:

```bash
EMBEDDINGS_URL=http://localhost:11434/v1/embeddings \
EMBEDDINGS_MODEL=nomic-embed-text \
npm run build:embeddings
```

Then search. The index is int8-quantized (~4x smaller than float32) and loaded
from disk, so only the query itself needs the provider:

```js
import { semanticSearchParts, loadEmbeddingIndex, voyageEmbeddings } from 'auto-parts-db/ai';
import index from 'auto-parts-db/embeddings.json' with { type: 'json' };

const results = await semanticSearchParts('worn out suspension damper', {
  index: loadEmbeddingIndex(index),
  embed: voyageEmbeddings({ apiKey: process.env.VOYAGE_API_KEY, inputType: 'query' }),
  limit: 5,
});
// → [{ part: { slug: 'front-shock-absorber', name: 'Амортизатор передний' }, score: 0.82 }, ...]
```

`embeddings.json` is **not shipped prebuilt** — it depends on which embedding
model you choose, and mixing models produces scores that look plausible and rank
badly. `loadEmbeddingIndex()` validates the index and `semanticSearchParts()`
rejects a query embedded with a different model, so a mismatch fails loudly
rather than silently degrading.

Any embedding backend works — `embed` is just
`(texts: string[]) => Promise<number[][]>`.

---
## 💡 Use Cases

*   **Car Catalogs**: Building filters by brand, model, and year
*   **Auto Parts E-commerce**: Creating compatible parts finder systems
*   **Automotive Portals**: Enriching content with structured data
*   **Mobile Applications**: For taxi services, car sharing, maintenance
*   **Analytics & Research**: Automotive market analysis
*   **AI Agents & Chatbots**: Grounding a model in real vehicle data via MCP
---

## 🧪 Tests

```bash
npm test
```

Covers the documented API surface and data integrity (unique slugs, ordered
generation year ranges, well-formed data), plus the AI tool registry, the
semantic-search index, the `askVehicle` tool loop against a mocked client, and
the MCP server driven end-to-end over a real stdio transport.

---

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Add missing car brands or models
- Extend parts catalog
- Improve data accuracy

---
