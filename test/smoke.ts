/**
 * Headless regression tests for the parts of lightbook-prosemirror that
 * don't need a DOM: Markdown import/export and the comments/suggestion
 * command logic. Run with `pnpm test`.
 *
 * Every case here corresponds to a bug that actually shipped once and was
 * only caught by exercising the real code path end to end (not by
 * typechecking alone) — see each `assert` message for what broke.
 */
import { EditorState, Transaction, TextSelection } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { lightbookSchema as schema } from "../src/schema";
import {
  commentsPlugin,
  suggestionPlugin,
  addComment,
  listThreads,
  removeComment,
  setSuggesting,
  suggestionPluginKey,
  acceptSuggestion,
  rejectSuggestion,
} from "../src/comments";
import { markdownToDoc, docToMarkdown } from "../src/markdown";

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  -", msg);
  }
}

// --- Markdown: tables, task lists, bold/italic, images -------------------
{
  const input = [
    "# Title",
    "",
    "Some **bold** and *italic* and ~~strike~~ text.",
    "",
    "| a | b |",
    "| --- | :---: |",
    "| 1 | 2 |",
    "| hello | world |",
    "",
    "- [ ] todo item",
    "- [x] done item",
    "",
    "![alt text](https://example.com/x.png)",
  ].join("\n");

  const doc = markdownToDoc(input);
  assert(doc.content.size > 0, "markdown with a table and task list parses without throwing");

  const md = docToMarkdown(doc);
  assert(md.includes("**bold**"), "bold survives markdown export (mark named 'bold', not 'strong')");
  assert(md.includes("*italic*"), "italic survives markdown export (mark named 'italic', not 'em')");
  assert(md.includes("| --- | :---: |") || md.includes("| a | b |"), "table exports as GFM table");
  assert(md.includes("[ ] todo item"), "unchecked task list round-trips");
  assert(md.includes("[x] done item"), "checked task list round-trips");
  assert(md.includes("example.com/x.png"), "image round-trips through markdown");
}

// --- Blank (empty) paragraphs must survive export/import round-trip ------
{
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("First line")]),
    schema.node("paragraph", null, []),
    schema.node("paragraph", null, [schema.text("Second line, after a blank line")]),
  ]);

  const md = docToMarkdown(doc);
  assert(
    /First line\n\n.+\n\nSecond line/.test(md),
    "an intentionally empty paragraph is not silently dropped on export"
  );

  const reimported = markdownToDoc(md);
  const paragraphs: string[] = [];
  reimported.forEach((node) => {
    if (node.type.name === "paragraph") paragraphs.push(node.textContent);
  });
  assert(paragraphs.length === 3, "blank paragraph round-trips as its own paragraph, not merged away");
  assert(paragraphs[1] === "", "the middle paragraph comes back genuinely empty, not a literal marker character");
}

// --- Comments --------------------------------------------------------------
{
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Hello collaborative world")]),
    ]),
    plugins: [commentsPlugin(), suggestionPlugin(() => "alice")],
  });
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };

  addComment(state, dispatch, { threadId: "t1", from: 1, to: 6 });
  let threads = listThreads(state);
  assert(threads.size === 1 && threads.get("t1")!.text === "Hello", "comment thread anchors to selected text");

  removeComment(state, dispatch, "t1");
  assert(listThreads(state).size === 0, "comment thread removal clears the anchor");
}

// --- Suggestion mode: the "mismatched transaction" bug + stacking bug ----
{
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Hello collaborative world")]),
    ]),
    plugins: [commentsPlugin(), suggestionPlugin(() => "alice")],
  });
  let dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };

  setSuggesting(state, dispatch, "alice");
  assert(suggestionPluginKey.getState(state)?.active?.authorId === "alice", "suggesting mode toggles on");

  // This dispatch used to throw "Applying a mismatched transaction": the
  // suggestion plugin's appendTransaction built its replacement on oldState
  // instead of newState, which ProseMirror rejects.
  const insertPos = state.doc.content.size - 1;
  state = state.apply(state.tr.insertText(" typed", insertPos));
  let hasInsertMark = false;
  state.doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "suggestion_insert")) hasInsertMark = true;
  });
  assert(hasInsertMark, "typing while suggesting tags the insertion instead of crashing");

  const text = state.doc.textContent;
  const delFrom = 1 + text.indexOf("collaborative ");
  const delTo = delFrom + "collaborative ".length;
  state = state.apply(state.tr.delete(delFrom, delTo));
  assert(state.doc.textContent.includes("collaborative"), "deleting while suggesting keeps the text (struck through), doesn't remove it");

  let deleteSuggestionId: string | null = null;
  state.doc.descendants((node) => {
    const del = node.marks.find((m) => m.type.name === "suggestion_delete");
    if (del) deleteSuggestionId = del.attrs.id as string;
  });
  assert(!!deleteSuggestionId, "deleted range is tagged with a suggestion id");

  acceptSuggestion(state, dispatch, deleteSuggestionId!);
  assert(
    !state.doc.textContent.includes("collaborative "),
    "accepting a suggestion actually removes the deleted text (accept tx must bypass re-interception while still suggesting)"
  );

  // Second suggestion, adjacent to the first — this used to inherit the
  // first suggestion's mark (marks were non-exclusive) and rejecting the
  // second one incorrectly deleted the first one's text too.
  setSuggesting(state, dispatch, "bob");
  const before = state.doc.textContent;
  state = state.apply(state.tr.insertText("XXREJECTXX", state.doc.content.size - 1));

  let rejectId: string | null = null;
  state.doc.descendants((node) => {
    const ins = node.marks.find(
      (m) => m.type.name === "suggestion_insert" && node.text?.includes("XXREJECTXX")
    );
    if (ins) rejectId = ins.attrs.id as string;
  });
  assert(!!rejectId, "second, adjacent suggestion gets its own id");

  rejectSuggestion(state, dispatch, rejectId!);
  assert(
    state.doc.textContent === before,
    "rejecting one suggestion doesn't also remove an adjacent, unrelated suggestion's text (marks must self-exclude)"
  );
}

// --- Repeated forward-Delete while suggesting must not corrupt the doc ---
// Reported bug: "toggle suggestion" then holding/pressing Delete repeatedly
// garbled text (e.g. "typing a change" -> "typin g a change"), while a
// one-shot select-then-delete was fine. Root cause: deleted text isn't
// really removed in suggesting mode (it's reinserted + struck through), so
// the cursor must be explicitly placed after that reinserted span for a
// forward delete, or the next Delete press re-mangles the same span instead
// of advancing into real content.
{
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("abcdef")])]),
    plugins: [suggestionPlugin(() => "alice")],
  });
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };

  setSuggesting(state, dispatch, "alice");
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));

  // Simulate pressing forward Delete three times in a row at the same
  // logical spot, exactly like a user holding the Delete key.
  for (let i = 0; i < 3; i++) {
    const from = state.selection.from;
    state = state.apply(state.tr.delete(from, from + 1));
  }

  assert(state.doc.textContent === "abcdef", "nothing is actually removed while suggesting (still reversible)");

  const strikethroughOrder: string[] = [];
  const plainOrder: string[] = [];
  state.doc.descendants((node) => {
    if (!node.isText) return;
    if (node.marks.some((m) => m.type.name === "suggestion_delete")) {
      strikethroughOrder.push(node.text ?? "");
    } else {
      plainOrder.push(node.text ?? "");
    }
  });
  assert(
    strikethroughOrder.join("") === "abc",
    `three consecutive forward-deletes struck through "a", "b", "c" in order, not a jumbled/repeated span (got ${JSON.stringify(strikethroughOrder)})`
  );
  assert(
    plainOrder.join("") === "def",
    `the untouched remainder reads "def" left to right (got ${JSON.stringify(plainOrder)})`
  );
  assert(
    state.selection.from === 4,
    `cursor ends up right after the struck-through run, ready for the next real char (got ${state.selection.from})`
  );
}

// --- Repeated Backspace while suggesting: cursor must move left each time -
// Follow-up report on the same bug: forward-Delete was fixed, but Backspace
// left the cursor sitting still instead of moving left, so the next
// Backspace kept re-striking the same already-struck character instead of
// walking into new content to its left.
{
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("abcdef")])]),
    plugins: [suggestionPlugin(() => "alice")],
  });
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };

  setSuggesting(state, dispatch, "alice");
  // Cursor at the end of the text (position 7, right after "f").
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7)));

  const cursorAfterEachPress: number[] = [];
  for (let i = 0; i < 3; i++) {
    const to = state.selection.from;
    state = state.apply(state.tr.delete(to - 1, to));
    cursorAfterEachPress.push(state.selection.from);
  }

  assert(state.doc.textContent === "abcdef", "nothing is actually removed while suggesting via Backspace either");
  assert(
    cursorAfterEachPress.every((pos, i) => pos === cursorAfterEachPress[0] - i),
    `cursor moves one step further left after each Backspace press (got ${JSON.stringify(cursorAfterEachPress)})`
  );
  assert(
    cursorAfterEachPress[0] < 7,
    `cursor moves left after the very first Backspace, not staying at the pre-press position 7 (got ${cursorAfterEachPress[0]})`
  );

  const strikethroughOrder: string[] = [];
  const plainOrder: string[] = [];
  state.doc.descendants((node) => {
    if (!node.isText) return;
    if (node.marks.some((m) => m.type.name === "suggestion_delete")) {
      strikethroughOrder.push(node.text ?? "");
    } else {
      plainOrder.push(node.text ?? "");
    }
  });
  assert(
    strikethroughOrder.join("") === "def",
    `three consecutive backspaces struck through "d", "e", "f" left-to-right, not reversed/jumbled (got ${JSON.stringify(strikethroughOrder)})`
  );
  assert(
    plainOrder.join("") === "abc",
    `the untouched remainder reads "abc" (got ${JSON.stringify(plainOrder)})`
  );
}

// --- Backspacing your own not-yet-accepted suggestion must not double-tag -
// Reported bug (with screenshot): typing "Suggesting" while suggesting, then
// backspacing the last letter, showed the 'g' with BOTH an underline
// (suggestion_insert styling) and a strikethrough (suggestion_delete
// styling) at once — because the backspace wrapped already-pending inserted
// text in a second suggestion layer instead of just cancelling it.
{
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, [])]),
    plugins: [suggestionPlugin(() => "alice")],
  });
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };

  setSuggesting(state, dispatch, "alice");
  state = state.apply(state.tr.insertText("Suggesting", 1));

  let stackedMarkFound = false;
  state.doc.descendants((node) => {
    if (!node.isText) return;
    const hasInsert = node.marks.some((m) => m.type.name === "suggestion_insert");
    const hasDelete = node.marks.some((m) => m.type.name === "suggestion_delete");
    if (hasInsert && hasDelete) stackedMarkFound = true;
  });
  assert(!stackedMarkFound, "typing alone never produces a doubly-tagged node (sanity check)");

  // Backspace the trailing "g" — text just typed, not yet accepted.
  const end = state.doc.content.size - 1;
  state = state.apply(state.tr.delete(end - 1, end));

  assert(state.doc.textContent === "Suggestin", "backspacing your own pending insertion actually removes it, not just decorates it");

  state.doc.descendants((node) => {
    if (!node.isText) return;
    const hasInsert = node.marks.some((m) => m.type.name === "suggestion_insert");
    const hasDelete = node.marks.some((m) => m.type.name === "suggestion_delete");
    assert(
      !(hasInsert && hasDelete),
      `no text node ends up tagged both suggestion_insert AND suggestion_delete (node ${JSON.stringify(node.text)} had insert=${hasInsert} delete=${hasDelete})`
    );
  });
}

// --- Undo/redo while suggesting must not re-tag the restored content -----
{
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("abc")])]),
    plugins: [history(), commentsPlugin(), suggestionPlugin(() => "alice")],
  });
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };

  setSuggesting(state, dispatch, "alice");
  state = state.apply(state.tr.insertText("XYZ", state.doc.content.size - 1));
  assert(state.doc.textContent === "abcXYZ", "typed insertion present before undo");

  undo(state, dispatch);
  assert(state.doc.textContent === "abc", "undo restores the pre-insertion text");

  let taggedAfterUndo = false;
  state.doc.descendants((node) => {
    if (node.isText && node.marks.some((m) => m.type.name === "suggestion_insert" || m.type.name === "suggestion_delete")) {
      taggedAfterUndo = true;
    }
  });
  assert(!taggedAfterUndo, "undoing a suggested insertion doesn't get re-wrapped in a new suggestion span");
}

// --- accept/reject read from the incremental range index, not a doc walk -
{
  let state = EditorState.create({
    schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, [schema.text("abc")])]),
    plugins: [commentsPlugin(), suggestionPlugin(() => "alice")],
  });
  const dispatch = (tr: Transaction) => {
    state = state.apply(tr);
  };

  setSuggesting(state, dispatch, "alice");
  state = state.apply(state.tr.insertText("XYZ", state.doc.content.size - 1));

  let suggestionId: string | null = null;
  state.doc.descendants((node) => {
    const ins = node.marks.find((m) => m.type.name === "suggestion_insert");
    if (ins) suggestionId = ins.attrs.id as string;
  });
  assert(!!suggestionId, "captured the suggestion id for the index test");

  const before = suggestionPluginKey.getState(state)!.ranges.size;
  assert(before === 1, `plugin state tracks exactly one pending range (got ${before})`);

  const first = acceptSuggestion(state, dispatch, suggestionId!);
  assert(first === true, "first accept reports success");
  assert(state.doc.textContent === "abcXYZ", "first accept applies the insertion for real");
  assert(suggestionPluginKey.getState(state)!.ranges.size === 0, "resolving the suggestion clears it from the range index");

  const second = acceptSuggestion(state, dispatch, suggestionId!);
  assert(second === false, "accepting an already-resolved suggestion id is a harmless no-op (index lookup, not a stale doc walk)");
  assert(state.doc.textContent === "abcXYZ", "duplicate accept doesn't change the document");
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll smoke tests passed.");
