// Filters are scope, not ranking hints. Apply them to durable records before
// provider admission, then recheck against rehydrated authority before use.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => Object.assign(new Error("Retrieval filters are invalid. Use exact filenames, valid uploader IDs, bounded page ranges, ISO dates, and scalar metadata values."), { status: 422, code: "INVALID_SCOPE" });

function dateEpoch(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) throw invalid();
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (year < 1) throw invalid();
  const check = new Date(0);
  check.setUTCFullYear(year, month - 1, day);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw invalid();
  const epoch = Date.parse(value);
  // Date.parse accepts 24:00 and rolls it forward. This contract does not.
  if (!Number.isFinite(epoch) || (value.length > 10 && (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59))) throw invalid();
  return epoch;
}

export function normalizeRetrievalFilters(body) {
  const filters = {};
  for (const key of ["filename", "uploaded_by"]) {
    const value = body[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || !value.trim() || value.length > 255 || /[\x00-\x1f\x7f]/.test(value)) throw invalid();
    filters[key] = value.trim();
    if (key === "uploaded_by" && !uuid.test(filters[key])) throw invalid();
    if (key === "uploaded_by") filters[key] = filters[key].toLowerCase();
  }
  if (body.file_types !== undefined && body.file_types !== null) {
    if (!Array.isArray(body.file_types) || body.file_types.length > 20 || body.file_types.some(value => typeof value !== "string" || !/^\.?[a-z0-9]{1,20}$/i.test(value))) throw invalid();
    if (body.file_types.length) filters.file_types = [...new Set(body.file_types.map(value => value.toLowerCase().replace(/^\./, "")))];
  }
  for (const key of ["min_page", "max_page"]) {
    if (body[key] === undefined || body[key] === null) continue;
    if (!Number.isSafeInteger(body[key]) || body[key] < 0 || body[key] > 1_000_000) throw invalid();
    filters[key] = body[key];
  }
  if (filters.min_page !== undefined && filters.max_page !== undefined && filters.min_page > filters.max_page) throw invalid();
  for (const key of ["uploaded_after", "uploaded_before"]) {
    if (body[key] === undefined || body[key] === null || body[key] === "") continue;
    filters[key] = dateEpoch(body[key]);
  }
  if (filters.uploaded_after !== undefined && filters.uploaded_before !== undefined && filters.uploaded_after > filters.uploaded_before) throw invalid();
  if (body.metadata_filters !== undefined && body.metadata_filters !== null) {
    const value = body.metadata_filters;
    if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 8) throw invalid();
    const pairs = Object.entries(value);
    if (pairs.some(([key, item]) => !/^[A-Za-z0-9_.-]{1,64}$/.test(key)
      || ["__proto__", "constructor", "prototype"].includes(key)
      || !["string", "number", "boolean"].includes(typeof item)
      || (typeof item === "string" && (item.length > 256 || /[\x00-\x1f\x7f]/.test(item)))
      || (typeof item === "number" && !Number.isFinite(item)))) throw invalid();
    if (pairs.length) filters.metadata_filters = Object.fromEntries(pairs);
  }
  return filters;
}

export function documentFilterQuery(filters) {
  const params = new URLSearchParams();
  for (const key of ["filename", "uploaded_by"]) if (filters[key] !== undefined) params.append(key, `eq.${filters[key]}`);
  if (filters.file_types) params.append("or", `(${filters.file_types.map(type => `filename.ilike.*.${type}`).join(",")})`);
  if (filters.uploaded_after !== undefined) params.append("created_at", `gte.${new Date(filters.uploaded_after).toISOString()}`);
  if (filters.uploaded_before !== undefined) params.append("created_at", `lte.${new Date(filters.uploaded_before).toISOString()}`);
  return params.size ? `&${params}` : "";
}

export function chunkFilterQuery(filters) {
  const params = new URLSearchParams();
  if (filters.min_page !== undefined) params.append("page_number", `gte.${filters.min_page}`);
  if (filters.max_page !== undefined) params.append("page_number", `lte.${filters.max_page}`);
  // JSON containment treats keys (including dots) literally, not JSON paths.
  if (filters.metadata_filters) params.append("metadata", `cs.${JSON.stringify(filters.metadata_filters)}`);
  return params.size ? `&${params}` : "";
}

export function hasChunkFilters(filters) {
  return filters.min_page !== undefined || filters.max_page !== undefined || filters.metadata_filters !== undefined;
}

export function matchesDocumentFilters(document, filters) {
  if (filters.filename !== undefined && document.filename !== filters.filename) return false;
  if (filters.uploaded_by !== undefined && document.uploaded_by !== filters.uploaded_by) return false;
  if (filters.file_types && !filters.file_types.some(type => typeof document.filename === "string" && document.filename.toLowerCase().endsWith(`.${type}`))) return false;
  if (filters.uploaded_after !== undefined || filters.uploaded_before !== undefined) {
    const epoch = typeof document.created_at === "string" ? Date.parse(document.created_at) : NaN;
    if (!Number.isFinite(epoch) || (filters.uploaded_after !== undefined && epoch < filters.uploaded_after)
      || (filters.uploaded_before !== undefined && epoch > filters.uploaded_before)) return false;
  }
  return true;
}

export function matchesChunkFilters(chunk, filters) {
  if (filters.min_page !== undefined || filters.max_page !== undefined) {
    if (!Number.isSafeInteger(chunk.page_number) || chunk.page_number < 0
      || (filters.min_page !== undefined && chunk.page_number < filters.min_page)
      || (filters.max_page !== undefined && chunk.page_number > filters.max_page)) return false;
  }
  for (const [key, value] of Object.entries(filters.metadata_filters || {})) {
    if (!chunk.metadata || !Object.hasOwn(chunk.metadata, key) || chunk.metadata[key] !== value) return false;
  }
  return true;
}