import { readFileSync } from "fs";
import { join } from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const filePath = join(process.cwd(), "data", "live.json");
  const data = readFileSync(filePath, "utf-8");
  return new NextResponse(data, {
    headers: { "Content-Type": "application/json" },
  });
}
