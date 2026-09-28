import { EditorState, Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history } from "prosemirror-history";
import { dropCursor } from "prosemirror-dropcursor";
import { gapCursor } from "prosemirror-gapcursor";
import { inputRules, wrappingInputRule, textblockTypeInputRule } from "prosemirror-inputrules";
import { columnResizing, tableEditing } from "prosemirror-tables";
import { lightbookSchema as schema } from "./schema";
import { buildKeymap } from "./keymap";
import { commentsPlugin, suggestionPlugin } from "./comments";
import { selectionToolbarPlugin, blockMenuPlugin } from "./menus";
import { CheckboxItemView } from "./nodeviews/checkboxItem";
import type { CollabSetup } from "./collab";

export { lightbookSchema } from "./schema";
export { markdownToDoc, docToMarkdown } from "./markdown";
export { createCollab, bridgeLoroDocs, bridgeEphemeralStores } from "./collab";
export type { CollabSetup, CollabUser } from "./collab";
export * from "./comments";
export * from "./menus";

function inputRuleSet() {
  return inputRules({
    rules: [
      wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
      wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        schema.nodes.ordered_list,
        (match) => ({ order: +match[1] }),
        (match, node) => node.childCount + node.attrs.order === +match[1]
      ),
      textblockTypeInputRule(/^(#{1,4})\s$/, schema.nodes.heading, (match) => ({
        level: match[1].length,
      })),
      textblockTypeInputRule(/^```$/, schema.nodes.code_block),
    ],
  });
}

export interface CreateEditorOptions {
  mount: HTMLElement;
  doc?: import("prosemirror-model").Node;
  authorId: string;
  collab?: CollabSetup;
  editable?: () => boolean;
  onChange?: (state: EditorState) => void;
  /** Called after a comment thread is created via the selection toolbar. */
  onComment?: (threadId: string, from: number, to: number) => void;
  /** Show the Outline-style floating selection toolbar. Defaults to true. */
  toolbar?: boolean;
  /** Show the "+" block-insert handle/menu in the left margin. Defaults to true. */
  blockMenu?: boolean;
}

/**
 * Assemble a full lightbook-prosemirror editor: base schema, markdown-style
 * input rules, tables, comments, suggestion mode, and (optionally) realtime
 * Loro CRDT collaboration. This is the single entry point apps (Lightbook web,
 * the example page, eventually a rewritten Outline editor) are meant to use.
 */
export function createEditor(options: CreateEditorOptions): EditorView {
  const plugins: Plugin[] = [
    inputRuleSet(),
    buildKeymap(),
    dropCursor(),
    gapCursor(),
    columnResizing(),
    tableEditing(),
    commentsPlugin(),
    suggestionPlugin(() => options.authorId),
  ];

  if (options.toolbar ?? true) {
    plugins.push(selectionToolbarPlugin({ onComment: options.onComment }));
  }
  if (options.blockMenu ?? true) {
    plugins.push(blockMenuPlugin());
  }

  if (options.collab) {
    // Loro's collaborative undo (LoroUndoPlugin) replaces prosemirror-history's
    // local undo stack.
    plugins.push(...options.collab.plugins);
  } else {
    plugins.push(history());
  }

  const state = EditorState.create({
    schema,
    doc: options.collab ? undefined : options.doc,
    plugins,
  });

  const view = new EditorView(options.mount, {
    state,
    editable: options.editable ?? (() => true),
    nodeViews: {
      checkbox_item: (node, editorView, getPos) =>
        new CheckboxItemView(node, editorView, getPos),
    },
  });

  view.setProps({
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      options.onChange?.(next);
    },
  });

  return view;
}
