// The mascot, as text. The SVG in the HTML, the office canvas and the PNG cards all draw from this.
export type RobotState = 'asleep' | 'working' | 'thinking' | 'stuck' | 'panicking' | 'celebrating' | 'refusing';

export const ROBOT_COLORS: Record<string, string> = {
  s: '#aeb8c8', // steel
  S: '#7c889c', // steel, mid
  D: '#4a5568', // steel, dark
  k: '#0b1020', // night
  o: '#ff9a3c', // visor glow
  O: '#fff2d8', // visor, white hot
  d: '#5a3a20', // visor, dim
  x: '#ff4a38', // visor, red
  y: '#ffd84a', // visor, worried
  w: '#f5f1e8', // shirt
  W: '#cfc8b8', // shirt, shade
  r: '#d9402f', // tie
  R: '#a32c20', // tie, dark
  b: '#f5ebd8', // ID badge
  c: '#2f3a52', // legs and clip
};

const BASE = [
  '........DssD........',
  '.........ss.........',
  '...ssssssssssssss...',
  '..sSSSSSSSSSSSSSSs..',
  '..sSkkkkkkkkkkkkSs..',
  '..sSkOOookkoOOOkSs..',
  '..sSkkkkkkkkkkkkSs..',
  '..sSSSSSSSSSSSSSSs..',
  '..sSSDDDDDDDDDDSSs..',
  '...ssssssssssssss...',
  '.......DDDDDD.......',
  '...wwwwwwrrwwwwww...',
  '..wwwwwwwrrwwwwwww..',
  '.swwwwwwwrrwwwcbwws.',
  '.swwwwwwrRRrwwbbwws.',
  '.sWwwwwwwrrwwwbbwWs.',
  '.s.wwwwwwrrwwwwww.s.',
  '.s.wwwwwwrrwwwwww.s.',
  '...WWWWWWWWWWWWWW...',
  '...DDDDDDDDDDDDDD...',
  '...cccc......cccc...',
  '...cccc......cccc...',
  '..DDDDD......DDDDD..',
];

function replaceRow(rows: string[], index: number, row: string): void {
  rows[index] = row;
}

export function robotRows(state: RobotState): string[] {
  const rows = [...BASE];
  switch (state) {
    case 'asleep':
      replaceRow(rows, 5, '..sSkddddkkddddkSs..');
      break;
    case 'thinking':
      replaceRow(rows, 5, '..sSkkkkkkkoOOOkSs..');
      break;
    case 'stuck':
      replaceRow(rows, 5, '..sSkyyykkkkyyykSs..');
      break;
    case 'panicking':
      replaceRow(rows, 5, '..sSkxxxxkkxxxxkSs..');
      replaceRow(rows, 0, '.s......DssD......s.');
      replaceRow(rows, 1, '.s.......ss.......s.');
      for (const i of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const row = rows[i] as string;
        rows[i] = `.s${row.slice(2, 18)}s.`;
      }
      replaceRow(rows, 11, '.swwwwwwwrrwwwwwwws.');
      replaceRow(rows, 13, '..wwwwwwwrrwwwcbww..');
      replaceRow(rows, 14, '..wwwwwwrRRrwwbbww..');
      replaceRow(rows, 15, '..WwwwwwwrrwwwbbwW..');
      replaceRow(rows, 16, '...wwwwwwrrwwwwww...');
      replaceRow(rows, 17, '...wwwwwwrrwwwwww...');
      break;
    case 'celebrating':
      replaceRow(rows, 5, '..sSkOOOOkkOOOOkSs..');
      replaceRow(rows, 0, 's.......DssD.......s');
      replaceRow(rows, 1, 's........ss........s');
      for (const i of [2, 3, 4, 5, 6, 7, 8, 9]) {
        const row = rows[i] as string;
        rows[i] = `.s${row.slice(2, 18)}s.`;
      }
      replaceRow(rows, 10, '.s.....DDDDDD.....s.');
      replaceRow(rows, 11, '..swwwwwwrrwwwwwws..');
      replaceRow(rows, 13, '..wwwwwwwrrwwwcbww..');
      replaceRow(rows, 14, '..wwwwwwrRRrwwbbww..');
      replaceRow(rows, 15, '..WwwwwwwrrwwwbbwW..');
      replaceRow(rows, 16, '...wwwwwwrrwwwwww...');
      replaceRow(rows, 17, '...wwwwwwrrwwwwww...');
      break;
    case 'refusing':
      replaceRow(rows, 5, '..sSkxxxxxxxxxxkSs..');
      replaceRow(rows, 13, '.swwwwwwwrrwwwcbwws.');
      replaceRow(rows, 14, '.sssssssssssssssssss'.slice(0, 20));
      replaceRow(rows, 15, '.SSSSSSSSSSSSSSSSSS.');
      replaceRow(rows, 16, '...wwwwwwrrwwwwww...');
      replaceRow(rows, 17, '...wwwwwwrrwwwwww...');
      break;
    default:
      break;
  }
  return rows;
}

export const ROBOT_WIDTH = 20;
export const ROBOT_HEIGHT = BASE.length;

// Rows merged into runs, so the SVG stays small.
export function robotPaths(state: RobotState): { color: string; d: string }[] {
  const byColor = new Map<string, string>();
  robotRows(state).forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x] as string;
      let run = 1;
      while (row[x + run] === key) run++;
      const color = ROBOT_COLORS[key];
      if (color) byColor.set(color, `${byColor.get(color) ?? ''}M${x} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  });
  return [...byColor].map(([color, d]) => ({ color, d }));
}

export function robotSvg(state: RobotState, label = ''): string {
  const paths = robotPaths(state).map((p) => `<path fill="${p.color}" d="${p.d}"/>`).join('');
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="robot robot-${state}" ${a11y} viewBox="0 0 ${ROBOT_WIDTH} ${ROBOT_HEIGHT}" shape-rendering="crispEdges">${paths}</svg>`;
}
