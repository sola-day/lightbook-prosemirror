import { keymap } from "prosemirror-keymap";
import {
  toggleMark,
  setBlockType,
  wrapIn,
  baseKeymap,
  chainCommands,
  createParagraphNear,
  liftEmptyBlock,
  splitBlock,
} from "prosemirror-commands";
import { wrapInList, splitListItem, liftListItem } from "prosemirror-schema-list";
import { lightbookSchema as schema } from "./schema";

const enterInList = chainCommands(
  splitListItem(schema.nodes.list_item),
  createParagraphNear,
  liftEmptyBlock,
  splitBlock
);

export function buildKeymap() {
  return keymap({
    ...baseKeymap,
    "Mod-b": toggleMark(schema.marks.bold),
    "Mod-i": toggleMark(schema.marks.italic),
    "Mod-u": toggleMark(schema.marks.underline),
    "Mod-e": toggleMark(schema.marks.code),
    "Mod-Shift-x": toggleMark(schema.marks.strikethrough),
    "Mod-Shift-h": toggleMark(schema.marks.highlight),
    "Mod-Alt-1": setBlockType(schema.nodes.heading, { level: 1 }),
    "Mod-Alt-2": setBlockType(schema.nodes.heading, { level: 2 }),
    "Mod-Alt-3": setBlockType(schema.nodes.heading, { level: 3 }),
    "Mod-Shift-8": wrapInList(schema.nodes.bullet_list),
    "Mod-Shift-9": wrapInList(schema.nodes.ordered_list),
    "Mod-Shift-.": wrapIn(schema.nodes.blockquote),
    Enter: enterInList,
    "Shift-Tab": liftListItem(schema.nodes.list_item),
  });
}
