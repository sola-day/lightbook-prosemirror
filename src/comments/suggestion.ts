import { Plugin, PluginKey, EditorState, Transaction, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { ReplaceStep } from "prosemirror-transform";
import { lightbookSchema as schema } from "../schema";

export const suggestionPluginKey = new PluginKey<SuggestionState>("lightbook-suggestion");

export interface SuggestionState {
  /** Non-null while the editor is in "Suggesting" mode; carries the current author. */
  active: { authorId: string } | null;
}

function isMarkedDeleted(node: import("prosemirror-model").Node) {
  return node.marks.some((m) => m.type.name === "suggestion_delete");
}

function buildDecorations(doc: import("prosemirror-model").Node) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (isMarkedDeleted(node)) {
      decorations.push(
        Decoration.inline(pos, pos + node.nodeSize, { class: "lb-suggestion-delete-visual" })
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Builds an *additional* transaction, on top of `newState` (the state after
 * `userEdit` was already applied destructively), that converts that edit
 * into a suggestion: the really-inserted text gets tagged `suggestion_insert`,
 * and the really-deleted text is re-inserted right after it, tagged
 * `suggestion_delete`, so it stays visible (struck through) instead of
 * being gone.
 *
 * IMPORTANT: `Plugin.appendTransaction(transactions, oldState, newState)`
 * requires its returned transaction to be built from `newState.tr` — i.e.
 * on top of the doc the original edit already produced. An earlier version
 * of this function built the replacement from `oldState.tr` instead (a
 * transaction meant to *replace* the edit rather than follow it), which
 * ProseMirror rejects at apply time with "Applying a mismatched
 * transaction" the moment suggesting mode intercepts a real edit. Track
 * `getPos`-analogous reasoning: `newState` already reflects `userEdit`, so
 * this function *adds* marks/content on top of it, it never tries to undo
 * and redo the edit from scratch.
 *
 * Scope: only single-step `ReplaceStep` edits where the affected range sits
 * inside one parent node and the inserted slice has no open block
 * boundaries are rewritten — i.e. typing, backspace/delete, and simple
 * inline paste, which covers normal suggesting use. Anything structurally
 * more complex (multi-step transactions, cross-block deletes, list/wrap
 * commands) is left as a normal, un-tracked edit rather than risking a
 * corrupted document from a naive slice re-insertion.
 */
function buildSuggestionAppend(
  userEdit: Transaction,
  oldState: EditorState,
  newState: EditorState,
  authorId: string
): Transaction | null {
  if (userEdit.steps.length !== 1) return null;
  const step = userEdit.steps[0];
  if (!(step instanceof ReplaceStep)) return null;

  const $from = oldState.doc.resolve(step.from);
  const $to = oldState.doc.resolve(step.to);
  if ($from.sameParent($to) === false) return null;
  if (step.slice.openStart !== 0 || step.slice.openEnd !== 0) return null;

  const id = `sg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const insertMark = schema.marks.suggestion_insert.create({ id, authorId, createdAt });
  const deleteMark = schema.marks.suggestion_delete.create({ id, authorId, createdAt });

  const insertedSize = step.slice.content.size;
  const deletedSlice = oldState.doc.slice(step.from, step.to);
  const deletedSize = deletedSlice.content.size;

  // If every bit of the range being deleted is itself still-pending
  // suggested content (i.e. it already carries a suggestion_insert mark —
  // text from an earlier, not-yet-accepted suggestion), don't wrap it in a
  // SECOND suggestion layer: that stacked a suggestion_delete mark on top of
  // the existing suggestion_insert mark and rendered as underline (insert
  // styling) AND strikethrough (delete styling) at once. Deleting text that
  // was never committed should just cancel it for real — return `null` so
  // `newState`'s already-real deletion stands untouched.
  if (deletedSize > 0) {
    let allPendingInsert = true;
    deletedSlice.content.forEach((node) => {
      if (!node.isText || !node.marks.some((m) => m.type.name === "suggestion_insert")) {
        allPendingInsert = false;
      }
    });
    if (allPendingInsert) return null;
  }

  // Deleted text isn't actually removed here — it's reinserted and tagged
  // suggestion_delete so it stays visible (struck through) for review, which
  // means the cursor has to be placed explicitly: ProseMirror's own post-step
  // selection (which we'd otherwise inherit unchanged from `newState`) stays
  // wherever the *real* delete would have left it, which for a single
  // collapsed-cursor delete is always numerically `step.from` — and inserting
  // the phantom content back in at that same position leaves the selection
  // mapped to AFTER it (confirmed empirically, not assumed). That's correct
  // for a forward Delete (cursor doesn't move, so the next Delete should
  // land past the phantom, on real content) but wrong for Backspace, where
  // the cursor needs to move left of the phantom so the next Backspace keeps
  // walking into real, untouched content instead of sitting still.
  const isBackspace =
    insertedSize === 0 &&
    deletedSize > 0 &&
    oldState.selection.empty &&
    oldState.selection.from === step.to;

  const append = newState.tr;
  try {
    if (insertedSize > 0) {
      append.addMark(step.from, step.from + insertedSize, insertMark);
    }
    if (deletedSize > 0) {
      const reinsertAt = step.from + insertedSize;
      append.insert(reinsertAt, deletedSlice.content);
      append.addMark(reinsertAt, reinsertAt + deletedSize, deleteMark);
      if (isBackspace) {
        append.setSelection(TextSelection.create(append.doc, reinsertAt));
      }
      // Forward Delete (cursor was at step.from, i.e. before the deleted
      // range) needs no override: the default post-insert mapping already
      // lands the cursor after the phantom span, which is what we want.
    }
  } catch (err) {
    console.warn("[lightbook-prosemirror] suggestion rewrite failed, applying edit untracked", err);
    return null;
  }

  return append;
}

export function suggestionPlugin(getAuthorId: () => string) {
  return new Plugin<SuggestionState>({
    key: suggestionPluginKey,
    state: {
      init() {
        return { active: null } as SuggestionState;
      },
      apply(tr, value) {
        const meta = tr.getMeta(suggestionPluginKey);
        if (meta?.setActive !== undefined) {
          return { active: meta.setActive };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        return buildDecorations(state.doc);
      },
    },
    appendTransaction(transactions, oldState, newState) {
      const pluginState = suggestionPluginKey.getState(oldState);
      if (!pluginState?.active) return null;

      const userEdit = transactions.find(
        (tr) => tr.docChanged && !tr.getMeta("suggestion-rewrite")
      );
      if (!userEdit) return null;

      const append = buildSuggestionAppend(
        userEdit,
        oldState,
        newState,
        pluginState.active.authorId
      );
      if (!append) return null;

      append.setMeta("suggestion-rewrite", true);
      return append;
    },
  });
}

export function setSuggesting(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  authorId: string | null
) {
  if (dispatch) {
    dispatch(
      state.tr.setMeta(suggestionPluginKey, {
        setActive: authorId ? { authorId } : null,
      })
    );
  }
  return true;
}

/** Accept a suggestion: drop deleted text for real, strip insert/delete marks. */
export function acceptSuggestion(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  suggestionId: string
) {
  const tr = state.tr;
  const deletions: Array<[number, number]> = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const del = node.marks.find(
      (m) => m.type.name === "suggestion_delete" && m.attrs.id === suggestionId
    );
    const ins = node.marks.find(
      (m) => m.type.name === "suggestion_insert" && m.attrs.id === suggestionId
    );
    if (del) deletions.push([pos, pos + node.nodeSize]);
    if (ins) tr.removeMark(pos, pos + node.nodeSize, ins);
  });
  // Delete ranges back-to-front so earlier positions stay valid.
  for (const [from, to] of deletions.sort((a, b) => b[0] - a[0])) {
    tr.delete(tr.mapping.map(from), tr.mapping.map(to));
  }
  // If suggesting mode is still active, the suggestion plugin's
  // appendTransaction would otherwise re-intercept THIS transaction's own
  // delete and turn it right back into a (new) tracked suggestion instead
  // of actually resolving the one being accepted. Bypass it explicitly.
  tr.setMeta("suggestion-rewrite", true);
  if (dispatch) dispatch(tr);
  return true;
}

/** Reject a suggestion: drop inserted text, restore deleted text (strip the delete mark). */
export function rejectSuggestion(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  suggestionId: string
) {
  const tr = state.tr;
  const insertions: Array<[number, number]> = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const del = node.marks.find(
      (m) => m.type.name === "suggestion_delete" && m.attrs.id === suggestionId
    );
    const ins = node.marks.find(
      (m) => m.type.name === "suggestion_insert" && m.attrs.id === suggestionId
    );
    if (ins) insertions.push([pos, pos + node.nodeSize]);
    if (del) tr.removeMark(pos, pos + node.nodeSize, del);
  });
  for (const [from, to] of insertions.sort((a, b) => b[0] - a[0])) {
    tr.delete(tr.mapping.map(from), tr.mapping.map(to));
  }
  // See acceptSuggestion: bypass re-interception while suggesting is active.
  tr.setMeta("suggestion-rewrite", true);
  if (dispatch) dispatch(tr);
  return true;
}
