import { Schema } from "prosemirror-model";
import { nodes } from "./nodes";
import { marks } from "./marks";

export const lightbookSchema = new Schema({ nodes, marks });

export type LightbookSchema = typeof lightbookSchema;
