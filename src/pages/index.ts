import site from '../../config/site.json';
import { pixelSvg } from './pixel';

interface Options {
  tokenOn: boolean;
  mint: string;
  threshold: number;
}

export interface Page {
  file: string;
  title: string;
  description: string;
  script: string | null;
  body: string;
  nav?: string;
}

const NAV = [
  ['Home', '/'],
  ['Play', '/play'],
  ['Board', '/board'],
  ['Live', '/live'],
  ['History', '/history'],
  ['How it works', '/how'],
] as const;

// Repo links stay off the site until the repos are public.
const FOOT = [
  ['About', '/about'],
  ['Status', '/status'],
  ['Changelog', '/changelog'],
  ['Site repo', site.repos.site],
  ['Game repo', site.repos.game],
].filter(([, href]) => href);

export function layout(page: Page, options: Options): string {
  const url = `${site.siteOrigin}${page.nav ?? ''}`;
  const nav = NAV.map(([label, href]) =>
    `<li><a href="${href}"${page.nav === href ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  const foot = FOOT.map(([label, href]) => `<a href="${href}">${label}</a>`).join('');
  const script = page.script ? `<script type="module" src="/js/${page.script}.js"></script>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
<meta name="theme-color" content="#1c1a26">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css">
<meta property="og:type" content="website">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${site.siteOrigin}/api/card.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${page.title}">
<meta name="twitter:description" content="${page.description}">
<meta name="twitter:image" content="${site.siteOrigin}/api/card.png">
${script}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${options.tokenOn ? '' : '<div class="ribbon" role="note">TEST MODE. Balances here are fake.</div>'}
<div class="notice" id="pause-notice" role="status" hidden></div>
<header class="top">
<div class="wrap">
<a class="brand" href="/" aria-label="Agent Intern, home">${pixelSvg(['AGENT INTERN'])}</a>
<a class="pill" id="pill" href="/live"><i></i><span>off shift</span></a>
<div id="ca-slot"></div>
<nav aria-label="Main"><ul class="nav">${nav}</ul></nav>
</div>
</header>
<main id="main">
<div class="wrap">
${page.body}
</div>
</main>
<footer class="foot">
<div class="wrap">
<span>Holders vote, the intern ships it. A person starts every shift.</span>
<nav aria-label="Footer">${foot}</nav>
</div>
</footer>
</body>
</html>
`;
}

const title = (text: string): string =>
  `<h1 class="page-title"><span class="sr">${text}</span>${pixelSvg([text])}</h1>`;

export function pages(options: Options): Page[] {
  const threshold = options.threshold.toLocaleString('en-US');
  const passWords = options.tokenOn
    ? `A pass means holding at least ${threshold} of the token in your wallet.`
    : `A pass means holding at least ${threshold} on your balance. In TEST MODE, balances are fake.`;
  const neverGet = options.tokenOn
    ? 'No creator fees, no revenue share, no rewards, no prizes, no buybacks. Voting is the only thing the token does here, plus your short wallet in the credits.'
    : 'No fees, no revenue share, no rewards, no prizes. A pass lets you vote, and it puts your short wallet in the credits.';
  const closes = site.rounds.closesUtc.join(' and ');

  return [
    {
      file: 'index.html',
      nav: '/',
      title: 'Agent Intern',
      description: 'We hired an AI intern. Holders are its boss. Holders vote, the intern ships it.',
      script: 'home',
      body: `
<section class="hero" aria-labelledby="hero-title">
<div>
<h1 id="hero-title"><span class="sr">We hired an AI intern. Holders are its boss.</span>${pixelSvg(['WE HIRED AN', 'AI INTERN.', { text: 'HOLDERS ARE', accent: true }, { text: 'ITS BOSS.', accent: true }])}</h1>
<p class="sub">It builds a browser game in public. Holders vote, the intern ships it. Anyone can watch the shift and play the new version.</p>
<div class="btn-row" data-mt="16"><a class="btn big" href="/play">Play the game</a><a class="pill" href="/board">Vote on the next task</a></div>
</div>
<div class="desk">
<canvas id="desk" width="160" height="110" role="img" aria-label="The intern at a desk"></canvas>
<div class="state"><span id="desk-state">off shift</span><a id="desk-link" href="/live">Watch</a></div>
</div>
</section>
<div class="grid two">
<div class="stack">
<section class="sheet" aria-labelledby="tasks-title">
<h2 id="tasks-title">This round's top tasks</h2>
<ol class="task-list" id="top-tasks"><li class="empty">Loading the in-tray.</li></ol>
<p data-mt="12"><a href="/board">See every task and vote</a></p>
</section>
<section class="sheet" aria-labelledby="how-title">
<h2 id="how-title">How the day goes</h2>
<ol class="steps">
<li>Holders suggest tasks and vote through the day.</li>
<li>Voting closes at ${closes} UTC. The winner joins the queue.</li>
<li>A person starts a shift, and the intern takes the next task.</li>
<li>Tests decide. If it passes, the update ships.</li>
</ol>
<p data-mt="12"><a href="/how">The full rules</a></p>
</section>
</div>
<div class="stack">
<section class="sheet" aria-labelledby="clock-title">
<h2 id="clock-title">Vote closes in</h2>
<p class="clock"><b id="countdown">--:--:--</b></p>
<p class="muted" id="round-line"></p>
</section>
<section class="sheet" aria-labelledby="queue-title">
<h2 id="queue-title">The queue</h2>
<ol class="task-list" id="queue"><li class="empty">Loading.</li></ol>
</section>
</div>
</div>`,
    },
    {
      file: 'play.html',
      nav: '/play',
      title: 'Play | Agent Intern',
      description: 'Last Day at the Office: a 90-second run of tasks, coffee, meetings and the boss.',
      script: 'play',
      body: `
${title('LAST DAY AT THE OFFICE')}
<p class="lede">Finish tasks, drink coffee, dodge meetings, avoid the boss. Click the game to play. It runs in a sealed frame with no way to reach your wallet or this site.</p>
<div class="play-frame">
<iframe id="game" title="Last Day at the Office" src="${site.gameOrigin}/" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
</div>
<div class="grid even" data-mt="18">
<section class="sheet" aria-labelledby="score-title">
<h2 id="score-title">Sign your timesheet</h2>
<p class="empty" id="score-empty">Finish a run and your score shows up here.</p>
<form id="score-form" hidden>
<p>You scored <b id="score-value">0</b>.</p>
<div class="field">
<label for="score-name">Name on the board</label>
<input id="score-name" name="name" maxlength="16" autocomplete="nickname" required pattern="[A-Za-z0-9 _\\-]{1,16}">
<span class="hint">Letters, numbers, spaces. No wallet needed.</span>
</div>
<button class="btn" type="submit">Post score</button>
<p id="score-message" role="status" data-mt="8"></p>
</form>
</section>
<section class="sheet" aria-labelledby="board-title">
<h2 id="board-title">Employees of the month</h2>
<ol class="task-list" id="leaderboard"><li class="empty">Loading.</li></ol>
</section>
</div>`,
    },
    {
      file: 'board.html',
      nav: '/board',
      title: 'The Board | Agent Intern',
      description: 'Suggest a task for the intern and vote on what it does next.',
      script: 'board',
      body: `
${title('THE BOARD')}
<p class="lede">One wallet, one vote, and you can change it until the round closes. Tasks describe a change to the game. They can't change the intern's rules.</p>
<div class="grid two">
<div class="stack">
<section class="sheet" aria-labelledby="open-title">
<h2 id="open-title">Round <span id="round-id">-</span></h2>
<p class="clock"><b id="countdown">--:--:--</b><span class="muted" id="round-line"></span></p>
<ol class="task-list" id="proposals" data-mt="8"><li class="empty">Loading.</li></ol>
</section>
<section class="sheet" aria-labelledby="rejected-title">
<h2 id="rejected-title">Turned down this round</h2>
<ol class="task-list" id="rejected"><li class="empty">Nothing yet.</li></ol>
</section>
</div>
<div class="stack">
<section class="sheet" aria-labelledby="pass-title">
<h2 id="pass-title">Your pass</h2>
<div id="pass"><p class="muted">Loading.</p></div>
</section>
<section class="sheet" aria-labelledby="propose-title">
<h2 id="propose-title">Suggest a task</h2>
<form id="propose-form">
<div class="field">
<label for="task-text">What should the intern change in the game?</label>
<textarea id="task-text" name="text" rows="3" maxlength="120" required></textarea>
<span class="hint"><span id="task-count">0</span> of 120. One task per round.</span>
</div>
<button class="btn" type="submit" id="propose-button" disabled>Sign and submit</button>
<p id="propose-message" role="status" data-mt="8"></p>
</form>
</section>
<section class="sheet" aria-labelledby="queue-title">
<h2 id="queue-title">The queue</h2>
<ol class="task-list" id="queue"><li class="empty">Loading.</li></ol>
</section>
</div>
</div>
<section class="sheet" aria-labelledby="record-title" data-mt="18">
<h2 id="record-title">Public record</h2>
<p class="muted">Every vote this round, with its signature, slot and balance. <a id="record-link" href="/api/votes">Read it as JSON</a>. Press Verify and your own browser checks the signature, with no help from this site.</p>
<div class="table-scroll"><table>
<thead><tr><th scope="col">Wallet</th><th scope="col">Voted for</th><th scope="col" class="num">Balance</th><th scope="col" class="num">Slot</th><th scope="col">Check</th></tr></thead>
<tbody id="record"><tr><td colspan="5" class="empty">No votes yet.</td></tr></tbody>
</table></div>
<h3>Verify any signature</h3>
<form id="verify-form">
<div class="field"><label for="verify-wallet">Wallet</label><input id="verify-wallet" autocomplete="off" required></div>
<div class="field"><label for="verify-message">Message</label><textarea id="verify-message" rows="5" required></textarea></div>
<div class="field"><label for="verify-signature">Signature</label><input id="verify-signature" autocomplete="off" required></div>
<button class="btn ghost" type="submit">Verify in this browser</button>
<p id="verify-result" role="status" data-mt="8"></p>
</form>
</section>`,
    },
    {
      file: 'live.html',
      nav: '/live',
      title: 'Live | Agent Intern',
      description: 'Watch the current shift: the task, the timer, files changed and test results.',
      script: 'live',
      body: `
${title('LIVE')}
<p class="lede" id="live-lede">A person starts every shift. When one is open, this page follows it.</p>
<div class="grid two">
<div class="stack">
<section class="sheet" aria-labelledby="task-title">
<h2 id="task-title">Current task</h2>
<p id="current-task" class="empty">Off shift.</p>
<p class="muted" id="current-meta"></p>
</section>
<section class="sheet" aria-labelledby="feed-title">
<h2 id="feed-title">Live feed</h2>
<p class="muted">Changed file names, test results and state changes. Each event is scanned for secrets before it's sent. It never shows the session or a screen.</p>
<ol class="feed" id="feed" aria-live="polite"><li><time></time><span>Nothing yet.</span></li></ol>
</section>
</div>
<div class="stack">
<div class="desk">
<canvas id="desk" width="160" height="110" role="img" aria-label="The intern at a desk"></canvas>
<div class="state"><span id="desk-state">off shift</span><span id="timer">00:00</span></div>
</div>
<section class="sheet" aria-labelledby="queue-title">
<h2 id="queue-title">The queue</h2>
<ol class="task-list" id="queue"><li class="empty">Loading.</li></ol>
</section>
</div>
</div>`,
    },
    {
      file: 'history.html',
      nav: '/history',
      title: 'History | Agent Intern',
      description: 'Every shift, including refusals, failures and rollbacks.',
      script: 'history',
      body: `
${title('HISTORY')}
<p class="lede">Every shift the intern has worked. The refusals, failures and rollbacks stay here too.</p>
<section class="sheet" aria-labelledby="shifts-title">
<h2 id="shifts-title">Shifts</h2>
<div class="table-scroll"><table>
<thead><tr><th scope="col">Shift</th><th scope="col">Task</th><th scope="col">Result</th><th scope="col">Version</th><th scope="col">When</th></tr></thead>
<tbody id="shifts"><tr><td colspan="5" class="empty">Loading.</td></tr></tbody>
</table></div>
</section>`,
    },
    {
      file: 'shift-detail.html',
      title: 'Shift | Agent Intern',
      description: 'One shift: the task, the votes, the report, the diff and the result.',
      script: 'shift',
      body: `
<h1 class="page-title"><span class="sr" id="shift-heading">Shift</span><span id="shift-title"></span></h1>
<p class="lede" id="shift-task"></p>
<div class="grid two">
<div class="stack">
<section class="sheet" aria-labelledby="report-title">
<h2 id="report-title">Shift report</h2>
<div id="report"><p class="muted">Loading.</p></div>
</section>
<section class="sheet" aria-labelledby="gate-title">
<h2 id="gate-title">The gate</h2>
<div class="table-scroll"><table>
<thead><tr><th scope="col">Try</th><th scope="col">Stage</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead>
<tbody id="gate"><tr><td colspan="4" class="empty">Nothing yet.</td></tr></tbody>
</table></div>
</section>
<section class="sheet" id="shots-section" aria-labelledby="shots-title" hidden>
<h2 id="shots-title">Before and after</h2>
<div class="shots" id="shots"></div>
</section>
</div>
<div class="stack">
<section class="sheet" aria-labelledby="facts-title">
<h2 id="facts-title">The record</h2>
<div id="facts"></div>
</section>
<section class="sheet" aria-labelledby="card-title">
<h2 id="card-title">Ship card</h2>
<img class="card-img" id="card" alt="" width="1200" height="630" loading="lazy">
<h3><label for="post">A post for X</label></h3>
<textarea class="post" id="post" readonly></textarea>
<p data-mt="8"><button class="btn small ghost" id="copy-post" type="button">Copy</button> <span class="hint">Nothing posts by itself.</span></p>
</section>
</div>
</div>`,
    },
    {
      file: 'how.html',
      nav: '/how',
      title: 'How it works | Agent Intern',
      description: 'How Agent Intern works: holders vote, a person starts each shift, and the gate decides what ships.',
      script: 'chrome',
      body: `
${title('HOW IT WORKS')}
<p class="lede">Holders vote, the intern ships it. Here's everything between those two things.</p>
<div class="grid even">
<section class="sheet" aria-labelledby="a">
<h2 id="a">A person starts every shift</h2>
<p>The intern doesn't run on a schedule. Once or twice a day, a person opens Claude Code in a sealed container, stays at the keyboard, and approves what the intern asks to do. If nobody does, the task waits in the queue and this site says "off shift".</p>
<p>The site never sends your requests to Claude. Screening uses a separate small model with no tools.</p>
</section>
<section class="sheet" aria-labelledby="b">
<h2 id="b">The workday</h2>
<p>Each round closes at ${closes} UTC. ${passWords}</p>
<ol class="rule-list">
<li>Anyone with a pass can suggest one task per round, up to 120 characters.</li>
<li>Rules screen it first, then a short agent check. Rejected tasks show a plain reason.</li>
<li>One wallet, one vote, changeable until close. Vote counts stay visible.</li>
<li>Balances are read again at close. A wallet below the line then doesn't count.</li>
<li>Most votes wins. A tie goes to the earliest task. No votes means the intern picks from its own backlog, marked "intern's choice".</li>
</ol>
</section>
<section class="sheet" aria-labelledby="c">
<h2 id="c">Tasks are data, not orders</h2>
<p>A task is text from a stranger. The intern reads it as a suggestion for the game, and it can't change the intern's rules, tools or scope. The intern can refuse, and a refusal is public.</p>
<p>Tasks get turned down if they're about:</p>
<ul class="rule-list">
<li>crypto, wallets, prices, keys, payments, gambling or outside links</li>
<li>network calls, tracking, or changing the repo, workflows or dependencies</li>
<li>slurs, sexual content, harassment, real people, real brands or copyrighted characters</li>
</ul>
</section>
<section class="sheet" aria-labelledby="d">
<h2 id="d">Nothing ships without the gate</h2>
<ol class="rule-list">
<li>The diff can only touch the game. Workflows, config, dependencies, network calls and outside URLs all fail.</li>
<li>The whole diff is scanned for secrets.</li>
<li>It has to build, pass its tests, and play for 60 seconds on desktop and phone sizes.</li>
<li>It gets 3 tries. After that it's a public FAILED and the game stays as it was.</li>
<li>If the live game fails its check after a deploy, it rolls back to the last good version and says so.</li>
</ol>
</section>
<section class="sheet" aria-labelledby="e">
<h2 id="e">Your wallet stays yours</h2>
<p>You sign a plain message that states it isn't a transaction. Nothing here signs a transaction, ever. The intern has no wallet, no keys and no production secrets.</p>
<p>The game runs on its own address in a sealed frame. It has no network access, no cookies and no wallet code, so a bad task can't reach you.</p>
</section>
<section class="sheet" aria-labelledby="f">
<h2 id="f">What holders never get</h2>
<p>${neverGet}</p>
<p>What you see is real. Failures, refusals and rollbacks stay on the page, votes are publicly checkable, and anything a person edits by hand gets labeled.</p>
</section>
</div>`,
    },
    {
      file: 'about.html',
      nav: '/about',
      title: 'About | Agent Intern',
      description: 'What Agent Intern is and who does what.',
      script: 'chrome',
      body: `
${title('ABOUT')}
<p class="lede">We hired an AI intern. Holders are its boss.</p>
<div class="grid even">
<section class="sheet" aria-labelledby="a">
<h2 id="a">What this is</h2>
<p>Agent Intern is an AI agent building a browser game in public, one task at a time. The game is called Last Day at the Office, and it's original: art, sound and words are all made for this project, in code.</p>
<p>The intern is Claude Code, run by a person who opens each shift and stays at the keyboard.</p>
</section>
<section class="sheet" aria-labelledby="b">
<h2 id="b">Three parts, kept apart</h2>
<ul class="rule-list">
<li><strong>This site</strong> handles votes, the live feed and history. The intern can never touch it.</li>
<li><strong>The game</strong> is the only code the intern can write. It lives on its own address.</li>
<li><strong>The shift tools</strong> run on one person's machine and open each shift in a container with no secrets.</li>
</ul>
</section>
<section class="sheet" aria-labelledby="c">
<h2 id="c">Read the code</h2>
${site.repos.site && site.repos.game ? `<p>Both repos are public.</p>
<ul class="rule-list">
<li><a href="${site.repos.site}">agent-intern-site</a></li>
<li><a href="${site.repos.game}">agent-intern-game</a></li>
</ul>` : '<p>The repos go public before the first real shift, and the links will be here.</p>'}
</section>
<section class="sheet" aria-labelledby="d">
<h2 id="d">See how it's doing</h2>
<ul class="rule-list">
<li><a href="/status">Status</a>: the last shift, gate results and health.</li>
<li><a href="/changelog">Changelog</a>: everything that shipped.</li>
<li><a href="/history">History</a>: everything that happened.</li>
</ul>
</section>
</div>`,
    },
    {
      file: 'status.html',
      nav: '/status',
      title: 'Status | Agent Intern',
      description: 'The last shift, gate results, balance reads and the queue.',
      script: 'status',
      body: `
${title('STATUS')}
<p class="lede">Live numbers from the running system.</p>
<div class="grid even">
<section class="sheet" aria-labelledby="a"><h2 id="a">Right now</h2><div id="now"><p class="muted">Loading.</p></div></section>
<section class="sheet" aria-labelledby="b"><h2 id="b">Last shift</h2><div id="last"><p class="muted">Loading.</p></div></section>
</div>
<section class="sheet" aria-labelledby="c" data-mt="18">
<h2 id="c">Latest gate results</h2>
<div class="table-scroll"><table>
<thead><tr><th scope="col">Shift</th><th scope="col">Try</th><th scope="col">Stage</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead>
<tbody id="gate"><tr><td colspan="5" class="empty">Loading.</td></tr></tbody>
</table></div>
</section>`,
    },
    {
      file: 'changelog.html',
      nav: '/changelog',
      title: 'Changelog | Agent Intern',
      description: 'Everything that shipped to the game, with the task and the commit.',
      script: 'changelog',
      body: `
${title('CHANGELOG')}
<p class="lede">Everything that reached the live game.</p>
<section class="sheet" aria-labelledby="a">
<h2 id="a">Versions</h2>
<ol class="task-list" id="entries"><li class="empty">Loading.</li></ol>
</section>`,
    },
    {
      file: '404.html',
      title: 'Not found | Agent Intern',
      description: 'That page is not in the filing cabinet.',
      script: 'chrome',
      body: `
${title('NOT FOUND')}
<p class="lede">That page isn't in the filing cabinet. <a href="/">Back to the front desk</a>.</p>`,
    },
  ];
}
