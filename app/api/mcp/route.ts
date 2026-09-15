import { NextResponse } from "next/server";
import { callMcpTool, listMcpTools } from "@/lib/mcp/tools";

/**
 * Minimal MCP JSON-RPC surface for this app:
 *   tools/list  — discover Photon tools
 *   tools/call  — execute one tool by name
 *
 * Same conceptual protocol as Photon's hosted MCP at ai.neutron.health.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id = 1, method, params } = body || {};

    if (method === "tools/list") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: { tools: listMcpTools() },
      });
    }

    if (method === "tools/call") {
      const name = params?.name as string;
      const args = (params?.arguments || {}) as Record<string, unknown>;
      if (!name) {
        return NextResponse.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "params.name is required" },
        });
      }
      const result = await callMcpTool(name, args);
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: result.content,
          isError: result.isError || false,
          structuredContent: result.structured,
        },
      });
    }

    if (method === "initialize") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "dermclose-photon-mcp", version: "0.1.0" },
          capabilities: { tools: {} },
        },
      });
    }

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (error) {
    return NextResponse.json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Internal error",
      },
    });
  }
}

export async function GET() {
  return NextResponse.json({
    name: "dermclose-photon-mcp",
    transport: "JSON-RPC over HTTP POST",
    methods: ["initialize", "tools/list", "tools/call"],
    tools: listMcpTools().map((t) => t.name),
    note: "Photon's hosted MCP is https://ai.neutron.health (OAuth). This local endpoint mirrors tools/list + tools/call over your PHOTON_ACCESS_TOKEN.",
  });
}
