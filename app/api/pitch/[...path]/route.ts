import { NextRequest } from "next/server";

const BASE = "https://api.pitchapi.dev/v1";
const SEGMENT = /^[A-Za-z0-9_\-]+$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  if (!path.every((s) => SEGMENT.test(s))) {
    return Response.json(
      { error: { code: "INVALID_PARAMETER" } },
      { status: 400 },
    );
  }

  const target = `${BASE}/${path.join("/")}${req.nextUrl.search}`;

  // Retry on 429 (honouring Retry-After) and 5xx
  let res: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch(target, {
      headers: { "X-API-KEY": process.env.PITCHAPI_KEY! },
      cache: "no-store",
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After") ?? 2);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    break;
  }

  return new Response(await res!.text(), {
    status: res!.status,
    headers: { "Content-Type": "application/json" },
  });
}
