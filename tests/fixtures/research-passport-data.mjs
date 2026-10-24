import assert from "node:assert/strict";
import {createHash} from "node:crypto";

export function passportCapacity() {
  const documents=[],originals=[];
  const subject={product_id:"P-42",product_name:"Synthetic sensor",product_version:"2.1",supplier:"Example Components"};
  for(let i=1;i<=60;i++) {
    const tail=String(i).padStart(12,"0"),id=`d0585858-0000-4000-8100-${tail}`,version_id=`e0585858-0000-4000-8100-${tail}`;
    const header=`\u{1F4CA} Synthetic sensor P-42 version 2.1: supplier Example Components reports certificate C-${i}, subject to independent verification, current validity and product applicability.`;
    const room=32768-Buffer.byteLength(header),original_text=header+"\u{1F4CA}".repeat(Math.floor(room/4))+"x".repeat(room%4);
    documents.push({id,filename:`Synthetic product evidence ${i}.txt`});
    const page_number=i===1?null:i===2?0:2;
    originals.push({id:i===1?"00005858-0000-4000-8100-000000000000":`f0585858-0000-4000-8100-${tail}`,
      document_id:id,version_id,chunk_index:0,original_text,original_content_hash:createHash("sha256").update(original_text).digest("hex"),
      page_number,location:page_number===null||page_number===0?{char_start:0,char_end:Array.from(original_text).length}:{page:page_number}});
  }
  const questions=Array.from({length:13},(_,i)=>`${i} Synthetic passport criterion requiring independent review.`.padEnd(i?5500:10000,"q"));
  const sources=originals.map((row,i)=>({document_id:row.document_id,version_id:row.version_id,chunk_id:row.id,citation_id:`S${i+1}`,
    filename:documents[i].filename,content:Array.from(row.original_text).slice(0,1200).join(""),original_content_hash:row.original_content_hash,
    page_number:row.page_number,chunk_index:row.chunk_index,location:row.location,excerpt:true}));
  return {documents,originals,sources,subject,run:{mode:"PRODUCT_PASSPORT",position:0,passport_subject:subject,questions,
    source_snapshot:originals.map(row=>({document_id:row.document_id,version_id:row.version_id,index_generation:"synthetic-capacity",lifecycle_epoch:1}))}};
}

export function passportWire(sources) {
  const anchors=[],texts=[],claims=[],gaps=[];
  const text=value=>{texts.push(value);return texts.length-1;};
  for(let i=0;i<12;i++) {
    const evidence=Array.from({length:4},(_,j)=>{
      const source=sources[i*4+j===47?sources.length-1:i*4+j],index=anchors.length;
      assert.ok(source);anchors.push([source.citation_id,0,300]);return index;
    });
    claims.push({kind:["CERTIFICATE","TEST","DECLARATION","COMPONENT","OBLIGATION","SBOM","LICENCE","VEX"][i%8],
      property:text(`Synthetic property ${i+1}.`.padEnd(128,"x")),value:text(`Unverified supplied product assertion ${i+1}.`.padEnd(240,"x")),
      status:i===11?"CONTRADICTED":"ASSERTED_BY_SUPPLIER",evidence,
      qualifications:Array.from({length:4},(_,j)=>text(`Independent applicability qualification ${i+1}/${j+1}; no certification.`.padEnd(240,"x")))});
  }
  for(let i=0;i<12;i++)gaps.push({document_id:i?sources[i-1].document_id:null,
    description:text(`Current product evidence gap ${i+1}; later reports not established.`.padEnd(240,"x"))});
  assert.equal(anchors.length,48);assert.equal(texts.length,84);
  return {schema_version:"research-passport-wire/1",anchors,texts,claims,gaps};
}
