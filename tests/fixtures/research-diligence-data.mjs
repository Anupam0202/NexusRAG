import assert from "node:assert/strict";
import {createHash} from "node:crypto";

export function diligenceData(capacity=false) {
  const documents=[],originals=[];
  for(let i=1;i<=60;i++) {
    const tail=String(i).padStart(12,"0"),prefix=capacity?"5252":"0052";
    const id=`d052${prefix}-0000-4000-8100-${tail}`,version_id=`e052${prefix}-0000-4000-8100-${tail}`;
    const header=`\u{1F4CA} Example Works ${i} (EX-${i}). The filing states Example Works ${i} is owned by Example Holdings ${i} from 2025-01-01, subject to later amendments.`;
    const room=32768-Buffer.byteLength(header),original_text=header+(capacity?"\u{1F4CA}".repeat(Math.floor(room/4))+"x".repeat(room%4):".".repeat(room));
    documents.push({id,filename:`Synthetic ${capacity?"capacity diligence":"diligence"} ${i}.txt`});
    const page_number=i===1?null:i===2?0:2;
    originals.push({id:i===1?`0000${prefix}-0000-4000-8100-000000000000`:`f052${prefix}-0000-4000-8100-${tail}`,
      document_id:id,version_id,chunk_index:0,original_text,original_content_hash:createHash("sha256").update(original_text).digest("hex"),
      page_number,location:page_number===null||page_number===0?{char_start:0,char_end:Array.from(original_text).length}:{page:page_number}});
  }
  const targets=Array.from({length:100},(_,i)=>`Synthetic review subject ${i+1}`.padEnd(capacity?128:30,"x"));
  const questions=Array.from({length:13},(_,i)=>`${i} Synthetic due diligence criterion requiring qualified review.`.padEnd(capacity?(i?5500:10000):100,"q"));
  const sources=originals.map((row,i)=>({document_id:row.document_id,version_id:row.version_id,chunk_id:row.id,citation_id:`S${i+1}`,
    filename:documents[i].filename,content:Array.from(row.original_text).slice(0,1200).join(""),original_content_hash:row.original_content_hash,
    page_number:row.page_number,chunk_index:row.chunk_index,location:row.location,excerpt:true}));
  return {documents,originals,sources,targets,run:{mode:"DUE_DILIGENCE",position:0,entity_scope:targets,questions,
    source_snapshot:originals.map(row=>({document_id:row.document_id,version_id:row.version_id,index_generation:"synthetic-capacity",lifecycle_epoch:1}))}};
}

export const diligenceCapacity=()=>diligenceData(true);
export function diligenceWire(sources,{capacity=false,empty=false}={}) {
  const anchors=[],texts=[],observations=[],gaps=[],seen=new Map();
  const text=value=>{if(!seen.has(value)){seen.set(value,texts.length);texts.push(value);}return seen.get(value);};
  const count=capacity?12:Math.min(12,sources.length);
  if(!empty)for(let i=0;i<count;i++) {
    const selected=capacity?Array.from({length:4},(_,j)=>sources[i*4+j===47?sources.length-1:i*4+j]):[i===count-1?sources.at(-1):sources[i]];
    const evidence=selected.map(source=>{
      assert.ok(source);const points=Array.from(source.content),length=capacity?300:Math.min(points.length,150);
      const start=capacity?0:2,quote=points.slice(start,start+length).join("");
      const index=anchors.length;anchors.push([source.citation_id,start,start+Array.from(quote).length]);return index;
    });
    observations.push({topic:capacity&&i===11?"SOURCE_DISCREPANCY":"OWNERSHIP",summary:text(`Synthetic provisional observation ${i+1}.`.padEnd(capacity?240:60,"x")),evidence,
      limitations:Array.from({length:capacity?4:1},(_,j)=>text(`Independent review qualification ${i+1}/${j+1};subject identity and later amendments unresolved.`.padEnd(capacity?240:100,"x")))});
  }
  for(let i=0;i<(capacity?12:1);i++)gaps.push({document_id:i?sources[(i-1)%sources.length]?.document_id||null:null,
    description:text(`Synthetic evidence gap ${i+1};later amendments not established.`.padEnd(capacity?240:80,"x"))});
  assert.ok(anchors.length<=48&&texts.length<=72);
  return {schema_version:"research-diligence-wire/1",anchors,texts,observations,gaps};
}
