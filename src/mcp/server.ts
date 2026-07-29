/**
 * Model Context Protocol server exposing the vehicle and parts database.
 *
 * Any MCP client (Claude Desktop, Claude Code, Cursor, a custom agent) can
 * connect and query 142 brands, 2379 models with generations, and 1530 parts —
 * with no API key and no per-call cost, since every tool reads bundled data.
 *
 * Run it with `npx auto-parts-mcp`, or embed it via `createAutoPartsMcpServer()`.
 *
 * The MCP SDK is an optional peer dependency loaded at call time, so importing
 * the core database never pulls it in.
 */

import { autoPartsToolRegistry, executeAutoPartsTool } from "../ai/tools";

/**
 * Specifiers are held in variables so the TypeScript compiler does not try to
 * resolve an optional peer dependency at build time. They are ordinary module
 * paths — nothing is dynamic about them at runtime.
 */
const SERVER_MODULE = "@modelcontextprotocol/sdk/server/index.js";
const STDIO_MODULE = "@modelcontextprotocol/sdk/server/stdio.js";
const TYPES_MODULE = "@modelcontextprotocol/sdk/types.js";

export type McpServerOptions = {
  /** Server name reported to the client. Defaults to "auto-parts-db". */
  name?: string;
  /** Server version reported to the client. Defaults to the package version. */
  version?: string;
};

async function loadMcpSdk(): Promise<{
  Server: any;
  StdioServerTransport: any;
  ListToolsRequestSchema: any;
  CallToolRequestSchema: any;
}> {
  try {
    const [serverModule, stdioModule, typesModule] = await Promise.all([
      import(SERVER_MODULE),
      import(STDIO_MODULE),
      import(TYPES_MODULE),
    ]);
    return {
      Server: (serverModule as any).Server,
      StdioServerTransport: (stdioModule as any).StdioServerTransport,
      ListToolsRequestSchema: (typesModule as any).ListToolsRequestSchema,
      CallToolRequestSchema: (typesModule as any).CallToolRequestSchema,
    };
  } catch (err) {
    throw new Error(
      "The MCP server needs '@modelcontextprotocol/sdk'. Install it with 'npm install @modelcontextprotocol/sdk'. " +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Build an MCP server with every database tool registered, ready to connect to
 * a transport of your choosing.
 *
 * @example
 * const server = await createAutoPartsMcpServer();
 * await server.connect(myTransport);
 */
export async function createAutoPartsMcpServer(
  options: McpServerOptions = {}
): Promise<any> {
  const { name = "auto-parts-db", version = "2.1.0" } = options;
  const {
    Server,
    ListToolsRequestSchema,
    CallToolRequestSchema,
  } = await loadMcpSdk();

  const server = new Server({ name, version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: autoPartsToolRegistry.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const { name: toolName, arguments: args } = request.params;
    const result = executeAutoPartsTool(toolName, args ?? {});
    const failed =
      typeof result === "object" && result !== null && "error" in (result as any);

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: failed,
    };
  });

  return server;
}

/**
 * Start the server on stdio — the transport MCP clients launch subprocesses
 * with. Resolves once connected; the process then stays alive serving requests.
 */
export async function startAutoPartsMcpServer(
  options: McpServerOptions = {}
): Promise<any> {
  const [server, { StdioServerTransport }] = await Promise.all([
    createAutoPartsMcpServer(options),
    loadMcpSdk(),
  ]);
  await server.connect(new StdioServerTransport());
  return server;
}
