import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { documents, uploads } from "@/db/schema";
import { chunkText, deriveKeywords, normalizeWhitespace } from "@/lib/chunk";
import { embedTexts } from "@/lib/embeddings";
import { redactPII } from "@/lib/redact";
import { desc, eq, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

/** List uploaded knowledge files + corpus stats */
export async function GET() {
  const files = await db.select().from(uploads).orderBy(desc(uploads.createdAt)).limit(50);
  const [{ count: builtinCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(eq(documents.source, "builtin"));
  const [{ count: uploadedCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(eq(documents.source, "upload"));

  return NextResponse.json({
    uploads: files,
    corpus: {
      builtinChunks: Number(builtinCount || 0),
      uploadedChunks: Number(uploadedCount || 0),
    },
  });
}

/** Ingest a PDF / TXT / MD file: parse -> chunk -> embed -> index */
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file supplied" }, { status: 400 });
    }

    const blob = file as File;
    if (blob.size > MAX_BYTES) {
      return NextResponse.json({ error: `File exceeds the ${MAX_BYTES / 1024 / 1024}MB limit` }, { status: 413 });
    }

    const name = blob.name || "document";
    const lower = name.toLowerCase();
    const isPdf = lower.endsWith(".pdf") || blob.type === "application/pdf";
    const isText = lower.endsWith(".txt") || lower.endsWith(".md") || blob.type.startsWith("text/");

    if (!isPdf && !isText) {
      return NextResponse.json({ error: "Only PDF, TXT and MD files are supported" }, { status: 415 });
    }

    const uploadId = `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const buffer = Buffer.from(await blob.arrayBuffer());

    // ---------- Parse ----------
    const parseStart = Date.now();
    let pages: string[] = [];

    if (isPdf) {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const result = await extractText(pdf, { mergePages: false });
      const raw = result.text;
      pages = Array.isArray(raw) ? raw : [String(raw)];
    } else {
      pages = [buffer.toString("utf-8")];
    }

    const parseMs = Date.now() - parseStart;
    const fullText = normalizeWhitespace(pages.join("\n\n"));

    if (!fullText || fullText.replace(/\s/g, "").length < 40) {
      await db.insert(uploads).values({
        id: uploadId,
        filename: name,
        mimeType: blob.type || (isPdf ? "application/pdf" : "text/plain"),
        byteSize: blob.size,
        pageCount: pages.length,
        chunkCount: 0,
        charCount: fullText.length,
        status: "failed",
        errorMessage: "No extractable text found (the PDF may be a scanned image requiring OCR).",
        parseMs,
      });
      return NextResponse.json(
        { error: "No extractable text found. This looks like a scanned/image-only PDF — OCR is required." },
        { status: 422 }
      );
    }

    // ---------- Chunk (page-aware) ----------
    const allChunks: Array<{ content: string; index: number; pageNumber?: number; tokenCount: number }> = [];
    let runningIndex = 0;
    pages.forEach((pageText, pageIdx) => {
      const pageChunks = chunkText(pageText, {
        maxChars: 1200,
        overlapChars: 180,
        pageNumber: isPdf ? pageIdx + 1 : undefined,
        startIndex: runningIndex,
      });
      runningIndex += pageChunks.length;
      allChunks.push(...pageChunks);
    });

    if (!allChunks.length) {
      return NextResponse.json({ error: "Document produced no usable chunks" }, { status: 422 });
    }

    // Cap very large documents so ingestion stays responsive
    const chunks = allChunks.slice(0, 400);

    // ---------- Embed ----------
    const embedStart = Date.now();
    const embedded = await embedTexts(chunks.map((c) => c.content));
    const embedMs = Date.now() - embedStart;

    const baseTitle = name.replace(/\.(pdf|txt|md)$/i, "");

    await db.insert(uploads).values({
      id: uploadId,
      filename: name,
      mimeType: blob.type || (isPdf ? "application/pdf" : "text/plain"),
      byteSize: blob.size,
      pageCount: isPdf ? pages.length : 1,
      chunkCount: chunks.length,
      charCount: fullText.length,
      status: "ready",
      parseMs,
      embedMs,
      embeddingModel: embedded.model,
    });

    // ---------- Index chunks (PII-redacted before storage) ----------
    const rows = chunks.map((c, i) => ({
      title: `${baseTitle}${c.pageNumber ? ` — p.${c.pageNumber}` : ""} (chunk ${c.index + 1})`,
      category: "Uploaded Document",
      content: redactPII(c.content),
      keywords: deriveKeywords(c.content),
      source: "upload",
      uploadId,
      chunkIndex: c.index,
      pageNumber: c.pageNumber ?? null,
      tokenCount: c.tokenCount,
      embedding: embedded.vectors[i],
      embeddingModel: embedded.model,
    }));

    // batched insert to stay within parameter limits
    for (let i = 0; i < rows.length; i += 25) {
      await db.insert(documents).values(rows.slice(i, i + 25));
    }

    return NextResponse.json({
      success: true,
      upload: {
        id: uploadId,
        filename: name,
        pageCount: isPdf ? pages.length : 1,
        chunkCount: chunks.length,
        charCount: fullText.length,
        embeddingModel: embedded.model,
        embeddingProvider: embedded.provider,
        parseMs,
        embedMs,
        totalMs: Date.now() - started,
        truncated: allChunks.length > chunks.length,
      },
      preview: fullText.slice(0, 400),
    });
  } catch (err: any) {
    console.error("Upload ingestion error:", err);
    return NextResponse.json({ error: err?.message || "Failed to ingest document" }, { status: 500 });
  }
}

/** Remove an uploaded file and all of its indexed chunks */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    await db.delete(documents).where(eq(documents.uploadId, id));
    await db.delete(uploads).where(eq(uploads.id, id));

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
