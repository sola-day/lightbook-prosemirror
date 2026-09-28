# lightbook-prosemirror

Shared, standalone ProseMirror editor core for the Lightbook ecosystem. Built
from scratch on the latest ProseMirror packages — not copied from Outline —
so it can be depended on by both Outline-style docs apps and the new
Lightbook web app.

## Why this exists

Outline and Lightbook each maintain their own ProseMirror integration today.
This package is meant to become the single, versioned editor core both can
depend on once it's proven out, covering:

- **Rich block schema**: headings, lists (bullet/ordered/checkbox), tables
  (`prosemirror-tables`), code blocks, blockquotes, links — enough structure
  for real documents without dragging in a full plugin surface.
- **Markdown import/export**: a hand-written `MarkdownParser`/`MarkdownSerializer`
  pairing (via `markdown-it`) with GFM tables and strikethrough. Markdown is
  treated as an interchange format (paste/import/export), not the source of
  truth — the ProseMirror/Yjs document is.
- **Google-Docs-style comments**: a `comment` mark anchors threads to text
  ranges; thread content/authorship live outside the editor and are keyed by
  the same `threadId`.
- **Google-Docs-style "Suggesting" mode**: edits made while suggesting is
  active are tagged (`suggestion_insert` / `suggestion_delete`) instead of
  applied directly, so they can be reviewed and accepted/rejected later.
- **Realtime collaboration**: Yjs + `y-prosemirror` binding with live remote
  cursors and collaborative undo — the same approach Outline uses, wired up
  independently for this schema.

## Structure

```
src/
  schema/        node & mark specs, assembled Schema
  markdown.ts    Markdown <-> ProseMirror doc conversion
  comments/      comment threads + suggestion-mode plugins
  collab.ts      Yjs / y-prosemirror binding helper
  keymap.ts      base keymap (bold/italic/lists/headings/tables)
  index.ts       createEditor() — the single entry point
example/         a runnable demo page (two live-synced editors,
                 comments/suggesting UI, markdown import/export)
```

## Getting started

```bash
corepack pnpm install
corepack pnpm dev      # example page at http://localhost:5183
corepack pnpm typecheck
corepack pnpm build    # builds the example page to example-dist/
```

## Status

Early scaffold, not yet published as a package. Once the schema and
comments/suggestion model settle, Lightbook's `apps/web` will depend on this
package directly instead of hand-rolling its own ProseMirror wiring — see
`apps/web/src/components/RichTextEditor.tsx`, `SuggestionAnchors.ts`, and
`CommentAnchors.ts` in the `lightbook` repo for the current in-app logic this
is meant to replace.
