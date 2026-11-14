import { createHash, webcrypto } from "node:crypto";
import { Blob as NativeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { originalTransferPolicy, readOriginalDownload } from "./document-original";

const documentId="11111111-1111-4111-8111-111111111111",versionId="22222222-2222-4222-8222-222222222222";
function original(bytes:Uint8Array, changes:Record<string,string>={},body?:ReadableStream<Uint8Array>) {
  return new Response(body??new ReadableStream({start(c){c.enqueue(bytes.slice(0,3));c.enqueue(bytes.slice(3));c.close();}}),{headers:{
    "content-length":String(bytes.byteLength),"x-nexus-original-document":documentId,"x-nexus-original-version":versionId,
    "x-nexus-original-sha256":createHash("sha256").update(bytes).digest("hex"),
    "x-nexus-original-filename":encodeURIComponent("Synthetic r\u00e9sum\u00e9.csv"),...changes}});
}
describe("complete original-byte verification",()=>{
  beforeEach(()=>{vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("Blob",NativeBlob);});
  afterEach(()=>vi.unstubAllGlobals());
  it("preserves byte-order marks, Unicode and CRLF across fragmented transfer",async()=>{
    const bytes=new TextEncoder().encode("\uFEFFName,mass\r\n\u{1f4ca},1.005\r\n"),progress=vi.fn();
    const result=await readOriginalDownload(original(bytes),documentId,versionId,{onProgress:progress});
    expect(Array.from(new Uint8Array(await result.blob.arrayBuffer()))).toEqual(Array.from(bytes));
    expect(result.filename).toBe("Synthetic r\u00e9sum\u00e9.csv");expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(progress).toHaveBeenLastCalledWith(bytes.length,bytes.length);
  });
  it("does not apply the Worker ingestion limit to an existing larger original",async()=>{
    const bytes=new Uint8Array(10_000_001);bytes[bytes.length-1]=7;
    const result=await readOriginalDownload(original(bytes),documentId,versionId);
    expect(result.size).toBe(10_000_001);expect(result.blob.size).toBe(bytes.length);
    expect(originalTransferPolicy.maximum_bytes).toBe(500*1024*1024);
  });
  it("rejects an incomplete or overlong transfer instead of returning a downloadable blob",async()=>{
    const bytes=new Uint8Array([1,2,3]);
    await expect(readOriginalDownload(original(bytes,{"content-length":"4"}),documentId,versionId)).rejects.toThrow("ended before verification");
    await expect(readOriginalDownload(original(bytes,{"content-length":"2"}),documentId,versionId)).rejects.toThrow("exceeded its declared length");
  });
  it("reports an original-byte mismatch and retains no verified result",async()=>{
    await expect(readOriginalDownload(original(new Uint8Array([1]),{"x-nexus-original-sha256":"a".repeat(64)}),documentId,versionId)).rejects.toThrow("does not match its recorded SHA256");
  });
  it("cancels a pending transfer rather than accepting its empty completion",async()=>{
    let cancelled=false;const controller=new AbortController();
    const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
    const result=readOriginalDownload(original(new Uint8Array([1]),{},body),documentId,versionId,{signal:controller.signal});
    controller.abort();await expect(result).rejects.toMatchObject({name:"AbortError"});expect(cancelled).toBe(true);
  });
  it("requires the expected current version receipt and a bounded byte count",async()=>{
    const bytes=new Uint8Array([1]);
    const cases:Record<string,string>[]=[{"x-nexus-original-version":"different"},{"content-length":String(originalTransferPolicy.maximum_bytes+1)},{"content-length":"unknown"}];
    for(const changes of cases)
      await expect(readOriginalDownload(original(bytes,changes),documentId,versionId)).rejects.toThrow("receipt is unavailable or changed");
  });
});
