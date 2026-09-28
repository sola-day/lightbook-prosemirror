import { Plugin, PluginKey, EditorState, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { lightbookSchema as schema } from "../schema";

export const commentsPluginKey = new PluginKey<CommentsState>("lightbook-comments");

export interface CommentsState {
  /** threadId of the comment currently focused/hovered, drives highlight */
  activeThreadId: string | null;
}

export interface AddCommentOptions {
  threadId: string;
  from: number;
  to: number;
}

function buildDecorations(doc: import("prosemirror-model").Node, active: string | null) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== "comment") continue;
      const threadId = mark.attrs.threadId as string;
      decorations.push(
        Decoration.inline(pos, pos + node.nodeSize, {
          class:
            "lb-comment-range" + (threadId === active ? " lb-comment-range--active" : ""),
        })
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Tracks comment-anchor decorations and the currently focused thread. The
 * actual thread content (author, body, replies) lives outside the editor
 * (in the app's own store) and is keyed by the same threadId used here —
 * this plugin only owns *where in the document* a thread is anchored.
 */
export function commentsPlugin() {
  return new Plugin<CommentsState>({
    key: commentsPluginKey,
    state: {
      init(_, state) {
        return { activeThreadId: null } as CommentsState;
      },
      apply(tr, value) {
        const meta = tr.getMeta(commentsPluginKey);
        if (meta?.setActiveThread !== undefined) {
          return { activeThreadId: meta.setActiveThread };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        const pluginState = commentsPluginKey.getState(state);
        return buildDecorations(state.doc, pluginState?.activeThreadId ?? null);
      },
    },
  });
}

export function addComment(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  { threadId, from, to }: AddCommentOptions
) {
  if (from === to) return false;
  const mark = schema.marks.comment.create({ threadId });
  if (dispatch) {
    dispatch(state.tr.addMark(from, to, mark));
  }
  return true;
}

export function removeComment(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  threadId: string
) {
  let found = false;
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find(
      (m) => m.type.name === "comment" && m.attrs.threadId === threadId
    );
    if (mark) {
      found = true;
      tr.removeMark(pos, pos + node.nodeSize, mark);
    }
  });
  if (found && dispatch) dispatch(tr);
  return found;
}

export function setActiveThread(view: EditorView, threadId: string | null) {
  view.dispatch(view.state.tr.setMeta(commentsPluginKey, { setActiveThread: threadId }));
}

/** List every distinct comment thread currently anchored in the doc, with its text range. */
export function listThreads(state: EditorState) {
  const threads = new Map<string, { from: number; to: number; text: string }>();
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== "comment") continue;
      const threadId = mark.attrs.threadId as string;
      const existing = threads.get(threadId);
      if (existing) {
        existing.to = pos + node.nodeSize;
        existing.text += node.text ?? "";
      } else {
        threads.set(threadId, { from: pos, to: pos + node.nodeSize, text: node.text ?? "" });
      }
    }
  });
  return threads;
}
