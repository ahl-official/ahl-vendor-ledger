import { NextResponse } from "next/server";
import { uploadToDrive } from "@/lib/drive";
import { withErrors } from "@/lib/api";

// Vercel rejects request bodies over 4.5 MB, so cap just under that.
const MAX_BYTES = 4 * 1024 * 1024;

export const POST = withErrors(async (req: Request) => {
  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file received" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is too large (max 4 MB)" }, { status: 400 });
  if (file.type !== "application/pdf" && !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only PDF or image files are allowed" }, { status: 400 });
  }
  const safeName = file.name.replace(/[^\w.\- ]/g, "_");
  const url = await uploadToDrive(`${Date.now()}-${safeName}`, file.type, Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ url });
});
