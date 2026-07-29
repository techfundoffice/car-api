#!/usr/bin/env node
/**
 * Entry point for `npx auto-parts-mcp`.
 *
 * stdio is the MCP transport itself, so nothing may be written to stdout —
 * diagnostics go to stderr, which clients surface as server logs.
 */

import { startAutoPartsMcpServer } from "./server";

startAutoPartsMcpServer().then(
  () => {
    process.stderr.write("auto-parts-db MCP server listening on stdio\n");
  },
  (err: unknown) => {
    process.stderr.write(
      `auto-parts-db MCP server failed to start: ${
        err instanceof Error ? err.message : String(err)
      }\n`
    );
    process.exit(1);
  }
);
