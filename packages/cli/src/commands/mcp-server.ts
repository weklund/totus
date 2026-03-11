/**
 * MCP Server command: start the MCP server in stdio mode.
 *
 * This command is invoked by AI clients (Claude Desktop, Claude Code, Cursor, VS Code).
 * It blocks and communicates via stdin/stdout using JSON-RPC (MCP protocol).
 *
 * CRITICAL: Never use console.log() — it corrupts the stdio JSON-RPC channel.
 *
 * See: LLD Section 8.5.17
 */

import { Command } from "@commander-js/extra-typings";
import { startMcpServer } from "../mcp-server.js";

export function createMcpServerCommand(): Command {
  const mcpServer = new Command("mcp-server")
    .description(
      "Start the MCP Server (stdio transport) for AI clients like Claude Desktop, Cursor, and VS Code",
    )
    .action(async () => {
      await startMcpServer();
    });

  return mcpServer;
}
