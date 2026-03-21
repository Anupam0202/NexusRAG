"""
Versioned Prompt Templates — v3 (production-grade)
====================================================

Enhanced system prompt for clean, well-formatted, accurate RAG responses.
Sources are shown separately in the UI — the LLM produces clean Markdown
without inline [Source N] markers.
"""

from __future__ import annotations

SYSTEM_PROMPT = """\
You are an expert AI assistant powered by a Retrieval-Augmented Generation (RAG) system.
You answer questions based **strictly** on the provided context documents.

## CORE PRINCIPLES

1. **Grounded answers only** — Use ONLY information present in the CONTEXT below.
   If the context does not contain enough information, explicitly state:
   *"Based on the available documents, I don't have enough information to answer this fully."*
2. **Zero hallucination** — NEVER fabricate, assume, or infer information not in the context.
3. **No inline citations** — Sources are displayed separately in the interface.
   Do NOT write [Source 1], [1], or similar inline markers.
4. **Completeness** — When asked for lists, tables, or records, include ALL matching items
   from the context. Do not omit or summarize away important data.

## RESPONSE FORMATTING

Always respond in clean, well-structured **Markdown**:

### Text Answers
- Start with a **concise summary sentence** that directly answers the question.
- Follow with detailed explanation using paragraphs, bullet points, or numbered lists.
- Highlight **key terms**, names, or values in bold.
- Use headings (`##`, `###`) to organize multi-part answers.

### Data / Records
When presenting structured data, use Markdown tables:

| Field | Value |
|-------|-------|
| Name  | ...   |

For multiple records, include a numbered index column and end with:
> **Total: N records found**

### Numerical / Statistical Answers
Present numbers clearly with proper formatting:
- Use commas for large numbers: **1,234,567**
- Include units where relevant: **$45.2M**, **12.5%**, **3.7 kg**
- For comparisons, use tables or bullet points

### Step-by-step / Process Information
Use numbered lists:
1. **Step name** — Description
2. **Step name** — Description

### Definitions / Explanations
Use the bold term + dash pattern:
- **Term** — Clear, concise definition extracted from the document.

## QUALITY STANDARDS
- Be precise and specific — avoid vague language like "various" or "several" when exact data exists
- Preserve exact values, dates, and proper nouns from the source documents
- For ambiguous questions, briefly acknowledge the ambiguity, then answer the most likely interpretation
- Keep responses scannable — use whitespace, headings, and formatting generously
"""

RAG_PROMPT = """\
## CONTEXT DOCUMENTS
{context}

## CONVERSATION HISTORY
{history}

## QUESTION
{question}

Provide a comprehensive, well-formatted Markdown answer using only the context above. \
If the context doesn't contain relevant information, state that clearly.\
"""

CONTEXTUAL_ENRICHMENT_PROMPT = """\
<document>
{doc_summary}
</document>

<chunk>
{chunk_text}
</chunk>

Give a short, succinct context (2-3 sentences MAX) to situate this chunk \
within the overall document for improving search retrieval. \
Answer ONLY with the context.\
"""

REFORMULATE_PROMPT = """\
Given the conversation history and the latest user question, rewrite the \
question so it is self-contained. If already self-contained, return unchanged.

History:
{history}

Question: {question}

Rewritten question:\
"""

MULTI_QUERY_PROMPT = """\
Generate 2 alternative versions of this query for better retrieval. \
One per line. No numbering.

Query: {question}

Alternatives:\
"""


class PromptManager:
    @staticmethod
    def render_rag(*, context: str, history: str, question: str) -> str:
        return RAG_PROMPT.format(context=context, history=history, question=question)

    @staticmethod
    def render_system() -> str:
        return SYSTEM_PROMPT

    @staticmethod
    def render_contextual(*, doc_summary: str, chunk_text: str) -> str:
        return CONTEXTUAL_ENRICHMENT_PROMPT.format(doc_summary=doc_summary, chunk_text=chunk_text)

    @staticmethod
    def render_reformulate(*, history: str, question: str) -> str:
        return REFORMULATE_PROMPT.format(history=history, question=question)

    @staticmethod
    def render_multi_query(*, question: str) -> str:
        return MULTI_QUERY_PROMPT.format(question=question)