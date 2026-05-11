import { parseCard } from "./card";
import { parseGrid } from "./grid";
import { parseHeading } from "./heading";
import { parseImage } from "./image";
import { parseList } from "./list";
import { parseParagraph } from "./paragraph";
import { parseQuestion } from "./question";
import { parseVideo } from "./video";

export const parsers: Record<string, (node: any) => any> = {
  heading: parseHeading,
  paragraph: parseParagraph,
  list: parseList,
  question: parseQuestion,
  video: parseVideo,
  grid: parseGrid,
  card: parseCard,
  image: parseImage,
};
