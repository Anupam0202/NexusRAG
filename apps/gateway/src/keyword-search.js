// Keyword candidates for chat (NX-20).
//
// Without page or metadata filters the database ranks every passage of the chosen versions by the question's words,
// weighted by rarity (`nexus_keyword_chunks`, migration 20261117090000), and returns the best KEYWORD_LIMIT. With
// such filters the bounded read is kept: the first 201 matching passages in identifier order, which is the complete
// allow-list the vector search is then limited to (more than 200 is refused). A database without the migration gets
// the bounded read too, so the gateway can be released before it.

export const KEYWORD_LIMIT = 50;
export const PASSAGE_COLUMNS =
  "id,workspace_id,document_id,version_id,chunk_index,page_number,content,original_text,original_content_hash,location,metadata";
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

/**
 * `read(path, init)` is the gateway's service-role request. Returns `{ rows, limited, method }`: `limited` is true when
 * the bounded read stopped at its cap, and `method` is "RANKED" or "FIRST_PASSAGES" (reported in the answer's coverage).
 */
export async function keywordCandidates(read, { workspace, versionIds, question, chunkFilters = "", chunkScoped = false }) {
  if (!versionIds.length) return { rows: [], limited: false, method: chunkScoped ? "FIRST_PASSAGES" : "RANKED" };
  const bounded = async () => {
    const rows = await read(`document_chunks?workspace_id=eq.${workspace}&version_id=in.(${versionIds.join(",")})${chunkFilters}`
      + `&select=${PASSAGE_COLUMNS}&order=id.asc&limit=201`);
    return { rows, limited: rows.length > 200, method: "FIRST_PASSAGES" };
  };
  if (chunkScoped) return bounded();
  let ranked;
  try {
    ranked = await read("rpc/nexus_keyword_chunks", { method: "POST", body: JSON.stringify({
      p_workspace: workspace, p_version_ids: versionIds, p_question: question, p_limit: KEYWORD_LIMIT }) });
  } catch (error) {
    if (MISSING_FUNCTION.has(error?.storageCode)) return bounded();
    throw error;
  }
  if (!Array.isArray(ranked) || ranked.length > KEYWORD_LIMIT) {
    throw Object.assign(new Error("Keyword search returned an unexpected answer."), { status: 503, code: "PERSISTENCE_UNAVAILABLE" });
  }
  // The function keeps to the workspace and versions it is given; a passage of any other is dropped all the same.
  const allowed = new Set(versionIds);
  const rows = ranked.filter((row) => row?.workspace_id === workspace && allowed.has(row?.version_id))
    .map(({ keyword_score: _score, ...row }) => row);
  return { rows, limited: false, method: "RANKED" };
}
