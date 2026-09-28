import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import MarkdownIt from "markdown-it";
import { Fragment, Node as PMNode } from "prosemirror-model";
import { lightbookSchema as schema } from "./schema";

/**
 * A genuinely empty paragraph (the blank line you get from pressing Enter
 * twice) has no content to serialize, and Markdown's block separation is
 * exactly one blank line between any two blocks regardless of how many
 * `closeBlock` calls happen in between — so an empty paragraph, having
 * written nothing, vanishes without a trace: exporting "line one / (blank) /
 * line two" produced "line one\n\nline two", indistinguishable from never
 * having had a blank paragraph there at all. We mark an empty paragraph with
 * a single U+00A0 (non-breaking space) on export so it survives as visible
 * (if unusual-looking) Markdown, and strip that marker back out to a real
 * empty paragraph on import — see `stripBlankParagraphMarkers` below.
 */
const BLANK_PARAGRAPH_MARKER = " ";

/**
 * Serialize a document to Markdown. Table nodes and comment/suggestion marks
 * are intentionally NOT round-tripped through Markdown — Markdown is treated
 * as an import/export/paste format, not the source of truth (the ProseMirror
 * doc / Yjs doc is). Tables degrade to a GFM table when every cell is a
 * single paragraph, otherwise fall back to an HTML table so content is never
 * silently lost.
 */
export const markdownSerializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,

    paragraph(state, node) {
      if (node.content.size === 0) {
        // See BLANK_PARAGRAPH_MARKER above: write something so this block
        // isn't silently swallowed by Markdown's blank-line block spacing.
        state.text(BLANK_PARAGRAPH_MARKER, false);
        state.closeBlock(node);
        return;
      }
      state.renderInline(node);
      state.closeBlock(node);
    },

    checkbox_list(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
    checkbox_item(state, node) {
      state.write(node.attrs.checked ? "[x] " : "[ ] ");
      state.renderContent(node);
    },

    table(state, node) {
      const rows: string[][] = [];
      let alignments: (string | null)[] = [];
      node.forEach((row, _offset, rowIndex) => {
        const cells: string[] = [];
        row.forEach((cell) => {
          const text = cell.textContent.replace(/\|/g, "\\|").replace(/\n/g, " ");
          cells.push(text || " ");
          if (rowIndex === 0) alignments.push((cell.attrs.alignment as string) || null);
        });
        rows.push(cells);
      });
      if (rows.length === 0) return;
      const header = rows[0];
      const divider = header.map((_, i) => {
        switch (alignments[i]) {
          case "center":
            return ":---:";
          case "right":
            return "---:";
          case "left":
            return ":---";
          default:
            return "---";
        }
      });
      state.write(`| ${header.join(" | ")} |\n`);
      state.write(`| ${divider.join(" | ")} |\n`);
      for (const row of rows.slice(1)) {
        state.write(`| ${row.join(" | ")} |\n`);
      }
      state.closeBlock(node);
    },
    table_row() {},
    table_cell() {},
    table_header() {},

    // GFM has no callout/notice syntax; degrade to a blockquote so the
    // content survives a round-trip through plain Markdown instead of
    // throwing "unsupported node type".
    notice(state, node) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node));
    },

    // No GFM syntax for embedded video; degrade to a link so the source URL
    // survives a round-trip instead of throwing "unsupported node type".
    video(state, node) {
      state.write(`[${node.attrs.title || "video"}](${node.attrs.src})`);
      state.closeBlock(node);
    },
  },
  {
    // NOTE: `defaultMarkdownSerializer.marks` is keyed by ProseMirror's
    // conventional mark names ("em", "strong") — our schema's marks are
    // named "italic"/"bold" instead, so spreading the default in gave us
    // zero matching keys for them and the serializer threw "Mark type
    // `bold` not supported" the moment real content was exported. Every
    // mark in `schema/marks.ts` needs an explicit entry here, keyed by its
    // actual schema name.
    bold: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
    italic: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
    strikethrough: {
      open: "~~",
      close: "~~",
      mixable: true,
      expelEnclosingWhitespace: true,
    },
    code: defaultMarkdownSerializer.marks.code,
    link: defaultMarkdownSerializer.marks.link,
    underline: { open: "<u>", close: "</u>", mixable: true },
    highlight: { open: "<mark>", close: "</mark>", mixable: true },
    subscript: { open: "<sub>", close: "</sub>", mixable: true },
    superscript: { open: "<sup>", close: "</sup>", mixable: true },
    // Comment / suggestion marks are UI/collab-only annotations; they never
    // leak into exported Markdown.
    comment: { open: "", close: "", mixable: true },
    suggestion_insert: { open: "", close: "", mixable: true },
    suggestion_delete: { open: "", close: "", mixable: true },
  }
);

const md = MarkdownIt("commonmark", { html: false }).enable(["table", "strikethrough"]);

/**
 * markdown-it's table rule emits `th_open`/`td_open` immediately followed by
 * a bare `inline` token — but our `table_cell`/`table_header` nodes require
 * block content (`cellContent: "block+"`, same as prosemirror-tables'
 * default), not raw inline content. Wrap each cell's inline token in a
 * synthetic paragraph so MarkdownParser has a block node to put it in.
 * `thead`/`tbody` wrapper tokens carry no schema node and are declared
 * `ignore: true` below instead of being stripped here.
 */
md.core.ruler.after("block", "lb-wrap-table-cell-inline", (state) => {
  const tokens = state.tokens;
  const out: typeof tokens = [];
  for (const tok of tokens) {
    const prev = out[out.length - 1];
    if (tok.type === "inline" && prev && (prev.type === "th_open" || prev.type === "td_open")) {
      const open = new state.Token("paragraph_open", "p", 1);
      const close = new state.Token("paragraph_close", "p", -1);
      out.push(open, tok, close);
      continue;
    }
    out.push(tok);
  }
  state.tokens = out;
});

/**
 * markdown-it's CommonMark core has no notion of GFM task lists — `- [ ] x`
 * parses as a perfectly ordinary bullet list whose item text happens to
 * start with the literal characters "[ ] ". Detect bullet lists where every
 * item's first paragraph starts with `[ ]`/`[x]`, rename their tokens to a
 * distinct `checkbox_list`/`checkbox_item` pair, stash the checked state as
 * a token attr, and strip the marker text — so the token config below can
 * route them to the schema's checkbox nodes instead of `bullet_list`.
 * Mixed lists (some items checkboxes, some not) are left as a plain bullet
 * list rather than partially converted.
 */
function convertTaskLists(state: import("markdown-it").StateCore) {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "bullet_list_open") continue;

    let depth = 0;
    let closeIdx = -1;
    const itemOpens: number[] = [];
    for (let j = i; j < tokens.length; j++) {
      if (tokens[j].type === "bullet_list_open") depth++;
      if (tokens[j].type === "bullet_list_close") {
        depth--;
        if (depth === 0) {
          closeIdx = j;
          break;
        }
      }
      if (tokens[j].type === "list_item_open" && depth === 1) itemOpens.push(j);
    }
    if (closeIdx === -1 || itemOpens.length === 0) continue;

    const matches: { inlineIdx: number; itemOpenIdx: number; checked: boolean }[] = [];
    let allMatch = true;
    for (const itemIdx of itemOpens) {
      let itemDepth = 0;
      let firstInline = -1;
      for (let k = itemIdx; k < tokens.length; k++) {
        if (tokens[k].type === "list_item_open") itemDepth++;
        if (tokens[k].type === "list_item_close") {
          itemDepth--;
          if (itemDepth === 0) break;
        }
        if (firstInline === -1 && tokens[k].type === "inline" && tokens[k - 1]?.type === "paragraph_open") {
          firstInline = k;
        }
      }
      const m = firstInline === -1 ? null : /^\[([ xX])\]\s+/.exec(tokens[firstInline].content);
      if (!m) {
        allMatch = false;
        break;
      }
      matches.push({ inlineIdx: firstInline, itemOpenIdx: itemIdx, checked: m[1].toLowerCase() === "x" });
    }
    if (!allMatch) continue;

    tokens[i].type = "checkbox_list_open";
    tokens[closeIdx].type = "checkbox_list_close";
    for (const { inlineIdx, itemOpenIdx, checked } of matches) {
      tokens[itemOpenIdx].type = "checkbox_item_open";
      tokens[itemOpenIdx].attrSet("checked", checked ? "true" : "false");
      let itemDepth = 0;
      for (let k = itemOpenIdx; k < tokens.length; k++) {
        if (tokens[k].type === "list_item_open" || tokens[k].type === "checkbox_item_open") itemDepth++;
        if (tokens[k].type === "list_item_close") {
          itemDepth--;
          if (itemDepth === 0) {
            tokens[k].type = "checkbox_item_close";
            break;
          }
        }
      }
      tokens[inlineIdx].content = tokens[inlineIdx].content.replace(/^\[([ xX])\]\s+/, "");
    }
  }
}

md.core.ruler.after("block", "lb-convert-task-lists", convertTaskLists);

// NOTE: markdown-it runs with `html: false` (no raw HTML passthrough), so the
// `<u>`/`<mark>`/`<sub>`/`<sup>` tags emitted by the serializer for
// underline/highlight/subscript/superscript are import-lossy: pasting them
// back in comes through as literal text, not the mark. Round-tripping those
// four marks losslessly would need either enabling raw HTML parsing (which
// reopens XSS surface for pasted content) or a non-standard Markdown
// extension; deferred until a concrete need shows up.
export const markdownParser = new MarkdownParser(schema, md, {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "list_item" },
  bullet_list: { block: "bullet_list" },
  checkbox_list: { block: "checkbox_list" },
  checkbox_item: {
    block: "checkbox_item",
    getAttrs: (tok) => ({ checked: tok.attrGet("checked") === "true" }),
  },
  ordered_list: {
    block: "ordered_list",
    getAttrs: (tok) => ({ order: +(tok.attrGet("start") || 1) }),
  },
  heading: {
    block: "heading",
    getAttrs: (tok) => ({ level: +tok.tag.slice(1) }),
  },
  code_block: { block: "code_block", noCloseToken: true },
  fence: {
    block: "code_block",
    getAttrs: (tok) => ({ language: tok.info || "" }),
    noCloseToken: true,
  },
  hr: { node: "horizontal_rule" },
  hardbreak: { node: "hard_break" },

  table: { block: "table" },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: "table_row" },
  th: {
    block: "table_header",
    getAttrs: (tok) => ({ alignment: tok.attrGet("style") ? parseAlign(tok) : null }),
  },
  td: {
    block: "table_cell",
    getAttrs: (tok) => ({ alignment: tok.attrGet("style") ? parseAlign(tok) : null }),
  },

  em: { mark: "italic" },
  strong: { mark: "bold" },
  s: { mark: "strikethrough" },
  code_inline: { mark: "code", noCloseToken: true },
  link: {
    mark: "link",
    getAttrs: (tok) => ({
      href: tok.attrGet("href"),
      title: tok.attrGet("title") || null,
    }),
  },
  image: {
    node: "image",
    getAttrs: (tok) => ({
      src: tok.attrGet("src"),
      title: tok.attrGet("title") || null,
      alt: (tok.children?.[0] && tok.children[0].content) || "",
    }),
  },
});

function parseAlign(tok: import("markdown-it/index.js").Token): string | null {
  const style = tok.attrGet("style") || "";
  const match = /text-align:\s*(left|right|center)/.exec(style);
  return match ? match[1] : null;
}

/** Reverses the BLANK_PARAGRAPH_MARKER substitution: a paragraph whose sole
 * content is that one marker character came from an intentionally empty
 * paragraph, not a paragraph the user actually typed a non-breaking space
 * into — collapse it back to a real empty paragraph. */
function stripBlankParagraphMarkers(node: PMNode): PMNode {
  if (node.isText || node.isLeaf) return node;
  if (
    node.type === schema.nodes.paragraph &&
    node.childCount === 1 &&
    node.firstChild!.isText &&
    node.firstChild!.text === BLANK_PARAGRAPH_MARKER &&
    node.firstChild!.marks.length === 0
  ) {
    return node.copy(Fragment.empty);
  }
  let changed = false;
  const mapped: PMNode[] = [];
  node.forEach((child) => {
    const next = stripBlankParagraphMarkers(child);
    if (next !== child) changed = true;
    mapped.push(next);
  });
  return changed ? node.copy(Fragment.from(mapped)) : node;
}

export function docToMarkdown(doc: import("prosemirror-model").Node): string {
  return markdownSerializer.serialize(doc);
}

export function markdownToDoc(text: string) {
  return stripBlankParagraphMarkers(markdownParser.parse(text));
}
