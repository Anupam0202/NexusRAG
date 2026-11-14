import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import jsonld from "jsonld";
import {findingPackageClient} from "./finding-package-client.mjs";
const {findingPackageDownload,confirmedFindingPackage}=await findingPackageClient();

// Input is the real disposable SQL result, never a hosted/customer export.
const value=JSON.parse(await readFile(process.argv[2],"utf8"));
assert.ok(await confirmedFindingPackage(value,value.finding_id,value.workspace_id));
const downloaded=JSON.parse(findingPackageDownload(value));
const options={safe:true,documentLoader:async()=>{throw Error("Inline package contexts must not fetch remote documents");}};
const expanded=await jsonld.expand(downloaded,options);
assert.equal(expanded.length,1);
assert.equal(expanded[0]["@id"],`urn:nexusrag:export:${value.id}`);
const manifest=expanded[0]["https://nexusrag.app/ns/manifest"][0];
assert.equal(manifest["@id"],`urn:nexusrag:finding:${value.finding_id}:${value.finding_revision}`);
assert.deepEqual(manifest["@type"],["http://www.w3.org/ns/prov#Entity"]);
assert.equal(manifest["https://nexusrag.app/ns/analysis"][0]["@type"],"@json");
const analysis=manifest["https://nexusrag.app/ns/analysis"][0]["@value"];
if(value.manifest_bytes>30000000){
  assert.equal(analysis.deep.phase,"SYNTHESIS");assert.equal(analysis.sources.length,156);
  assert.equal(manifest["https://nexusrag.app/ns/evidence"][0]["@value"].length,156);
}else assert.equal(analysis.answer,"Synthetic mass is 1.005 kg [S1].");
assert.ok(manifest["http://www.w3.org/ns/prov#wasDerivedFrom"][0]["@id"].startsWith("urn:nexusrag:version:"));
assert.equal(manifest["@included"].filter(row=>row["@type"].includes("http://www.w3.org/ns/prov#Activity")).length,1);
const rdf=await jsonld.toRDF(downloaded,{...options,format:"application/n-quads"});
assert.ok(rdf.includes("<http://www.w3.org/ns/prov#wasGeneratedBy>"));
assert.ok(rdf.includes("<http://www.w3.org/ns/prov#used>"));
console.log("FINDING_PACKAGE_JSONLD_PASS: actual SQL manifest/exact bytes/inline JSON literals/PROV Entity-Activity lineage; no remote context or hosted content");
