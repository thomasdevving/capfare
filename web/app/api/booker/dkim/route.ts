import { NextResponse } from "next/server";
import { BOOKER_DOMAIN, BOOKER_SELECTOR, dkimRecord } from "@/lib/booker/store";
export const dynamic = "force-dynamic";
/** Demo stand-in for the DNS TXT record skyline._domainkey.skyline-travel.example (.example domains have no real DNS). */
export function GET() {
  return NextResponse.json({ domain: BOOKER_DOMAIN, selector: BOOKER_SELECTOR, record: dkimRecord() });
}
