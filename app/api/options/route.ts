import { NextResponse } from "next/server";
import { getOptionLists } from "@/lib/options";
import { withErrors } from "@/lib/api";

export const GET = withErrors(async () => {
  return NextResponse.json(await getOptionLists());
});
