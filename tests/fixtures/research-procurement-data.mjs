import {createHash} from "node:crypto";
import {procurementFields} from "../../apps/gateway/src/research-procurement.js";

const fit=(prefix,length,fill="\u{1f600}")=>Array.from(prefix+fill.repeat(length)).slice(0,length).join("");
export function procurementCapacity() {
  const documents=Array.from({length:50},(_,i)=>({id:`ff606000-0000-4000-8100-${String(i+1).padStart(12,"0")}`,filename:`Synthetic procurement ${i+1}.txt`,content_type:"text/plain"}));
  const originals=documents.map((document,i)=>{
    const prefix=fit(`Notice N-${i+1}; Buyer${i+1}; lot L-${i+1}; supplier Example${i+1}; value USD 9007199254740993.25; closing 2026-12-01T12:00:00Z is subject to independent review. `,1200);
    const text=prefix+"x".repeat(32768-Buffer.byteLength(prefix));
    return {id:`ff606100-0000-4000-8100-${String(i+1).padStart(12,"0")}`,document_id:document.id,version_id:`ff606200-0000-4000-8100-${String(i+1).padStart(12,"0")}`,
      original_text:text,original_content_hash:createHash("sha256").update(text).digest("hex"),page_number:i===0?null:i===1?0:2,chunk_index:0,location:{char_start:0,char_end:Array.from(text).length}};
  });
  const sources=originals.map((row,i)=>({citation_id:`S${i+1}`,document_id:row.document_id,version_id:row.version_id,chunk_id:row.id,filename:documents[i].filename,
    content:Array.from(row.original_text).slice(0,1200).join(""),original_content_hash:row.original_content_hash,page_number:row.page_number,chunk_index:0,location:row.location}));
  const run={mode:"PROCUREMENT_RESEARCH",position:0,questions:Array.from({length:11},(_,i)=>fit(`Criterion${i+1} Synthetic procurement notice review `,5500,"x")),
    source_snapshot:originals.map(row=>({document_id:row.document_id,version_id:row.version_id,index_generation:"synthetic-capacity",lifecycle_epoch:1}))};
  return {documents,originals,sources,run};
}
export function procurementWire(sources) {
  const wire={schema_version:"research-procurement-wire/1",anchors:[],texts:[],records:[],gaps:[]};
  for(let i=0;i<12;i++) {
    const source=sources[i===11?sources.length-1:i],fields={};
    for(const key of procurementFields){fields[key]=wire.anchors.length;wire.anchors.push([source.citation_id,0,300]);}
    const limitations=Array.from({length:4},(_,j)=>{wire.texts.push(fit(`Review qualification ${i}/${j}: `,240));return wire.texts.length-1;});
    wire.records.push({kind:"TENDER",fields,limitations});wire.texts.push(fit(`Follow-up gap ${i}: `,240));
    wire.gaps.push({document_id:source.document_id,description:wire.texts.length-1});
  }
  return wire;
}
