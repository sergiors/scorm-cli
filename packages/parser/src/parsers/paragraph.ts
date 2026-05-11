import { ParagraphNode } from "../types/ast";
import { getText } from "./utils";

export function parseParagraph(node: any): ParagraphNode {
  return {
    type: "paragraph",
    text: getText(node),
  };
}
