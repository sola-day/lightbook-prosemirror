import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  createEditor,
  createCollab,
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

const ydoc = new Y.Doc();
const awareness = new Awareness(ydoc);

const userA = { name: "Alice", color: "#4285f4" };
const userB = { name: "Bob", color: "#ea4335" };

document.getElementById("user-a-badge")!.textContent = userA.name;
(document.getElementById("user-a-badge") as HTMLElement).style.background = userA.color;
document.getElementById("user-b-badge")!.textContent = userB.name;
(document.getElementById("user-b-badge") as HTMLElement).style.background = userB.color;

// Two editors sharing one Y.Doc — this is the real-time collaboration demo.
// Each gets its own Awareness client state (cursor color/name) but they are
// bound to the SAME underlying ydoc, so edits in one instantly propagate to
// the other purely in-memory (no network needed for the demo).
const collabA = createCollab(ydoc, userA, awareness);
const viewA = createEditor({
  mount: document.getElementById("editor-a")!,
  authorId: "alice",
  collab: collabA,
  onChange: () => refreshThreadList(),
});

const ydocBView = ydoc; // same doc; a second Awareness client simulates a second peer
const awarenessB = new Awareness(ydocBView);
const collabB = createCollab(ydocBView, userB, awarenessB);
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
      "| Yjs collab | done |",
      "",
      "- Try selecting a sentence and clicking **Comment on selection**",
      "- Try toggling **Suggesting** and typing a change",
    ].join("\n")
  );
  const tr = viewA.state.tr;
  tr.replaceWith(0, viewA.state.doc.content.size, starter.content);
  viewA.dispatch(tr);
}
