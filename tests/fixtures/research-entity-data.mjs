import assert from "node:assert/strict";
import {createHash} from "node:crypto";

export function entityData(count=50) {
  const documents=[],originals=[];
  for(let i=1;i<=count;i++) {
    const tail=String(i).padStart(12,"0"),id=`d0480000-0000-4000-8100-${tail}`,version_id=`e0480000-0000-4000-8100-${tail}`;
    const header=`\u{1F4CA} Example Works ${i} (EX-${i}), also called WorksCo-${i}. Filing 2026-10-01 states Example Works ${i} is owned by Example Holdings ${i} from 2025-01-01.`;
    const original_text=header+".".repeat(32768-Buffer.byteLength(header));
    documents.push({id,filename:`Synthetic entity ${i}.txt`});
    const page_number=i===1?null:i===2?0:2;
    originals.push({id:i===1?"00000048-0000-4000-8100-000000000000":`f0480000-0000-4000-8100-${tail}`,
      document_id:id,version_id,chunk_index:0,original_text,original_content_hash:createHash("sha256").update(original_text).digest("hex"),
      page_number,location:page_number===null||page_number===0?{char_start:0,char_end:Array.from(original_text).length}:{page:page_number}});
  }
  return {documents,originals,targets:Array.from({length:100},(_,i)=>i<50?`Example Works ${i+1}`:`Example Holdings ${i-49}`)};
}

export function entityProposals(sources,maximum=12) {
  const selected=sources.length>maximum?[...sources.slice(0,maximum-1),sources.at(-1)]:sources;
  return selected.map(source=>{
    const number=source.content.match(/Example Works (\d+)/)[1],name=`Example Works ${number}`;
    const statement=`${name} is owned by Example Holdings ${number} from 2025-01-01.`;
    const offset=source.content.indexOf(statement);
    const anchor=(quote,from=0)=>{const index=source.content.indexOf(quote,from);assert.ok(index>=0);
      return {citation_id:source.citation_id,quote,quote_start:Array.from(source.content.slice(0,index)).length};};
    return {name:anchor(name),identifiers:[anchor(`EX-${number}`)],aliases:[anchor(`WorksCo-${number}`)],filings:[anchor("2026-10-01")],
      jurisdiction:null,valid_from:anchor("2025-01-01"),valid_to:null,
      relationships:[{statement:anchor(statement),subject:anchor(name,offset),predicate:anchor("is owned by"),object:anchor(`Example Holdings ${number}`),
        valid_from:anchor("2025-01-01"),valid_to:null}],limitations:["A source assertion does not resolve current identity or ownership."]};
  });
}

export function entityWire(candidates,sources,quoteOnly=false) {
  const anchors=[],texts=[],anchorIndex=new Map(),textIndex=new Map();
  const ref=anchor=>{
    if(anchor===null)return null;
    const source=sources.find(source=>source.citation_id===anchor.citation_id);assert.ok(source);
    const index=anchor.quote_start??Array.from(source.content.slice(0,source.content.indexOf(anchor.quote))).length;
    const entry=[anchor.citation_id,index,index+Array.from(anchor.quote).length],key=JSON.stringify(entry);
    if(!anchorIndex.has(key)){anchorIndex.set(key,anchors.length);anchors.push(quoteOnly?{citation_id:anchor.citation_id,quote:anchor.quote}:entry);}return anchorIndex.get(key);
  };
  const text=value=>{if(!textIndex.has(value)){textIndex.set(value,texts.length);texts.push(value);}return textIndex.get(value);};
  return {schema_version:"research-entity-wire/1",anchors,texts,candidates:candidates.map(candidate=>({name:ref(candidate.name),
    identifiers:candidate.identifiers.map(ref),aliases:candidate.aliases.map(ref),filings:candidate.filings.map(ref),
    jurisdiction:ref(candidate.jurisdiction),valid_from:ref(candidate.valid_from),valid_to:ref(candidate.valid_to),
    relationships:candidate.relationships.map(row=>Object.fromEntries(["statement","subject","predicate","object","valid_from","valid_to"].map(field=>[field,ref(row[field])]))),
    limitations:candidate.limitations.map(text)}))};
}

// This exercises schema cardinality and Unicode payload size, not entity semantics.
export function entityCapacity() {
  const data=entityData();
  for(const [i,original] of data.originals.entries()) {
    const tail=String(i+1).padStart(12,"0"),prefix=`Synthetic capacity entity ${i+1}. `;
    data.documents[i]={id:`d0484800-0000-4000-8100-${tail}`,filename:`Synthetic capacity entity ${i+1}.txt`};
    const room=32768-Buffer.byteLength(prefix),text=prefix+"\u{1F4CA}".repeat(Math.floor(room/4))+"x".repeat(room%4);
    Object.assign(original,{id:`f0484800-0000-4000-8100-${tail}`,document_id:data.documents[i].id,version_id:`e0484800-0000-4000-8100-${tail}`,
      original_text:text,original_content_hash:createHash("sha256").update(text).digest("hex"),location:{char_start:0,char_end:Array.from(text).length}});
  }
  const sources=data.originals.map((row,i)=>({document_id:row.document_id,version_id:row.version_id,chunk_id:row.id,
    original_content_hash:row.original_content_hash,page_number:row.page_number,chunk_index:0,location:row.location,
    citation_id:`S${i+1}`,filename:data.documents[i].filename,content:Array.from(row.original_text).slice(0,1200).join(""),excerpt:true}));
  const anchor=index=>({citation_id:sources[index].citation_id,quote:Array.from(sources[index].content).slice(0,300).join(""),quote_start:0});
  const candidates=Array.from({length:12},(_,i)=>({name:anchor(i),
    ...Object.fromEntries(["identifiers","aliases","filings"].map(field=>[field,Array.from({length:4},()=>anchor(i))])),
    ...Object.fromEntries(["jurisdiction","valid_from","valid_to"].map(field=>[field,anchor(i)])),
    relationships:Array.from({length:4},()=>Object.fromEntries(["statement","subject","predicate","object","valid_from","valid_to"].map(field=>[field,anchor(i)]))),
    limitations:Array.from({length:4},(_,j)=>`Synthetic capacity limitation ${i+1}/${j+1}. `.padEnd(240,"x"))}));
  const questions=Array.from({length:11},(_,i)=>`${i} Synthetic maximum-field entity review `.padEnd(i?8000:10000,"q"));
  return {...data,sources,candidates,run:{mode:"ENTITY_INVESTIGATION",entity_scope:data.targets,questions,position:0,
    source_snapshot:data.originals.map(row=>({document_id:row.document_id,version_id:row.version_id,index_generation:"synthetic-capacity",lifecycle_epoch:1}))}};
}
