import { GLYPHS } from '../shared/font';

// Turns text into one SVG path in the project's pixel font. It renders as fast as plain text, and
// the real words sit next to it for screen readers.
function glyphPath(text: string, startX: number, startY: number): { path: string; width: number } {
  let d = '';
  let x = startX;
  for (const char of text.toUpperCase()) {
    const rows = GLYPHS[char];
    if (rows) {
      rows.forEach((bits, row) => {
        let col = 0;
        while (col < 5) {
          if (bits & (1 << (4 - col))) {
            let run = 1;
            while (col + run < 5 && bits & (1 << (4 - col - run))) run++;
            d += `M${x + col} ${startY + row}h${run}v1h-${run}z`;
            col += run;
          } else {
            col++;
          }
        }
      });
    }
    x += 6;
  }
  return { path: d, width: x - startX - 1 };
}

export function pixelSvg(lines: (string | { text: string; accent?: boolean })[], className = ''): string {
  const paths: string[] = [];
  let width = 0;
  lines.forEach((line, i) => {
    const text = typeof line === 'string' ? line : line.text;
    const accent = typeof line === 'object' && line.accent;
    const glyph = glyphPath(text, 0, i * 10);
    width = Math.max(width, glyph.width);
    paths.push(`<path${accent ? ' class="accent"' : ''} d="${glyph.path}"/>`);
  });
  const height = lines.length * 10 - 3;
  return `<svg aria-hidden="true" focusable="false" viewBox="0 0 ${width} ${height}" width="${width * 3}" height="${height * 3}" shape-rendering="crispEdges"${className ? ` class="${className}"` : ''}>${paths.join('')}</svg>`;
}
