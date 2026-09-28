import { Plugin, PluginKey, EditorState, Transaction, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { ReplaceStep } from "prosemirror-transform";
import { isHistoryTransaction } from "prosemirror-history";
import { lightbookSchema as schema } from "../schema";

export const suggestionPluginKey = new PluginKey<SuggestionState>("lightbook-suggestion");

/** Where in the doc a still-pending suggestionId's tagged span(s) currently are. */
interface SuggestionRange {
  insertFrom?: number;
  insertTo?: number;
  deleteFrom?: number;
  deleteTo?: number;
}

export interface SuggestionState {
  /** Non-null while the editor is in "Suggesting" mode; carries the current author. */
  active: { authorId: string } | null;
  /**
   * suggestionId -> its current position range(s), kept incrementally in
   * sync (see `apply` below) instead of being recomputed by scanning the
   * whole document. `acceptSuggestion`/`rejectSuggestion` read straight from
   * this instead of a `doc.descendants` walk, so resolving a suggestion is
   * O(pending suggestions) rather than O(document size) — the walk-based
   * version got measurably slower as a document (and its edit history)
   * grew, independent of how many suggestions were actually outstanding.
   */
  ranges: Map<string, SuggestionRange>;
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

/** Remaps a stored [from, to) range through a transaction's position changes; returns null if it collapsed. */
function mapRange(tr: Transaction, from: number, to: number): [number, number] | null {
  const mappedFrom = tr.mapping.map(from, 1);
  const mappedTo = tr.mapping.map(to, -1);
  return mappedTo > mappedFrom ? [mappedFrom, mappedTo] : null;
}

function remapRanges(tr: Transaction, ranges: Map<string, SuggestionRange>): Map<string, SuggestionRange> {
  const next = new Map<string, SuggestionRange>();
  for (const [id, entry] of ranges) {
    const remapped: SuggestionRange = {};
    if (entry.insertFrom != null && entry.insertTo != null) {
      const mapped = mapRange(tr, entry.insertFrom, entry.insertTo);
      if (mapped) [remapped.insertFrom, remapped.insertTo] = mapped;
    }
    if (entry.deleteFrom != null && entry.deleteTo != null) {
      const mapped = mapRange(tr, entry.deleteFrom, entry.deleteTo);
      if (mapped) [remapped.deleteFrom, remapped.deleteTo] = mapped;
    }
    // Drop the id entirely once both its pieces have collapsed (e.g. the
    // pending insertion got backspaced away for real — see the
    // "allPendingInsert" pass-through below) rather than keeping a
    // degenerate zero-width entry around forever.
    if (remapped.insertFrom != null || remapped.deleteFrom != null) next.set(id, remapped);
  }
  return next;
}

interface SuggestionEdit {
  tr: Transaction;
  id: string;
  insertRange: [number, number] | null;
  deleteRange: [number, number] | null;
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
 *
 * The returned `insertRange`/`deleteRange` are positions in `append`'s own
 * resulting doc (not `newState`'s) — computed once here rather than
 * re-derived by scanning, so the plugin's `apply` can record them directly
 * into `SuggestionState.ranges` for `acceptSuggestion`/`rejectSuggestion` to
 * use later without a doc walk.
 */
function buildSuggestionAppend(
  userEdit: Transaction,
  oldState: EditorState,
  newState: EditorState,
  authorId: string
): SuggestionEdit | null {
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
  // `newState`'s already-real deletion stands untouched (and `apply` below
  // will naturally shrink/drop that id's `insertRange` via `remapRanges`).
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
  let insertRange: [number, number] | null = null;
  let deleteRange: [number, number] | null = null;
  try {
    if (insertedSize > 0) {
      append.addMark(step.from, step.from + insertedSize, insertMark);
      // Valid as final positions in `append`'s resulting doc: nothing this
      // function does afterwards inserts/deletes content *before*
      // `step.from + insertedSize` (the later reinsert, if any, always
      // lands at exactly that boundary or later — see below), only
      // addMark/removeMark calls, which never shift positions.
      insertRange = [step.from, step.from + insertedSize];
    }
    if (deletedSize > 0) {
      const reinsertAt = step.from + insertedSize;
      append.insert(reinsertAt, deletedSlice.content);
      append.addMark(reinsertAt, reinsertAt + deletedSize, deleteMark);
      deleteRange = [reinsertAt, reinsertAt + deletedSize];
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

  return { tr: append, id, insertRange, deleteRange };
}

export function suggestionPlugin(getAuthorId: () => string) {
  return new Plugin<SuggestionState>({
    key: suggestionPluginKey,
    state: {
      init() {
        return { active: null, ranges: new Map() } as SuggestionState;
      },
      apply(tr, value) {
        const meta = tr.getMeta(suggestionPluginKey);
        const active = meta?.setActive !== undefined ? meta.setActive : value.active;

        let ranges = tr.docChanged ? remapRanges(tr, value.ranges) : value.ranges;
        if (meta?.removeRange) {
          if (ranges === value.ranges) ranges = new Map(ranges);
          ranges.delete(meta.removeRange);
        }
        if (meta?.addRange) {
          if (ranges === value.ranges) ranges = new Map(ranges);
          const { id, ...entry } = meta.addRange as SuggestionRange & { id: string };
          ranges.set(id, entry);
        }

        return { active, ranges };
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

      // Undo/redo restores an old doc wholesale rather than applying an
      // incremental edit. Without this guard, undoing while still in
      // Suggesting mode would be picked up as `userEdit` below and get
      // rewrapped in a brand-new suggestion span on every Cmd+Z, the same
      // class of bug fixed in lightbook-lexical via $hasUpdateTag(HISTORIC_TAG)
      // — `isHistoryTransaction` is prosemirror-history's equivalent, public
      // API for "this transaction came from undo/redo".
      const userEdit = transactions.find(
        (tr) => tr.docChanged && !tr.getMeta("suggestion-rewrite") && !isHistoryTransaction(tr)
      );
      if (!userEdit) return null;

      const built = buildSuggestionAppend(userEdit, oldState, newState, pluginState.active.authorId);
      if (!built) return null;

      built.tr.setMeta("suggestion-rewrite", true);
      built.tr.setMeta(suggestionPluginKey, {
        addRange: {
          id: built.id,
          insertFrom: built.insertRange?.[0],
          insertTo: built.insertRange?.[1],
          deleteFrom: built.deleteRange?.[0],
          deleteTo: built.deleteRange?.[1],
        },
      });
      return built.tr;
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

/**
 * Shared accept/reject: `keep` says which side of the suggestion becomes
 * real content (its mark is stripped) — the other side is deleted outright.
 * Reads the range straight from `SuggestionState.ranges` (see its docstring)
 * instead of a `state.doc.descendants` walk.
 */
function resolveSuggestion(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  suggestionId: string,
  keep: "insert" | "delete"
): boolean {
  const pluginState = suggestionPluginKey.getState(state);
  const entry = pluginState?.ranges.get(suggestionId);
  // Already resolved (or never existed): cheap no-op, same as the old
  // walk-based version finding nothing to touch — just without the walk.
  if (!entry) return false;

  const tr = state.tr;
  const keepFrom = keep === "insert" ? entry.insertFrom : entry.deleteFrom;
  const keepTo = keep === "insert" ? entry.insertTo : entry.deleteTo;
  const dropFrom = keep === "insert" ? entry.deleteFrom : entry.insertFrom;
  const dropTo = keep === "insert" ? entry.deleteTo : entry.insertTo;

  if (keepFrom != null && keepTo != null) {
    // `suggestion_insert`/`suggestion_delete` are self-excluding (see
    // schema/marks.ts), so at most one mark of this type can be present in
    // a range this controller itself created — removing by MarkType is safe
    // and doesn't require re-deriving the exact Mark instance/attrs.
    const markType = keep === "insert" ? schema.marks.suggestion_insert : schema.marks.suggestion_delete;
    tr.removeMark(tr.mapping.map(keepFrom), tr.mapping.map(keepTo), markType);
  }
  if (dropFrom != null && dropTo != null) {
    tr.delete(tr.mapping.map(dropFrom), tr.mapping.map(dropTo));
  }

  // See the old version's comment: bypass re-interception while suggesting
  // is still active, and drop this id from the index now that it's fully
  // resolved (both remapping-to-collapse and this explicit removal matter:
  // remapping alone wouldn't clear the *kept* side, which never shrinks to
  // zero width — its mark is stripped, not deleted).
  tr.setMeta("suggestion-rewrite", true);
  tr.setMeta(suggestionPluginKey, { removeRange: suggestionId });
  if (dispatch) dispatch(tr);
  return true;
}

/** Accept a suggestion: drop deleted text for real, strip insert/delete marks. */
export function acceptSuggestion(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  suggestionId: string
) {
  return resolveSuggestion(state, dispatch, suggestionId, "insert");
}

/** Reject a suggestion: drop inserted text, restore deleted text (strip the delete mark). */
export function rejectSuggestion(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  suggestionId: string
) {
  return resolveSuggestion(state, dispatch, suggestionId, "delete");
}
