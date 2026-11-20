const summaryRequest = /^\s*(?:(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:summari[sz]e\b|(?:give|provide|write|create)\s+(?:me\s+)?(?:(?:a|the)\s+)?summary\b|summary\s+(?:of|for)\b)/i;
const pluralRequest = /\b(?:all|every|both|these|selected)\s+(?:(?:the|my)\s+)?(?:documents|files|reports|letters)\b/i;
const genericStems = new Set(["document", "file", "report", "summary"]);

function normalizedName(value) {
  return String(value).normalize("NFKC").replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
function needsSelection(message) {
  throw Object.assign(new Error(message), { status: 422, code: "DOCUMENT_SELECTION_REQUIRED" });
}

// Only literal filename/stem references are resolved. Semantic guesses are left
// to explicit selection; a similarity-ranked chunk is not a document identity.
export function resolveSummaryDocuments(question, documents, explicitScope = false) {
  const result = (selected, reason) => ({ documents: selected, reason,
    document_ids: selected.map(doc => doc.id) });
  if (explicitScope) return result(documents, "EXPLICIT_SCOPE");
  if (!summaryRequest.test(question)) return result(documents, "WORKSPACE_SCOPE");
  const quotedFiles = [...question.matchAll(/["\x60\u201c]([^"\x60\u201d]+)["\x60\u201d]/gu)]
    .map(match => match[1].trim()).filter(name => /\.[a-z0-9]{1,12}$/i.test(name));
  const text = " " + normalizedName(question) + " ";
  if (quotedFiles.length) {
    const selected = [];
    for (const name of [...new Set(quotedFiles.map(normalizedName))]) {
      const matches = documents.filter(doc => normalizedName(doc.filename) === name);
      if (matches.length !== 1) needsSelection("A named file is missing or ambiguous in the current scope. Select documents or change the filename.");
      selected.push(matches[0]);
    }
    return result(selected, selected.length === 1 ? "NAMED_DOCUMENT" : "NAMED_DOCUMENTS");
  }
  const fullNames = documents.filter(doc => text.includes(" " + normalizedName(doc.filename) + " "));
  if (fullNames.length === 1) return result(fullNames, "NAMED_DOCUMENT");
  if (!fullNames.length && /\S+\.(?:pdf|docx?|xlsx?|csv|txt|md|json|png|jpe?g|tiff?)\b/i.test(question)) {
    needsSelection("A named file is missing or ambiguous in the current scope. Select documents or change the filename.");
  }
  if (!fullNames.length && pluralRequest.test(question)) return result(documents, "WORKSPACE_SCOPE");
  let stems = fullNames.length ? fullNames : documents.filter(doc => {
    const name = normalizedName(String(doc.filename).replace(/\.[a-z0-9]{1,20}$/i, ""));
    return name.length >= 3 && !genericStems.has(name) && text.includes(" " + name + " ");
  });
  const target = normalizedName(question.replace(summaryRequest, "").replace(/^\s*(?:of|for)\s+/i, "")
    .replace(/^\s*(?:the|my|a|an)\s+/i, ""));
  // A literal title suffix supports names such as Applicant_Cover_Letter.pdf.
  // Require at least two words and uniqueness, rather than fuzzy classification.
  if (!stems.length) {
    if (target.split(" ").length >= 2 && !/\b(?:this|that|document|documents|file|files|report|reports)\b/i.test(target)) {
      stems = documents.filter(doc => normalizedName(String(doc.filename).replace(/\.[a-z0-9]{1,20}$/i, "")).endsWith(" " + target));
    }
  }
  if (stems.length === 1) return result(stems, "NAMED_DOCUMENT");
  const genericTarget = !target || /^(?:(?:this|that)\s+)?(?:document|file|report)$/.test(target);
  if (!stems.length && !documents.length) return result(documents, "EMPTY_SCOPE");
  if (!stems.length && documents.length === 1 && genericTarget) return result(documents, "SINGLE_DOCUMENT");
  needsSelection("Select the document or documents to summarize. The current workspace does not identify a unique summary target.");
}
