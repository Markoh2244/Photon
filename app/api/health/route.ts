import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.PHOTON_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({
      ok: false,
      reason: "missing_token",
      message: "PHOTON_ACCESS_TOKEN is not set in .env.local",
    });
  }

  try {
    const [, payload] = token.split(".");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(padded, "base64url").toString("utf8")) as {
      exp?: number;
      org_id?: string;
    };
    const exp = claims.exp || 0;
    const secondsLeft = exp - Math.floor(Date.now() / 1000);
    if (secondsLeft <= 0) {
      return NextResponse.json({
        ok: false,
        reason: "expired_token",
        message:
          "PHOTON_ACCESS_TOKEN is expired. Paste a fresh user token from app.neutron.health (Network tab or Developers settings).",
        expiresAt: new Date(exp * 1000).toISOString(),
      });
    }

    const response = await fetch("https://api.neutron.health/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: "{ patients { id } }" }),
      cache: "no-store",
    });
    const json = (await response.json()) as {
      data?: { patients?: { id: string }[] };
      errors?: { message: string }[];
    };
    if (!response.ok || json.errors?.length) {
      return NextResponse.json({
        ok: false,
        reason: "api_error",
        message: json.errors?.map((e) => e.message).join("; ") || `HTTP ${response.status}`,
        secondsLeft,
      });
    }

    return NextResponse.json({
      ok: true,
      patientCount: json.data?.patients?.length || 0,
      secondsLeft,
      expiresAt: new Date(exp * 1000).toISOString(),
      openai: Boolean(process.env.OPENAI_API_KEY),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : "Health check failed",
    });
  }
}
