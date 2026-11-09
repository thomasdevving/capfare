import { NextResponse, type NextRequest } from "next/server";
import { inbox } from "@/lib/booker/store";
export const dynamic = "force-dynamic";
export function GET(req: NextRequest) {
  const e = req.nextUrl.searchParams.get("email") ?? "";
  return NextResponse.json(inbox(e));
}
