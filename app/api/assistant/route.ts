import { NextResponse } from "next/server";
import { runAssistant, type ChatMessage } from "@/lib/mcp/agent";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const messages = (body.messages || []) as ChatMessage[];
    const patientId = body.patientId ? String(body.patientId) : undefined;
    if (!messages.length) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }
    const result = await runAssistant({ messages, patientId });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
