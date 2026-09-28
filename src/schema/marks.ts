import { MarkSpec } from "prosemirror-model";

export const marks: Record<string, MarkSpec> = {
  bold: {
    parseDOM: [{ tag: "strong" }, { tag: "b" }],
    toDOM() {
      return ["strong", 0];
    },
  },

  italic: {
    parseDOM: [{ tag: "em" }, { tag: "i" }],
    toDOM() {
      return ["em", 0];
    },
  },

  strikethrough: {
    parseDOM: [{ tag: "s" }, { tag: "del" }],
    toDOM() {
      return ["s", 0];
    },
  },

  underline: {
    parseDOM: [{ tag: "u" }, { style: "text-decoration=underline" }],
    toDOM() {
      return ["u", 0];
    },
  },

  highlight: {
    attrs: { color: { default: "#ffe28a" } },
    parseDOM: [
      {
        tag: "mark",
        getAttrs: (dom) => ({ color: (dom as HTMLElement).style.backgroundColor || undefined }),
      },
    ],
    toDOM(node) {
      return ["mark", { style: `background-color: ${node.attrs.color}` }, 0];
    },
  },

  subscript: {
    excludes: "superscript",
    parseDOM: [{ tag: "sub" }],
    toDOM() {
      return ["sub", 0];
    },
  },

  superscript: {
    excludes: "subscript",
    parseDOM: [{ tag: "sup" }],
    toDOM() {
      return ["sup", 0];
    },
  },

  code: {
    excludes: "bold italic",
    parseDOM: [{ tag: "code" }],
    toDOM() {
      return ["code", 0];
    },
  },

  link: {
    attrs: { href: {}, title: { default: null } },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs: (dom) => ({
          href: (dom as HTMLElement).getAttribute("href"),
          title: (dom as HTMLElement).getAttribute("title"),
        }),
      },
    ],
    toDOM(node) {
      return ["a", { href: node.attrs.href, title: node.attrs.title }, 0];
    },
  },

  /**
   * Google-Docs-style comment anchor. A run of text can carry more than one
   * open thread (overlapping comments), so this mark is NOT excludes-self —
   * each application carries its own threadId and marks are deduped by that
   * attr rather than by mark type.
   */
  comment: {
    attrs: { threadId: {} },
    excludes: "",
    inclusive: true,
    parseDOM: [
      {
        tag: "span[data-comment-thread]",
        getAttrs: (dom) => ({
          threadId: (dom as HTMLElement).getAttribute("data-comment-thread"),
        }),
      },
    ],
    toDOM(node) {
      return ["span", { "data-comment-thread": node.attrs.threadId, class: "lb-comment" }, 0];
    },
  },

  /**
   * Suggestion-mode marks (Google Docs "Suggesting"): edits made while a
   * suggestionId is active are tagged instead of applied directly. Insertions
   * are tagged text; deletions are text that stays in the document, hidden
   * behind a strikethrough decoration, until the suggestion is accepted
   * (removed for real) or rejected (mark stripped, insertion removed).
   *
   * Deliberately left at the MarkSpec default (self-excluding, unlike
   * `comment` above): each character belongs to exactly one suggestion.
   * `excludes: ""` was tried here first and caused a real bug — ProseMirror
   * inserts inherit the marks active at the cursor, so typing right after an
   * existing suggestion silently inherited *that* suggestion's mark too,
   * stacking two different suggestion ids on one range and making accept/
   * reject of one suggestion incorrectly touch the other's text.
   */
  suggestion_insert: {
    attrs: { id: {}, authorId: {}, createdAt: { default: null } },
    parseDOM: [
      {
        tag: "span[data-suggestion-insert]",
        getAttrs: (dom) => ({
          id: (dom as HTMLElement).getAttribute("data-suggestion-insert"),
          authorId: (dom as HTMLElement).getAttribute("data-author"),
          createdAt: (dom as HTMLElement).getAttribute("data-created-at"),
        }),
      },
    ],
    toDOM(node) {
      return [
        "span",
        {
          "data-suggestion-insert": node.attrs.id,
          "data-author": node.attrs.authorId,
          "data-created-at": node.attrs.createdAt,
          class: "lb-suggestion-insert",
        },
        0,
      ];
    },
  },

  suggestion_delete: {
    attrs: { id: {}, authorId: {}, createdAt: { default: null } },
    parseDOM: [
      {
        tag: "span[data-suggestion-delete]",
        getAttrs: (dom) => ({
          id: (dom as HTMLElement).getAttribute("data-suggestion-delete"),
          authorId: (dom as HTMLElement).getAttribute("data-author"),
          createdAt: (dom as HTMLElement).getAttribute("data-created-at"),
        }),
      },
    ],
    toDOM(node) {
      return [
        "span",
        {
          "data-suggestion-delete": node.attrs.id,
          "data-author": node.attrs.authorId,
          "data-created-at": node.attrs.createdAt,
          class: "lb-suggestion-delete",
        },
        0,
      ];
    },
  },
};
