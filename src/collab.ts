import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  ySyncPlugin,
  yCursorPlugin,
  yUndoPlugin,
  undo,
  redo,
} from "y-prosemirror";
import { keymap } from "prosemirror-keymap";
import { Plugin } from "prosemirror-state";

export interface CollabUser {
  name: string;
  color: string;
}

export interface CollabSetup {
  ydoc: Y.Doc;
  fragment: Y.XmlFragment;
  awareness: Awareness;
  plugins: Plugin[];
}

/**
 * Bind a Y.Doc's "prosemirror" XML fragment to the editor via y-prosemirror.
 * Two editor instances that share the same `ydoc` (or are synced over a
 * provider such as y-webrtc / a websocket relay) stay in real-time sync with
 * per-user cursors and collaborative undo, exactly like Outline's setup —
 * but wired up here from scratch for lightbook-prosemirror's own schema.
 */
export function createCollab(
  ydoc: Y.Doc,
  user: CollabUser,
  awareness: Awareness = new Awareness(ydoc)
): CollabSetup {
  const fragment = ydoc.getXmlFragment("prosemirror");
  awareness.setLocalStateField("user", user);

  const plugins: Plugin[] = [
    ySyncPlugin(fragment),
    yCursorPlugin(awareness, {
      cursorBuilder: (u: CollabUser) => {
        const cursor = document.createElement("span");
        cursor.className = "lb-remote-cursor";
        cursor.style.borderColor = u.color;
        const label = document.createElement("div");
        label.className = "lb-remote-cursor-label";
        label.style.backgroundColor = u.color;
        label.textContent = u.name;
        cursor.appendChild(label);
        return cursor;
      },
    }),
    yUndoPlugin(),
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Mod-Shift-z": redo,
    }),
  ];

  return { ydoc, fragment, awareness, plugins };
}
