export {
  commentsPlugin,
  commentsPluginKey,
  addComment,
  removeComment,
  setActiveThread,
  listThreads,
} from "./plugin";
export type { CommentsState, AddCommentOptions } from "./plugin";

export {
  suggestionPlugin,
  suggestionPluginKey,
  setSuggesting,
  acceptSuggestion,
  rejectSuggestion,
} from "./suggestion";
export type { SuggestionState } from "./suggestion";
