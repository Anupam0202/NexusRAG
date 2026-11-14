import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inlineScripts, scriptHash, scriptSource } from "./script-policy";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");

// The shape of a page Next.js renders: external chunks, a bootstrap script with an id, and inline payload scripts.
const page = [
  "<!DOCTYPE html><html><head>",
  '<script src="/_next/static/chunks/a.js" async=""></script>',
  '<script id="_R_">(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":[]})</script>',
  "</head><body><noscript>Enable JavaScript</noscript>",
  "<script>(self.__next_f=self.__next_f||[]).push([0])</script>",
  '<script>self.__next_f.push([1,"0:\\"$Sreact.fragment\\"\\n"])</script>',
  "</body></html>",
].join("");

describe("page script policy (NX-28)", () => {
  it("finds the text of every script without a src, in order", () => {
    expect(inlineScripts(page)).toEqual([
      '(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push({"otherChunks":[]})',
      "(self.__next_f=self.__next_f||[]).push([0])",
      'self.__next_f.push([1,"0:\\"$Sreact.fragment\\"\\n"])',
    ]);
  });

  it("reads attributes exactly: data-src is not src, a quoted > does not end the tag, and case does not matter", () => {
    const html = [
      '<SCRIPT SRC="/x.js"></SCRIPT>',
      '<script async src = "/y.js"></script>',
      '<script data-src="/z.js">first()</script>',
      '<script data-note="a>b">second()</script >',
      "<script\ttype=\"module\">third()</script\n>",
      "<scripts>not a script</scripts>",
    ].join("");
    expect(inlineScripts(html)).toEqual(["first()", "second()", "third()"]);
  });

  it("hashes a script's UTF-8 text as browsers do", async () => {
    for (const text of ["", "self.__next_f.push([0])", "caf\u00e9 \u2713 \u{1F600}\r\n"]) {
      expect(await scriptHash(text)).toBe(sha256(text));
    }
  });

  it("allows the app's own origin and each inline script once", async () => {
    const twice = `${page}<script>(self.__next_f=self.__next_f||[]).push([0])</script>`;
    const expected = inlineScripts(page).map((text) => `'sha256-${sha256(text)}'`);
    expect(await scriptSource(twice)).toBe(["script-src 'self'", ...expected].join(" "));
    expect(await scriptSource("<html><body>No scripts</body></html>")).toBe("script-src 'self'");
  });
});
