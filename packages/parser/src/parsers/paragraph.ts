import { toString } from "mdast-util-to-string";

export function parseParagraph(node: any) {
  return {
    type: "paragraph",
    text: toString(node),
  };
}
