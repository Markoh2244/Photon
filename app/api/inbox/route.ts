import { NextResponse } from "next/server";
import { getInbox, resolveInboxItem, seedInbox } from "@/lib/inbox";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const shouldSeed = url.searchParams.get("seed") === "1";
    const inbox = shouldSeed ? await seedInbox(false) : await getInbox();
    if (!inbox.seededAt || inbox.counts.orders + inbox.counts.refills === 0) {
      return NextResponse.json(await seedInbox(true));
    }
    return NextResponse.json(inbox);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Inbox failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.action === "seed") {
      return NextResponse.json(await seedInbox(Boolean(body.force)));
    }
    if (body.action === "resolve") {
      if (!body.id) {
        return NextResponse.json({ error: "id required" }, { status: 400 });
      }
      const inbox = await resolveInboxItem({
        id: String(body.id),
        action: body.resolveAction === "dismiss" ? "dismiss" : "accept",
        actionId: body.actionId ? String(body.actionId) : undefined,
        note: body.note ? String(body.note) : undefined,
      });
      return NextResponse.json(inbox);
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Inbox update failed" },
      { status: 500 },
    );
  }
}
