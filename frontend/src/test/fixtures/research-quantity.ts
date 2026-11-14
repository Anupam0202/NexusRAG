export const input={document_id:"44444444-4444-4444-8444-444444444444",version_id:"55555555-5555-4555-8555-555555555555",chunk_index:0,
  original_content_hash:"a".repeat(64),value_span:{start:8,end:13},unit_span:{start:14,end:16}};
export const sourceText="\u{1F4CA} mass: 1.005 kg; other mass 9 kg";
export const record={id:"66666666-6666-4666-8666-666666666666",workspace_id:"workspace-a",owner_id:"user-a",plan_id:"plan-a",document_id:input.document_id,version_id:input.version_id,
  chunk_id:"77777777-7777-4777-8777-777777777777",input,created_at:"2026-10-15T12:00:00Z",quantity:{value:"1.005",unit:"kg",evidence_ids:["urn:nexusrag:quantity:66666666-6666-4666-8666-666666666666"]},
  source:{filename:"quantity.txt",page_number:2,location:{page:2},value_context:{text:sourceText,span_start:8,span_end:13},unit_context:{text:sourceText,span_start:14,span_end:16}},
  state:"captured" as const,schema_version:"research-quantity/1" as const,persistence_state:"PERSISTED" as const,source_state:"SOURCE_SPANS_MATCHED_REVIEW_REQUIRED" as const,freshness:"current" as const};
