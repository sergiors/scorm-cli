import type { VideoNode } from "../types/ast";
import { getAttribute } from "./utils";

export function parseVideo(node: any): VideoNode {
  return {
    type: "video",
    url: getAttribute(node, "url") ?? "",
    title: getAttribute(node, "title") ?? "",
  };
}
