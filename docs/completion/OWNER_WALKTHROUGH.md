# Owner walkthrough

The plan asks the owner to try the app once, signed in with Google, before Tier 1 counts as done, and again on
production before the final release. This is the checklist. It takes about twenty minutes. Use a private browser
window, and reply in chat with "walkthrough passed", or with the number of the first step that went wrong and what
you saw.

**Where:** the preview, `https://nexusrag-v6-candidate-frontend.nexusrag-evidence-preview.workers.dev`. For the
production pass, `https://nexusrag-v6-frontend-preview.nexusrag-evidence-preview.workers.dev`.

**Before you start** (Claude checks these and tells you when they are true):
- The preview gateway's `/health` shows the commit being tested, and its `/ready` says the database and the search
  index are ready.
- The preview frontend was built from the same commit (the Cloudflare Preview Deploy workflow).
- A working Gemini key is configured (owner action 1 in `PROGRESS.md`), and the rehearsal database has every
  migration.

Have three small files ready: a PDF, a Word document (.docx) and a text or Markdown file, each under 10 MB,
containing nothing confidential. For step 8 the PDF should have more than one page.

## Sign-in and workspace

1. Open the address above. You see the sign-in page. Choose **Continue with Google** and sign in.
2. A first sign-in lands on the onboarding page, a later one on your workspace. Create a workspace if asked
   (**Create workspace**); its name shows in the header.
3. Open **Documents**. If it says the workspace owner must approve Gemini processing, choose **Review and approve**,
   which opens **Settings → Privacy**, and approve it there.

## Your Gemini key

4. Open **Settings → API keys**. Enter a deliberately wrong key: you are told Gemini rejected it, and nothing is
   saved.
5. Enter your real key and accept the cost notice. The page shows the key as active, with only its last four
   characters.

## Documents

6. In **Documents**, upload the three files. Each shows as processing, then **Ready**. A file is marked Ready only
   when it can actually be answered from; none should stay processing for more than a few minutes.
7. Upload one of the same files again. You are told it is already there, not given a second copy.

## Questions and answers

8. Open **Chat** and ask something only your PDF answers. The answer appears word by word, ends with citations, and
   each citation opens the passage it quotes, with its page.
9. Ask for a summary of one named document ("Summarise <file name>"). The summary cites that document only.
10. Ask something none of your documents answer. The answer says the documents do not support one, instead of
    inventing it.
11. Save a good answer with **Save as finding**. It appears in **Findings**.

## Workspaces stay separate

12. In **Workspaces**, create a second workspace and switch to it. Ask the question from step 8: no answer may use
    the first workspace's documents.
13. Open the app in a second tab, switch that tab back to the first workspace, then ask a question in each tab.
    Each answer cites only its own workspace's documents.

## Deleting

14. In the first workspace, delete one document. It disappears at once. A few minutes later, ask the question that
    document answered: the answer no longer uses it.
15. Switch to the second (empty) workspace and delete it under **Settings → Privacy** (type DELETE WORKSPACE). It
    disappears from your workspaces at once.

## Signing out

16. Sign out (**Sign out**). You are back on the sign-in page, and opening **Chat** asks you to sign in again.

## Optional, for Tier 2

- **Research:** create a Calculation plan over a document that states two figures, run it, and check that the
  result shows its formula and the passages it came from.
- **Retention:** in **Settings → Privacy**, set a retention period and use **Run now**; documents older than the
  cutoff go, and saved findings stay.
- **Account deletion:** only with a throwaway Google account, never your own: **Settings → Security → Delete your
  account**.
