import type { QuestionNode } from "../types/ast";
import {
  flattenChildren,
  getAttribute,
  getText,
  hasAttribute,
  isMdxNode,
} from "./utils";

export function parseQuestion(node: any): QuestionNode {
  const children = flattenChildren(node.children);
  const promptNode = children.find((child) => isMdxNode(child, "Prompt"));
  const optionNodes = children.filter((child) => isMdxNode(child, "Option"));

  return {
    type: "question",
    questionType: getAttribute(node, "type") ?? "",
    prompt: getText(promptNode),
    options: optionNodes.map((option) => ({
      text: getText(option),
      correct: hasAttribute(option, "correct"),
    })),
  };
}
