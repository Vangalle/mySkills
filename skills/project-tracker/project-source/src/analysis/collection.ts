import type { CollectionIssue } from "../contracts.js";

/** Report collection failures separately from facts about project progress. */
export type CollectionReporter = (issue: CollectionIssue) => void;
