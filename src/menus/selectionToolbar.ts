import { Plugin, PluginKey, EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { toggleMark, setBlockType, wrapIn } from "prosemirror-commands";
import { wrapInList } from "prosemirror-schema-list";
import { MarkType, NodeType } from "prosemirror-model";
import { lightbookSchema as schema } from "../schema";
import { addComment } from "../comments/plugin";

export interface SelectionToolbarOptions {
  /** Called after a comment thread is created via the toolbar's comment button. */
  onComment?: (threadId: string, from: number, to: number) => void;
}

type Dispatch = (tr: import("prosemirror-state").Transaction) => void;

interface ToolbarButton {
  label: string;
  title: string;
  isActive?: (state: EditorState) => boolean;
  run: (state: EditorState, dispatch: Dispatch) => void;
  /** Inserts a visual separator before this button. */
  groupStart?: boolean;
}

function markActive(state: EditorState, markType: MarkType) {
  const { from, to, empty } = state.selection;
  if (empty) return !!markType.isInSet(state.storedMarks || state.selection.$from.marks());
  return state.doc.rangeHasMark(from, to, markType);
}

function blockActive(state: EditorState, nodeType: NodeType, attrs: Record<string, unknown> = {}) {
  const { $from, to } = state.selection;
  return to <= $from.end() && $from.parent.hasMarkup(nodeType, attrs);
}

function heading(level: number): ToolbarButton {
  return {
    label: `H${level}`,
    title: `Heading ${level}`,
    isActive: (s) => blockActive(s, schema.nodes.heading, { level }),
    run: (s, d) => setBlockType(schema.nodes.heading, { level })(s, d),
  };
}

function mark(label: string, title: string, markType: MarkType, promptForHref = false): ToolbarButton {
  return {
    label,
    title,
    isActive: (s) => markActive(s, markType),
    run: (s, d) => {
      if (promptForHref) {
        if (markActive(s, markType)) {
          toggleMark(markType)(s, d);
          return;
        }
        const href = window.prompt("Link URL");
        if (!href) return;
        toggleMark(markType, { href })(s, d);
        return;
      }
      toggleMark(markType)(s, d);
    },
  };
}

function buildButtons(options: SelectionToolbarOptions): ToolbarButton[] {
  return [
    heading(1),
    heading(2),
    heading(3),
    {
      label: "”",
      title: "Blockquote",
      isActive: (s) => blockActive(s, schema.nodes.blockquote),
      run: (s, d) => wrapIn(schema.nodes.blockquote)(s, d),
    },
    {
      label: "✕",
      title: "Clear formatting",
      groupStart: true,
      run: (s, d) => {
        const { from, to } = s.selection;
        const tr = s.tr;
        for (const markType of Object.values(schema.marks)) {
          if (markType === schema.marks.comment || markType.name.startsWith("suggestion_")) continue;
          tr.removeMark(from, to, markType);
        }
        d(tr);
      },
    },
    {
      label: "☑",
      title: "Todo list",
      groupStart: true,
      run: (s, d) => wrapInList(schema.nodes.checkbox_list)(s, d),
    },
    {
      label: "•",
      title: "Bulleted list",
      run: (s, d) => wrapInList(schema.nodes.bullet_list)(s, d),
    },
    {
      label: "1.",
      title: "Ordered list",
      run: (s, d) => wrapInList(schema.nodes.ordered_list)(s, d),
    },
    { ...mark("B", "Bold (⌘B)", schema.marks.bold), groupStart: true },
    mark("I", "Italic (⌘I)", schema.marks.italic),
    mark("S", "Strikethrough (⌘⇧X)", schema.marks.strikethrough),
    mark("✎", "Highlight (⌘⇧H)", schema.marks.highlight),
    mark("</>", "Code (⌘E)", schema.marks.code),
    mark("🔗", "Link", schema.marks.link, true),
    {
      label: "💬",
      title: "Comment on selection",
      groupStart: true,
      run: (s, d) => {
        const { from, to } = s.selection;
        if (from === to) return;
        const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        addComment(s, d, { threadId, from, to });
        options.onComment?.(threadId, from, to);
      },
    },
  ];
}

/**
 * Floating selection toolbar (Outline/Google-Docs style): appears above a
 * non-empty text selection with block-type, formatting, link, and comment
 * controls. Purely a `view`-based plugin — it never touches editor state
 * itself beyond running the same commands a keyboard shortcut would.
 */
export function selectionToolbarPlugin(options: SelectionToolbarOptions = {}) {
  const buttons = buildButtons(options);
  return new Plugin({
    key: new PluginKey("lightbook-selection-toolbar"),
    view(view) {
      const dom = document.createElement("div");
      dom.className = "lb-toolbar-float";
      dom.style.display = "none";

      const entries = buttons.map((spec) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "lb-toolbar-btn";
        if (spec.groupStart) el.classList.add("lb-toolbar-group-start");
        el.textContent = spec.label;
        el.title = spec.title;
        el.addEventListener("mousedown", (event) => {
          event.preventDefault();
          spec.run(view.state, view.dispatch);
          view.focus();
        });
        dom.appendChild(el);
        return { el, spec };
      });

      const host = view.dom.parentElement;
      if (host) {
        const computed = window.getComputedStyle(host);
        if (computed.position === "static") host.style.position = "relative";
        host.appendChild(dom);
      }

      function update(view: EditorView) {
        const { state } = view;
        const { selection } = state;
        if (selection.empty || !(selection instanceof TextSelection) || !view.hasFocus()) {
          dom.style.display = "none";
          return;
        }
        dom.style.display = "flex";
        for (const { el, spec } of entries) {
          el.classList.toggle("active", !!spec.isActive?.(state));
        }
        const { from, to } = selection;
        const start = view.coordsAtPos(from);
        const end = view.coordsAtPos(to);
        const hostBox = (dom.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? {
          top: 0,
          left: 0,
        };
        const left = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
        const top = Math.min(start.top, end.top);
        dom.style.left = `${left - hostBox.left - dom.offsetWidth / 2}px`;
        dom.style.top = `${top - hostBox.top - dom.offsetHeight - 10}px`;
      }

      update(view);
      return {
        update,
        destroy() {
          dom.remove();
        },
      };
    },
  });
}
