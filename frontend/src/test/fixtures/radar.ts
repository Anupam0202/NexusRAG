import type { RadarCapture, RadarChangeDetail, RadarChunks, RadarProvider, RadarSource, RadarSourceDetail } from "@/lib/radar";

// Synthetic contract data. These fixtures are never a receipt of hosted writes.
export const radarIds = {
  workspace:"11111111-1111-4111-8111-111111111111", user:"22222222-2222-4222-8222-222222222222",
  reviewer:"33333333-3333-4333-8333-333333333333", source:"44444444-4444-4444-8444-444444444444",
  monitor:"55555555-5555-4555-8555-555555555555", beforeDoc:"66666666-6666-4666-8666-666666666666",
  afterDoc:"77777777-7777-4777-8777-777777777777", beforeVersion:"88888888-8888-4888-8888-888888888888",
  afterVersion:"99999999-9999-4999-8999-999999999999", beforeChunk:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  afterChunk:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", beforeSnapshot:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  afterSnapshot:"dddddddd-dddd-4ddd-8ddd-dddddddddddd", baselineChange:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  change:"ffffffff-ffff-4fff-8fff-ffffffffffff", review:"12345678-1234-4234-8234-123456789abc",
  finding:"23456789-2345-4345-8345-23456789abcd",
} as const;
export const radarTime="2026-10-26T00:00:00.000Z";
export const radarRights={decision:"ALLOW",state:"ALLOWED",reason_code:"WORKSPACE_PERMISSION",duties:[]};
export const radarProvider:RadarProvider={id:"synthetic-provider",display_name:"Synthetic Provider",revision:1,status:"active",rights:radarRights};
export const radarSource:RadarSource={schema_version:"radar-source/1",id:radarIds.source,workspace_id:radarIds.workspace,
  provider_id:radarProvider.id,title:"Synthetic quota source",source_url:"https://provider.example/quota",kind:"QUOTA",revision:2,
  latest_snapshot_id:radarIds.afterSnapshot,created_at:radarTime,created_by:radarIds.user,affected_workflows:[],rights:radarRights,
  monitor:{id:radarIds.monitor,tier:"MANUAL_REVIEW",retrieval_method:"SUPPLIED_DOCUMENT",enabled:false,next_run_at:null}};
export const beforeOriginal={id:radarIds.beforeChunk,document_id:radarIds.beforeDoc,version_id:radarIds.beforeVersion,chunk_index:0,
  original_content_hash:"a".repeat(64),original_bytes:37,location:{page:1}};
export const afterOriginal={...beforeOriginal,id:radarIds.afterChunk,document_id:radarIds.afterDoc,version_id:radarIds.afterVersion,
  original_content_hash:"b".repeat(64),original_bytes:36};
const before={schema_version:"radar-snapshot/1" as const,id:radarIds.beforeSnapshot,workspace_id:radarIds.workspace,source_id:radarIds.source,
  revision:1,document_id:radarIds.beforeDoc,version_id:radarIds.beforeVersion,document_original_hash:"c".repeat(64),document_original_bytes:37,
  chunk_ids:[radarIds.beforeChunk],selection_hash:"d".repeat(64),normalized_hash:"e".repeat(64),selected_utf8_bytes:37,stored_chunk_count:1,
  coverage:"SELECTED_CHUNKS_NOT_FULL_DOCUMENT" as const,comparison_complete:true,captured_at:radarTime,recorded_at:radarTime,
  actor_id:radarIds.user,change_id:radarIds.baselineChange,selected_originals:[beforeOriginal]};
const after={...before,id:radarIds.afterSnapshot,revision:2,document_id:radarIds.afterDoc,version_id:radarIds.afterVersion,
  document_original_hash:"f".repeat(64),document_original_bytes:36,chunk_ids:[radarIds.afterChunk],selection_hash:"0".repeat(64),
  normalized_hash:"1".repeat(64),selected_utf8_bytes:36,change_id:radarIds.change,selected_originals:[afterOriginal]};
export const radarChange:RadarChangeDetail={schema_version:"radar-change/1",id:radarIds.change,workspace_id:radarIds.workspace,source_id:radarIds.source,
  before_snapshot_id:before.id,after_snapshot_id:after.id,previous_hash:before.normalized_hash,current_hash:after.normalized_hash,
  before_chunk_ids:before.chunk_ids,previous_selection_hash:before.selection_hash,current_selection_hash:after.selection_hash,
  status:"CHANGED",materiality:"OPERATIONAL",review_state:"PENDING",review_revision:0,finding_id:null,created_at:radarTime,
  before,after,reviews:[],review_count:0,reviews_next_after:null,review_history_hash:"2".repeat(64),source_available:true,rights:radarRights,
  affected_workflows:[],before_text_preview:"Daily quota: 100 requests per account.",after_text_preview:"Daily quota: 10 requests per account.",
  preview_truncated:false,coverage:"SELECTED_CHUNKS_NOT_FULL_DOCUMENT",selections:{before:[beforeOriginal],after:[afterOriginal]},
  provider_id:radarProvider.id,source_url:radarSource.source_url,kind:"QUOTA"};
export const radarApproved={...radarChange,review_state:"APPROVED" as const,review_revision:1,review_count:1,
  reviews:[{id:radarIds.review,reviewer_id:radarIds.reviewer,decision:"approved" as const,comment:"Reviewed quota pair",affected_workflows:[],created_at:radarTime,revision:1}]};
export const radarSourceDetail:RadarSourceDetail={schema_version:"radar-source-detail/1",source:radarSource,latest_snapshot:after,
  snapshots:{items:[after,before],next_after:null},changes:{items:[radarChange],next_after:null},runs:{schema_version:"radar-run-list/1",items:[],next_after:null}};
export const radarChunks:RadarChunks={schema_version:"radar-chunks/1",document_id:radarIds.afterDoc,version_id:radarIds.afterVersion,
  document_original_hash:after.document_original_hash,document_original_bytes:36,stored_chunk_count:1,
  items:[{...afterOriginal,preview:radarChange.after_text_preview!,preview_truncated:false}],next_after:null};
export const radarCapture:RadarCapture={schema_version:"radar-capture/1",source:radarSource,snapshot:after,change:radarChange};
export const radarCaptureBody={expected_revision:1,document_id:radarIds.afterDoc,version_id:radarIds.afterVersion,
  chunk_ids:[radarIds.afterChunk],before_chunk_ids:[radarIds.beforeChunk],captured_at:radarTime,rights_rationale:"Synthetic permitted supplied copy"};
