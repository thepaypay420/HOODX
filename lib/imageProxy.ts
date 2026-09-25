const MAX_IMAGE_BYTES = 2_000_000;

export function approvedImageUrl(raw: string) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(host === "cdn.robinhood.com" || host === "cdn.dexscreener.com" || host.endsWith(".dexscreener.com"))) throw new Error("Unapproved image host");
  return url;
}

export async function readBoundedImage(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES || !response.body) throw new Error("Image too large");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("Image too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
