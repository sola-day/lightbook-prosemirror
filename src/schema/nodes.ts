import { NodeSpec } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";

/**
 * Node set modeled on Outline's shared/editor schema: enough block/inline
 * structure for a real document (headings, lists, tables, code, quotes)
 * without dragging in Outline's full plugin surface.
 */
export const nodes: Record<string, NodeSpec> = {
  doc: {
    content: "block+",
  },

  paragraph: {
    content: "inline*",
    group: "block",
    parseDOM: [{ tag: "p" }],
    toDOM() {
      return ["p", 0];
    },
  },

  heading: {
    attrs: { level: { default: 1 } },
    content: "inline*",
    group: "block",
    defining: true,
    parseDOM: [1, 2, 3, 4].map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    })),
    toDOM(node) {
      return [`h${node.attrs.level}`, 0];
    },
  },

  blockquote: {
    content: "block+",
    group: "block",
    defining: true,
    parseDOM: [{ tag: "blockquote" }],
    toDOM() {
      return ["blockquote", 0];
    },
  },

  code_block: {
    content: "text*",
    marks: "",
    group: "block",
    code: true,
    defining: true,
    attrs: { language: { default: "" } },
    parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    toDOM() {
      return ["pre", ["code", 0]];
    },
  },

  horizontal_rule: {
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM() {
      return ["hr"];
    },
  },

  bullet_list: {
    content: "list_item+",
    group: "block",
    parseDOM: [{ tag: "ul" }],
    toDOM() {
      return ["ul", 0];
    },
  },

  ordered_list: {
    content: "list_item+",
    group: "block",
    attrs: { order: { default: 1 } },
    parseDOM: [{ tag: "ol" }],
    toDOM(node) {
      return node.attrs.order === 1
        ? ["ol", 0]
        : ["ol", { start: node.attrs.order }, 0];
    },
  },

  list_item: {
    content: "paragraph block*",
    defining: true,
    parseDOM: [{ tag: "li" }],
    toDOM() {
      return ["li", 0];
    },
  },

  checkbox_list: {
    content: "checkbox_item+",
    group: "block",
    parseDOM: [{ tag: "ul[data-checkbox-list]" }],
    toDOM() {
      return ["ul", { "data-checkbox-list": "true" }, 0];
    },
  },

  checkbox_item: {
    content: "paragraph block*",
    defining: true,
    attrs: { checked: { default: false } },
    parseDOM: [
      {
        tag: "li[data-checked]",
        getAttrs: (dom) => ({
          checked: (dom as HTMLElement).getAttribute("data-checked") === "true",
        }),
      },
    ],
    toDOM(node) {
      return ["li", { "data-checked": node.attrs.checked ? "true" : "false" }, 0];
    },
  },

  image: {
    inline: true,
    group: "inline",
    draggable: true,
    attrs: {
      src: {},
      alt: { default: "" },
      title: { default: null },
      width: { default: null },
    },
    parseDOM: [
      {
        tag: "img[src]",
        getAttrs: (dom) => ({
          src: (dom as HTMLElement).getAttribute("src"),
          alt: (dom as HTMLElement).getAttribute("alt") || "",
          title: (dom as HTMLElement).getAttribute("title"),
          width: (dom as HTMLElement).getAttribute("width"),
        }),
      },
    ],
    toDOM(node) {
      return [
        "img",
        {
          src: node.attrs.src,
          alt: node.attrs.alt,
          title: node.attrs.title,
          width: node.attrs.width,
        },
      ];
    },
  },

  /** Embedded video (local file or remote URL), rendered with native controls. */
  video: {
    group: "block",
    draggable: true,
    attrs: {
      src: {},
      title: { default: null },
    },
    parseDOM: [
      {
        tag: "video[src]",
        getAttrs: (dom) => ({
          src: (dom as HTMLElement).getAttribute("src"),
          title: (dom as HTMLElement).getAttribute("title"),
        }),
      },
    ],
    toDOM(node) {
      return [
        "video",
        { src: node.attrs.src, title: node.attrs.title, controls: "true" },
      ];
    },
  },

  /** Outline-style callout / notice box (info, warning, tip, ...). */
  notice: {
    content: "block+",
    group: "block",
    defining: true,
    attrs: { kind: { default: "info" } },
    parseDOM: [
      {
        tag: "div[data-notice]",
        getAttrs: (dom) => ({ kind: (dom as HTMLElement).getAttribute("data-notice") || "info" }),
      },
    ],
    toDOM(node) {
      return ["div", { "data-notice": node.attrs.kind, class: `lb-notice lb-notice--${node.attrs.kind}` }, 0];
    },
  },

  text: { group: "inline" },

  hard_break: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM() {
      return ["br"];
    },
  },

  ...tableNodes({
    tableGroup: "block",
    cellContent: "block+",
    cellAttributes: {
      alignment: {
        default: null,
        getFromDOM: (dom) => (dom as HTMLElement).style.textAlign || null,
        setDOMAttr: (value, attrs) => {
          if (value) {
            attrs.style = `${attrs.style || ""}text-align: ${value};`;
          }
        },
      },
    },
  }),
};
