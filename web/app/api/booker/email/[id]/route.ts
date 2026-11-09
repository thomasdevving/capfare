import { NextResponse, type NextRequest } from "next/server";
import { emailById } from "@/lib/booker/store";
export const dynamic = "force-dynamic";
/** Download an email from the demo inbox as an original .eml file. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = emailById(id);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(m.raw, {
    headers: { "content-type": "message/rfc822", "content-disposition": `attachment; filename="skyline-${m.ref}.eml"` },
  });
}
