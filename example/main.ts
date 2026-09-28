import { LoroDoc } from "loro-crdt";
import {
  createEditor,
  createCollab,
  bridgeLoroDocs,
  bridgeEphemeralStores,
  docToMarkdown,
  markdownToDoc,
  addComment,
  listThreads,
  setActiveThread,
  setSuggesting,
  suggestionPluginKey,
} from "../src/index";
import "../src/style.css";
import "./example.css";

const userA = { name: "Alice", color: "#4285f4" };
const userB = { name: "Bob", color: "#ea4335" };

document.getElementById("user-a-badge")!.textContent = userA.name;
(document.getElementById("user-a-badge") as HTMLElement).style.background = userA.color;
document.getElementById("user-b-badge")!.textContent = userB.name;
(document.getElementById("user-b-badge") as HTMLElement).style.background = userB.color;

// Two editors, two INDEPENDENT LoroDoc peers — this is the real-time
// collaboration demo. Unlike Yjs's single shared Y.Doc, each Loro peer owns
// its own document; `bridgeLoroDocs`/`bridgeEphemeralStores` forward each
// side's local update bytes to the other in-memory, simulating exactly what
// a websocket/webrtc relay would carry over the network.
const docA = new LoroDoc();
const docB = new LoroDoc();
const collabA = createCollab(docA, userA);
const collabB = createCollab(docB, userB);
bridgeLoroDocs(docA, docB);
bridgeEphemeralStores(collabA.presence, collabB.presence);

const viewA = createEditor({
  mount: document.getElementById("editor-a")!,
  authorId: "alice",
  collab: collabA,
  onChange: () => refreshThreadList(),
});

const viewB = createEditor({
  mount: document.getElementById("editor-b")!,
  authorId: "bob",
  collab: collabB,
});

// --- Comments -------------------------------------------------------------

function refreshThreadList() {
  const list = document.getElementById("thread-list")!;
  const threads = listThreads(viewA.state);
  list.innerHTML = "";
  if (threads.size === 0) {
    list.innerHTML = `<li style="cursor:default;color:#999">No comments yet — select text in Editor A and click "Comment on selection".</li>`;
    return;
  }
  for (const [threadId, range] of threads) {
    const li = document.createElement("li");
    li.textContent = `"${range.text.slice(0, 40)}${range.text.length > 40 ? "…" : ""}"`;
    li.onmouseenter = () => setActiveThread(viewA, threadId);
    li.onmouseleave = () => setActiveThread(viewA, null);
    list.appendChild(li);
  }
}

document.getElementById("btn-comment")!.addEventListener("click", () => {
  const { from, to } = viewA.state.selection;
  if (from === to) {
    alert("Select some text in Editor A first.");
    return;
  }
  const threadId = `thread-${Date.now()}`;
  addComment(viewA.state, viewA.dispatch, { threadId, from, to });
  refreshThreadList();
});

// --- Suggestion mode --------------------------------------------------------

const suggestBtn = document.getElementById("btn-suggest") as HTMLButtonElement;
const suggestStatus = document.getElementById("suggest-status")!;

suggestBtn.addEventListener("click", () => {
  const current = suggestionPluginKey.getState(viewA.state)?.active;
  setSuggesting(viewA.state, viewA.dispatch, current ? null : "alice");
  const next = suggestionPluginKey.getState(viewA.state)?.active;
  suggestBtn.classList.toggle("active", !!next);
  suggestStatus.textContent = next ? "Suggesting as Alice — edits are tracked" : "";
});

refreshThreadList();

// --- Markdown import/export -------------------------------------------------

document.getElementById("btn-export-md")!.addEventListener("click", () => {
  const markdown = docToMarkdown(viewA.state.doc);
  (document.getElementById("md-output") as HTMLTextAreaElement).value = markdown;
});

let mdView: ReturnType<typeof createEditor> | null = null;

document.getElementById("btn-import-md")!.addEventListener("click", () => {
  const text = (document.getElementById("md-input") as HTMLTextAreaElement).value;
  const doc = markdownToDoc(text || "# Empty document");
  const mount = document.getElementById("editor-md")!;
  mount.innerHTML = "";
  mdView = createEditor({ mount, authorId: "reader", doc });
});

// Seed Editor A with a starter document so the demo isn't blank.
if (viewA.state.doc.content.size <= 2) {
  const starter = markdownToDoc(
    [
      "# Welcome to lightbook-prosemirror",
      "",
      "This editor supports **bold**, *italic*, ~~strikethrough~~, `code`, tables, and lists.",
      "",
      "| Feature | Status |",
      "| --- | --- |",
      "| Tables | done |",
      "| Markdown | done |",
      "| Comments | done |",
      "| Suggesting | done |",
      "| Loro collab | done |",
      "",
      "- Try selecting a sentence and clicking **Comment on selection**",
      "- Try toggling **Suggesting** and typing a change",
    ].join("\n")
  );
  const tr = viewA.state.tr;
  tr.replaceWith(0, viewA.state.doc.content.size, starter.content);
  viewA.dispatch(tr);
}
