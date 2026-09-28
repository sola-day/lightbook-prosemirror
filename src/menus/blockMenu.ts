import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { setBlockType } from "prosemirror-commands";
import { wrapInList } from "prosemirror-schema-list";
import { NodeType } from "prosemirror-model";
import { lightbookSchema as schema } from "../schema";

interface MenuItem {
  label: string;
  icon: string;
  shortcut?: string;
  groupStart?: boolean;
  /** Extra terms that match this item when typed after "/" (e.g. "h1" for "Big heading"). */
  keywords?: string[];
  run: (view: EditorView) => void;
}

interface SlashState {
  /** Position of the "/" character itself. */
  from: number;
  query: string;
}

interface BlockMenuState {
  slash: SlashState | null;
}

const blockMenuKey = new PluginKey<BlockMenuState>("lightbook-block-menu");

function headingItem(level: number, label: string): MenuItem {
  return {
    label,
    icon: `H${level}`,
    shortcut: `⌃⇧${level}`,
    keywords: [`h${level}`, "heading"],
    run(view) {
      setBlockType(schema.nodes.heading, { level })(view.state, view.dispatch);
    },
  };
}

function listItem(label: string, icon: string, listType: NodeType, shortcut: string, keywords: string[], groupStart = false): MenuItem {
  return {
    label,
    icon,
    shortcut,
    groupStart,
    keywords,
    run(view) {
      wrapInList(listType)(view.state, view.dispatch);
    },
  };
}

function insertBlockAtSelection(view: EditorView, node: import("prosemirror-model").Node) {
  const tr = view.state.tr.replaceSelectionWith(node);
  view.dispatch(tr);
}

function buildItems(): MenuItem[] {
  return [
    headingItem(1, "Big heading"),
    headingItem(2, "Medium heading"),
    headingItem(3, "Small heading"),
    headingItem(4, "Extra small heading"),
    listItem("Todo list", "☑", schema.nodes.checkbox_list, "⌃⇧7", ["todo", "checkbox", "task"], true),
    listItem("Bulleted list", "•", schema.nodes.bullet_list, "⌃⇧8", ["bullet", "ul"]),
    listItem("Ordered list", "1.", schema.nodes.ordered_list, "⌃⇧9", ["numbered", "ol"]),
    {
      label: "Image",
      icon: "🖼",
      groupStart: true,
      keywords: ["picture", "photo"],
      run(view) {
        const src = window.prompt("Image URL");
        if (!src) return;
        insertBlockAtSelection(view, schema.nodes.image.create({ src }));
      },
    },
    {
      label: "Video",
      icon: "▶",
      keywords: ["embed"],
      run(view) {
        const src = window.prompt("Video URL");
        if (!src) return;
        insertBlockAtSelection(view, schema.nodes.video.create({ src }));
      },
    },
  ];
}

function matchesQuery(item: MenuItem, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  if (item.label.toLowerCase().includes(q)) return true;
  return !!item.keywords?.some((k) => k.startsWith(q));
}

/**
 * Detects a live "/command" typed at the cursor: a "/" preceded by either
 * the start of the text block or whitespace, with no whitespace between it
 * and the cursor (so "a/b" doesn't trigger, but "type / " does, and typing
 * further letters narrows `query`). Returns null once the pattern breaks
 * (space typed, slash deleted, selection no longer collapsed, etc).
 */
function detectSlash(input: { selection: import("prosemirror-state").Selection }): SlashState | null {
  const { selection } = input;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock) return null;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const match = /(?:^|\s)\/([a-zA-Z0-9]*)$/.exec(textBefore);
  if (!match) return null;
  const query = match[1];
  const from = $from.pos - query.length - 1;
  return { from, query };
}

/**
 * Outline/Notion-style block-insert menu with two triggers:
 *  - a "+" handle in the left margin (click to open),
 *  - typing "/" at the cursor (filters items as you keep typing, Up/Down to
 *    navigate, Enter/click to run, Escape or a space/mismatch to cancel).
 * Both open the same dropdown and the same `MenuItem` list.
 */
export function blockMenuPlugin() {
  const items = buildItems();

  return new Plugin<BlockMenuState>({
    key: blockMenuKey,
    state: {
      init() {
        return { slash: null };
      },
      apply(tr, value) {
        if (tr.getMeta(blockMenuKey)?.forceClose) return { slash: null };
        if (!tr.docChanged && !tr.selectionSet) return value;
        return { slash: detectSlash(tr) };
      },
    },
    view(view) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "lb-block-handle";
      handle.textContent = "+";
      handle.title = "Insert block (or type / )";

      const menu = document.createElement("div");
      menu.className = "lb-block-menu";
      menu.style.display = "none";

      let openMode: "handle" | "slash" | null = null;
      let selectedIndex = 0;
      let visibleItems: MenuItem[] = items;

      function runItem(item: MenuItem, slash: SlashState | null) {
        if (slash) {
          const tr = view.state.tr.delete(slash.from, slash.from + 1 + slash.query.length);
          view.dispatch(tr);
        }
        item.run(view);
        closeMenu();
        view.focus();
      }

      function renderMenu(query: string, slash: SlashState | null) {
        visibleItems = items.filter((item) => matchesQuery(item, query));
        selectedIndex = 0;
        menu.innerHTML = "";
        if (visibleItems.length === 0) {
          const empty = document.createElement("div");
          empty.className = "lb-block-menu-empty";
          empty.textContent = "No matching blocks";
          menu.appendChild(empty);
          return;
        }
        visibleItems.forEach((item, index) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "lb-block-menu-item";
          if (item.groupStart) row.classList.add("lb-block-menu-group-start");
          if (index === selectedIndex) row.classList.add("active");
          row.innerHTML = `<span class="lb-block-menu-icon">${item.icon}</span><span class="lb-block-menu-label">${item.label}</span>${
            item.shortcut ? `<span class="lb-block-menu-shortcut">${item.shortcut}</span>` : ""
          }`;
          row.addEventListener("mousedown", (event) => {
            event.preventDefault();
            runItem(item, slash);
          });
          menu.appendChild(row);
        });
      }

      function highlight(index: number) {
        selectedIndex = (index + visibleItems.length) % visibleItems.length;
        Array.from(menu.children).forEach((child, i) => child.classList.toggle("active", i === selectedIndex));
      }

      function closeMenu() {
        openMode = null;
        menu.style.display = "none";
        if (blockMenuKey.getState(view.state)?.slash) {
          view.dispatch(view.state.tr.setMeta(blockMenuKey, { forceClose: true }));
        }
      }

      function positionMenuAt(left: number, top: number) {
        menu.style.display = "block";
        const hostBox = (menu.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? { top: 0, left: 0 };
        menu.style.left = `${left - hostBox.left}px`;
        menu.style.top = `${top - hostBox.top}px`;
      }

      function openViaHandle() {
        openMode = "handle";
        renderMenu("", null);
        const handleBox = handle.getBoundingClientRect();
        positionMenuAt(handleBox.left, handleBox.bottom + 4);
      }

      function openOrUpdateViaSlash(slash: SlashState) {
        openMode = "slash";
        renderMenu(slash.query, slash);
        const coords = view.coordsAtPos(slash.from);
        positionMenuAt(coords.left, coords.bottom + 4);
      }

      handle.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (openMode === "handle") closeMenu();
        else openViaHandle();
      });

      const onDocMouseDown = (event: MouseEvent) => {
        if (openMode === "handle" && !menu.contains(event.target as Node) && event.target !== handle) {
          closeMenu();
        }
      };
      document.addEventListener("mousedown", onDocMouseDown);

      // Arrow/Enter navigation while the slash menu is open. Runs in the
      // capture phase so it wins over ProseMirror's own keydown handling
      // (which would otherwise move the cursor / insert a newline).
      const onKeyDown = (event: KeyboardEvent) => {
        if (openMode !== "slash" || visibleItems.length === 0) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          highlight(selectedIndex + 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          highlight(selectedIndex - 1);
        } else if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const slash = blockMenuKey.getState(view.state)?.slash ?? null;
          runItem(visibleItems[selectedIndex], slash);
        }
      };
      view.dom.addEventListener("keydown", onKeyDown, true);

      const host = view.dom.parentElement;
      if (host) {
        const computed = window.getComputedStyle(host);
        if (computed.position === "static") host.style.position = "relative";
        host.appendChild(handle);
        host.appendChild(menu);
      }

      function update(view: EditorView) {
        const { state } = view;
        const slash = blockMenuKey.getState(state)?.slash ?? null;

        if (slash) {
          openOrUpdateViaSlash(slash);
        } else if (openMode === "slash") {
          closeMenu();
        }

        const { selection } = state;
        if (!(selection instanceof TextSelection) || !selection.empty || slash) {
          handle.style.display = "none";
          if (openMode === "handle") closeMenu();
          return;
        }
        const hostBox = (handle.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? { top: 0, left: 0 };
        const lineStart = view.coordsAtPos(selection.$from.start());
        handle.style.display = "flex";
        handle.style.top = `${lineStart.top - hostBox.top}px`;
        handle.style.left = "4px";
      }

      update(view);
      return {
        update,
        destroy() {
          document.removeEventListener("mousedown", onDocMouseDown);
          view.dom.removeEventListener("keydown", onKeyDown, true);
          handle.remove();
          menu.remove();
        },
      };
    },
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Escape") return false;
        if (!blockMenuKey.getState(view.state)?.slash) return false;
        view.dispatch(view.state.tr.setMeta(blockMenuKey, { forceClose: true }));
        return true;
      },
    },
  });
}
