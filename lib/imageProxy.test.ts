import { describe, expect, it } from "vitest";
import { approvedImageUrl, readBoundedImage } from "./imageProxy";

describe("holding image proxy", () => {
  it("accepts only HTTPS vendor image hosts", () => {
    expect(approvedImageUrl("https://cdn.dexscreener.com/cms/images/a.png").hostname).toBe("cdn.dexscreener.com");
    expect(approvedImageUrl("https://cdn.robinhood.com/token.png").hostname).toBe("cdn.robinhood.com");
    for (const value of ["http://cdn.dexscreener.com/a.png","https://dexscreener.com.evil.test/a.png","https://127.0.0.1/a.png","https://user@cdn.dexscreener.com/a.png"]) {
      expect(() => approvedImageUrl(value)).toThrow();
    }
  });

  it("rejects oversized declared and streamed bodies", async () => {
    await expect(readBoundedImage(new Response(new Uint8Array(1),{headers:{"content-length":"2000001"}}))).rejects.toThrow(/large/);
    const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(1_500_000));controller.enqueue(new Uint8Array(600_000));controller.close();}});
    await expect(readBoundedImage(new Response(body))).rejects.toThrow(/large/);
  });

  it("returns a bounded byte array for valid images", async () => {
    const bytes=await readBoundedImage(new Response(new Uint8Array([1,2,3])));
    expect([...bytes]).toEqual([1,2,3]);
  });
});
