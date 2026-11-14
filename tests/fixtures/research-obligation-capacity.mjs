// Lawful synthetic maximum-field data, shared by real executor/storage/client tests.
import {createHash} from "node:crypto";
const id=(prefix,index)=>`${prefix}-0000-4000-8100-${String(index).padStart(12,"0")}`;
export function obligationWire(candidates,sources) {
  const anchors=[],texts=[],anchorIds=new Map(),textIds=new Map();
  const anchor=value=>{
    if(value===null)return null;
    const source=sources.find(row=>row.citation_id===value.citation_id),offset=source.content.indexOf(value.quote);
    if(offset<0)throw Error("Fixture quote is not in its source");
    const start=Array.from(source.content.slice(0,offset)).length,span=[value.citation_id,start,start+Array.from(value.quote).length],key=JSON.stringify(span);
    if(!anchorIds.has(key)){anchorIds.set(key,anchors.length);anchors.push(span);}
    return anchorIds.get(key);
  };
  const text=value=>{if(!textIds.has(value)){textIds.set(value,texts.length);texts.push(value);}return textIds.get(value);};
  return {schema_version:"research-obligation-wire/1",anchors,texts,candidates:candidates.map(candidate=>({
    provision:anchor(candidate.provision),...Object.fromEntries(["authority","jurisdiction","actor","action","applicability","deadline","valid_from","valid_to"].map(field=>[field,anchor(candidate[field])])),
    ...Object.fromEntries(["definitions","exceptions","amendments","supersedes"].map(field=>[field,candidate[field].map(anchor)])),
    control_candidate:text(candidate.control_candidate),limitations:candidate.limitations.map(text)}))};
}
export function obligationCapacity() {
  const documents=Array.from({length:50},(_,i)=>({id:id("d0444400",i+1),filename:`Synthetic capacity policy ${i+1}.txt`}));
  const originals=documents.map((document,i)=>{
    const prefix=`Synthetic capacity clause ${i+1}. `,room=32768-Buffer.byteLength(prefix);
    const original=prefix+"\u{1f4ca}".repeat(Math.floor(room/4))+"x".repeat(room%4);
    return {id:id("f0444400",i+1),document_id:document.id,version_id:id("e0444400",i+1),original_text:original,
      original_content_hash:createHash("sha256").update(original).digest("hex"),page_number:[null,0,2][i%3],chunk_index:0,location:{char_start:0,char_end:Array.from(original).length}};
  });
  const sources=originals.map((row,i)=>({document_id:row.document_id,version_id:row.version_id,original_content_hash:row.original_content_hash,
    page_number:row.page_number,chunk_index:row.chunk_index,location:row.location,citation_id:`S${i+1}`,filename:documents[i].filename,chunk_id:row.id,
    content:Array.from(row.original_text).slice(0,1200).join(""),excerpt:true}));
  const anchor=i=>({citation_id:sources[i%50].citation_id,quote:Array.from(sources[i%50].content).slice(0,300).join("")});
  const candidates=Array.from({length:12},(_,i)=>({provision:anchor(i),...Object.fromEntries(
    ["authority","jurisdiction","actor","action","applicability","deadline","valid_from","valid_to"].map((field,j)=>[field,anchor(i*31+j+1)])),
    ...Object.fromEntries(["definitions","exceptions","amendments","supersedes"].map((field,j)=>[field,Array.from({length:4},(_,k)=>anchor(i*31+9+j*4+k))])),
    control_candidate:"\u{1f4ca}".repeat(240),limitations:Array(4).fill("\u{1f4ca}".repeat(240))}));
  const question="Synthetic maximum-field obligation review "+"q".repeat(9960);
  // Keep all eleven questions within the existing aggregate96KB plan envelope.
  const questions=Array.from({length:11},(_,i)=>`${i} ${question}`.slice(0,i?8000:10000));
  return {documents,originals,sources,candidates,run:{mode:"OBLIGATION_ANALYSIS",questions,position:0,
    source_snapshot:originals.map(row=>({document_id:row.document_id,version_id:row.version_id,index_generation:"synthetic-capacity",lifecycle_epoch:1}))}};
}
