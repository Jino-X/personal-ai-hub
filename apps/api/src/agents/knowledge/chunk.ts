/**
 * Splits text into overlapping, paragraph-aware chunks for embedding.
 * ~1,200 characters (~300 tokens) per chunk keeps retrieval precise on small local models.
 */
export function chunkText(text: string, { size = 1200, overlap = 150, maxChunks = 200 } = {}): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const paragraphs = clean.split(/\n\n+/);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= size) {
      pieces.push(p);
      continue;
    }
    // Long paragraph: split on sentence boundaries, then hard-wrap as a last resort.
    const sentences = p.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [p];
    let buf = "";
    for (const s of sentences) {
      if ((buf + s).length > size && buf) {
        pieces.push(buf.trim());
        buf = "";
      }
      if (s.length > size) {
        for (let i = 0; i < s.length; i += size) pieces.push(s.slice(i, i + size));
      } else buf += s;
    }
    if (buf.trim()) pieces.push(buf.trim());
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > size) {
      chunks.push(current);
      if (chunks.length >= maxChunks) return chunks;
      const tail = current.slice(-overlap);
      const boundary = tail.indexOf(" ");
      current = `${boundary > 0 ? tail.slice(boundary + 1) : tail}\n\n${piece}`;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.slice(0, maxChunks);
}

/** Rough token estimate (≈4 chars/token for English). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
