import { LoroDoc, type LoroEventBatch } from "loro-crdt";
import {
  LoroSyncPlugin,
  LoroUndoPlugin,
  LoroEphemeralCursorPlugin,
  CursorEphemeralStore,
  undo,
  redo,
  type LoroDocType,
} from "loro-prosemirror";
import { keymap } from "prosemirror-keymap";
import { Plugin } from "prosemirror-state";

export interface CollabUser {
  name: string;
  color: string;
}

export interface CollabSetup {
  loroDoc: LoroDoc;
  presence: CursorEphemeralStore;
  plugins: Plugin[];
}

/**
 * Bind a `LoroDoc` to the editor via loro-prosemirror: the document's root
 * map becomes the single source of truth for content (loro-prosemirror's
 * `LoroSyncPlugin` overwrites whatever initial doc `createEditor` was given
 * with whatever the LoroDoc already holds, the moment the view mounts), plus
 * collaborative undo/redo and per-user remote cursors via an
 * `EphemeralStore` (Loro's ephemeral/presence channel — the Loro analogue of
 * Yjs Awareness, but itself CRDT-free and timeout-expiring).
 *
 * Unlike Yjs's `Y.Doc` (a single mutable object multiple editors can share
 * directly in memory), each `LoroDoc` here is one independent peer: to keep
 * two peers in sync you exchange update bytes between them (see
 * `bridgeLoroDocs`/`bridgeEphemeralStores` below) — which is also a closer
 * simulation of real network sync than sharing one object would be.
 */
export function createCollab(
  doc: LoroDoc,
  user: CollabUser,
  presence: CursorEphemeralStore = new CursorEphemeralStore(doc.peerIdStr)
): CollabSetup {
  // loro-prosemirror's public types pin `doc` to a specific generic
  // instantiation (`LoroDocType`, with `doc`/`data` root containers) purely
  // for its own internal bookkeeping — the actual root map it reads/writes
  // (`ROOT_DOC_KEY`) is created lazily and works with any plain `LoroDoc`.
  const syncDoc = doc as unknown as LoroDocType;

  const plugins: Plugin[] = [
    LoroSyncPlugin({ doc: syncDoc }),
    LoroUndoPlugin({ doc }),
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Mod-Shift-z": redo,
    }),
    LoroEphemeralCursorPlugin(presence, {
      user,
      createCursor: (peerId) => {
        const all = presence.getAll();
        const remoteUser = all[peerId]?.user;
        const cursor = document.createElement("span");
        cursor.className = "lb-remote-cursor";
        cursor.style.borderColor = remoteUser?.color ?? "#999";
        const label = document.createElement("div");
        label.className = "lb-remote-cursor-label";
        label.style.backgroundColor = remoteUser?.color ?? "#999";
        label.textContent = remoteUser?.name ?? peerId;
        cursor.appendChild(label);
        return cursor;
      },
    }),
  ];

  return { loroDoc: doc, presence, plugins };
}

/**
 * Wires two independent `LoroDoc` peers together in-memory by forwarding
 * each side's locally-generated update bytes to the other, so edits made in
 * either editor converge on both — the CRDT merge itself is exactly what
 * would happen if these bytes had instead traveled over a websocket/webrtc
 * relay. Demo/testing helper; a real deployment replaces this with a
 * network transport carrying the same `doc.export({ mode: "update" })`
 * bytes.
 */
export function bridgeLoroDocs(a: LoroDoc, b: LoroDoc): () => void {
  const forward = (from: LoroDoc, to: LoroDoc) => (event: LoroEventBatch) => {
    if (event.by !== "local") return;
    to.import(from.export({ mode: "update" }));
  };
  const unsubA = a.subscribe(forward(a, b));
  const unsubB = b.subscribe(forward(b, a));
  return () => {
    unsubA();
    unsubB();
  };
}

/** Same idea as `bridgeLoroDocs`, but for the ephemeral cursor/presence channel. */
export function bridgeEphemeralStores(a: CursorEphemeralStore, b: CursorEphemeralStore): () => void {
  const unsubA = a.subscribeLocalUpdates((bytes) => b.apply(bytes));
  const unsubB = b.subscribeLocalUpdates((bytes) => a.apply(bytes));
  return () => {
    unsubA();
    unsubB();
  };
}
