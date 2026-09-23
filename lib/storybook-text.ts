// Shared by the page editor and print renderer. Geometry is measured at a 1024px page width.
export const STORY_TEXT_LINE_HEIGHT = 1.35;
export function storyTextLines(text: string, width: number, measure: (text: string) => number) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    let line = "";
    for (const { segment } of new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(paragraph)) {
      if (line && measure(line + segment) > width) { lines.push(line); line = ""; }
      line += segment;
    }
    lines.push(line);
  }
  return lines;
}
export function fittedStoryText(text: string, fontSize: number, width: number, height: number, measure: (text: string, size: number) => number) {
  let size = fontSize;
  let lines = storyTextLines(text, width, value => measure(value, size));
  // Legacy text can exceed the old clipped box. Keep every character visible without changing its source.
  while (lines.length * size * STORY_TEXT_LINE_HEIGHT > height && size > 1) {
    size *= .95;
    lines = storyTextLines(text, width, value => measure(value, size));
  }
  return { size, lines };
}
