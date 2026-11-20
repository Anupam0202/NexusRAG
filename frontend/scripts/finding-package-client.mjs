import {build} from "esbuild";
import {fileURLToPath} from "node:url";

// Use the actual browser module on supported Node22/24 verification hosts.
// Bundling resolves its JSON contract without requiring native TS loading.
export async function findingPackageClient(){
  const {outputFiles}=await build({entryPoints:[fileURLToPath(new URL("../src/lib/finding-package.ts",import.meta.url))],
    bundle:true,format:"esm",platform:"node",write:false,logLevel:"silent"});
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
