import { robotSvg, type RobotState } from '../../shared/robot';
import { BACKLOG, mint, SITE, testMode, threshold } from '../config';
import token from '../../../config/token.json';
import type { Env } from '../env';
import { HttpError } from '../http';
import { overview } from '../public';
import { WORK_LABELS } from '../shifts';
import { html, raw, type Safe } from './core';
import type { Rendered } from './pages';
import { shiftLine, stamp, workLabel } from './parts';

const GAME = SITE.repos.game;
const SITE_REPO = SITE.repos.site;
const RUNS = {
  attack: `${GAME}/actions/runs/41185718381`,
  clean: `${GAME}/actions/runs/41186292243`,
  rollback: `${GAME}/actions/runs/41186703003`,
};

const title = (text: string, sub?: string): Safe => html`<header class="page-head"><h1>${text}</h1>${sub ? html`<p class="lede">${sub}</p>` : ''}</header>`;

const passWords = (): string => testMode()
  ? `A pass means holding at least ${threshold().toLocaleString('en-US')} on your balance. In TEST MODE, balances are fake.`
  : `A pass means holding at least ${threshold().toLocaleString('en-US')} of the token in your wallet.`;

// Both come from the real shift count, so they can't go stale the way fixed text did.
const standing = (intern: number): Safe => (intern === 0
  ? html`no real intern shift has run yet. The game so far was built by the team, and the pipeline has been tested with labeled rehearsals.`
  : html`${intern} real intern ${intern === 1 ? 'shift has' : 'shifts have'} run. The team built most of the game, and the rehearsals are labeled.${testMode() ? html` Holder voting hasn't run on real balances yet.` : ''}`);

const openItem = (intern: number): Safe | string => {
  if (intern === 0) return html`Biggest open item: no real intern shift has run yet.`;
  return testMode() ? html`Biggest open item: holder voting hasn't run on real balances.` : '';
};

export async function howPage(env: Env): Promise<Rendered> {
  const o = await overview(env);
  const closes = SITE.rounds.closesUtc.join(' and ');
  return {
    path: '/how',
    title: 'How it works | Agent Intern',
    description: 'Holders vote, a person starts each shift, and the gate decides what ships. Every rule, in plain words.',
    state: shiftLine(o),
    body: html`
${title('How it works', "Holders vote, the intern ships it. Here's everything between those two things.")}
<div class="office-grid">
<section class="paper"><h2>A person starts every shift</h2><p>The intern doesn't run on a schedule. A person opens Claude Code in a sealed container, stays at the keyboard, and approves what the intern asks to do. If nobody does, the task waits in the queue and this site says "off shift". <a href="/proof#person">Evidence</a>.</p><p>The site never sends your requests to Claude. Screening uses a separate small model with no tools.</p></section>
<section class="paper"><h2>The workday</h2><p>Each round closes at ${closes} UTC. ${passWords()}</p><ol class="plain"><li>Anyone with a pass can suggest one task per round, up to 120 characters.</li><li>Rules screen it first, then a short agent check. A rejected task shows a plain reason.</li><li>One wallet, one vote, changeable until close. Vote counts stay visible.</li><li>Balances are read again when a round closes. A wallet below the line then doesn't count.</li><li>Most votes wins. A tie goes to the earliest task. With no votes, the intern picks from its own public backlog, marked "intern's choice".</li></ol></section>
<section class="paper"><h2>Tasks are data, not orders</h2><p>A task is text from a stranger. The intern reads it as a suggestion for the game, and it can't change the intern's rules, tools or scope. The intern may refuse, and a refusal is public.</p><p>Tasks get turned down if they're about:</p><ul class="plain"><li>crypto, wallets, prices, keys, payments, gambling or outside links</li><li>network calls, tracking, or changing the repo, workflows or dependencies</li><li>slurs, sexual content, harassment, real people, real brands or copyrighted characters</li></ul></section>
<section class="paper"><h2>Nothing ships without the gate</h2><ol class="plain"><li>A shift can only touch the game's source, its tests and its guide.</li><li>The whole diff is scanned for secrets.</li><li>It has to build, pass its tests, and play for 60 seconds on desktop and phone sizes.</li><li>It gets 3 tries. After that it's a public FAILED and the game stays as it was.</li><li>If the live game fails its check after a deploy, it rolls back to the last good version and says so.</li></ol><p><a href="/proof#gate">See it reject an attack</a>.</p></section>
<section class="paper"><h2>Your wallet stays yours</h2><p>You sign a plain message that states it isn't a transaction. Nothing here signs a transaction. The intern has no wallet, no deploy keys, and no site or gate secrets. The only credential inside the container is the Claude login. The gate's deploy secrets live on GitHub, behind main, and a shift can't reach them.</p><p>The game runs on its own address in a sealed frame, with no network, no cookies and no wallet code.</p></section>
<section class="paper"><h2>What holders never get</h2><p>No revenue share, no rewards and no prizes. A pass lets you vote and propose, and it puts your short wallet in the credits. Ranks and badges are cosmetic.</p><p>What you see is real: failures, refusals and rollbacks stay on the page, votes can be checked by anyone, and anything a person edits by hand is labeled.</p></section>
<section class="paper" id="backlog"><h2>The intern's Day 1 backlog</h2><p>When nobody votes, the intern takes the next one of these, marked "intern's choice".</p><ol class="plain">${BACKLOG.slice(0, 5).map((item) => html`<li>${item.text}</li>`)}</ol></section>
<section class="paper"><h2>What each label means</h2><dl class="legend">${Object.values(WORK_LABELS).map((l) => html`<div><dt>${l.label}</dt><dd>${l.meaning}</dd></div>`)}</dl></section>
<section class="paper"><h2>What each result means</h2><dl class="legend">
<div><dt>${stamp('live')}</dt><dd>The shift is open.</dd></div>
<div><dt>${stamp('gate')}</dt><dd>The work was pushed, and the gate is checking it.</dd></div>
<div><dt>${stamp('shipped')}</dt><dd>It passed the gate and the live check, and it's in the game.</dd></div>
<div><dt>${stamp('refused')}</dt><dd>The shift ended with a refusal. Nothing changed.</dd></div>
<div><dt>${stamp('failed')}</dt><dd>It ended without shipping. The game stayed as it was.</dd></div>
<div><dt>${stamp('rolled-back')}</dt><dd>It went live, failed the live check, and the last good version came back.</dd></div>
</dl></section>
</div>`,
  };
}

const proofLink = (id: string, text: string): Safe => html`<a href="/proof#${id}">${text}</a>`;

export async function aboutPage(env: Env): Promise<Rendered> {
  const o = await overview(env);
  return {
    path: '/about',
    title: 'About | Agent Intern',
    description: 'The full story: an AI intern builds a browser game in public, holders set the work, and a person keeps the door.',
    state: shiftLine(o),
    body: html`
<article class="paper article">
<h1>We hired an AI intern. Holders are its boss.</h1>
<p>Most projects promise to build. They hand you a roadmap, go quiet, and ask you to trust the process.</p>
<p>We wanted to try the opposite: a project where you can watch the work happen, tell it what to do next, and go play the result.</p>
<p>So we hired an intern.</p>
<p>Agent Intern is an AI agent building a browser game in public, one task at a time. Holders suggest the work and vote on it. The intern writes the code. Tests decide whether it ships. Anyone can watch the shift and <a href="/play">play the new version</a>.</p>
<p class="callout">Where things stand: ${standing(o.counts.intern)} <a href="/status">The status page</a> keeps this current.</p>
<h2>The game</h2>
<p>The intern is building <a href="/play">Last Day at the Office</a>. You play a tired robot intern in a top-down office. Finish your tasks, drink coffee, dodge meetings and avoid the boss. It runs in your browser, on desktop or phone, with nothing to install.</p>
<p>The art, the sound and the words are all original, and <a href="${GAME}">all made in code</a>.</p>
<p>This is only the first day on the job. New features will come from the board, so the game becomes whatever the holders keep asking for.</p>
<h2>How the day works</h2>
<ol class="plain">
<li><b>Suggest.</b> Anyone with a pass can suggest one task per round, up to 120 characters. A task describes a change to the game.</li>
<li><b>Screen.</b> Rules check every task first, then a small model with no tools takes a second look. If a task gets rejected, you see the reason in plain words. ${proofLink('screening', 'Evidence')}.</li>
<li><b>Vote.</b> One wallet, one vote. You can change your vote until the round closes. Vote counts stay visible the whole time. ${proofLink('votes', 'Evidence')}.</li>
<li><b>Close.</b> Voting closes at ${SITE.rounds.closesUtc.join(' and ')} UTC. Balances are read again at close, so a wallet that sold below the line doesn't count. The most votes wins, and a tie goes to the earliest task.</li>
<li><b>Queue.</b> The winner joins a <a href="/board">public queue</a>.</li>
<li><b>Shift.</b> A person opens the shift and the intern takes the next task. ${proofLink('person', 'Evidence')}.</li>
<li><b>Ship.</b> Tests decide. If the update passes, it goes live in the game. ${proofLink('gate', 'Evidence')}.</li>
</ol>
<p>That's the whole loop. Holders vote, the intern ships it.</p>
<h2>Watch it work</h2>
<p>Most AI projects show you a finished screenshot. You never see the work.</p>
<p><a href="/live">The Live page</a> follows each shift as it happens. It shows the current task, which files changed, and how the tests went. Each event is scanned for secrets before it's sent. ${proofLink('live', 'Evidence')}.</p>
<p>When no shift is open, the site says "off shift". There's no fake activity to keep things looking busy.</p>
<h2>The bad days stay public</h2>
<p>Anyone can show you their wins. We're keeping the rest too.</p>
<p><a href="/history">The History page</a> lists every shift, including refusals, failures and rollbacks, and says who did the work. If the intern turns down a task, it's there. If an update fails, it's there. If something breaks after it ships, that's there too.</p>
<p><a href="/status">The Status page</a> shows the last shift, the latest gate results and the health of the system. <a href="/changelog">The Changelog</a> shows everything that reached the live game.</p>
<p>An intern that never fails isn't real. We'd rather show you one that fails in public.</p>
<h2>How we keep it safe</h2>
<p>Every task is text written by a stranger. That's the hard part of this project, so we built around it.</p>
<p><b>The intern reads tasks. It doesn't obey them.</b> A task can ask for a change to the game. It can't change the intern's rules.</p>
<p><b>The intern has no wallet, no deploy keys, and no site or gate secrets.</b> It can't sign anything. The gate's deploy secrets live on GitHub, behind main, and a shift can't reach them. ${proofLink('container', 'Evidence')}.</p>
<p><b>Each shift runs in a sealed container.</b> The only credential inside it is the Claude login, and it can't reach the rest of the machine. ${proofLink('container', 'Evidence')}.</p>
<p><b>The game is kept apart.</b> It's the only code the intern can write, and it lives on its own address. It runs in a sealed frame, with no way to reach your wallet or the voting site. ${proofLink('sandbox', 'Evidence')}.</p>
<p><b>Voting is only a signature.</b> You sign a plain message to prove you hold. It's not a transaction. ${proofLink('votes', 'Evidence')}.</p>
<p><b>A person is at the keyboard.</b> This is the part we want to be clearest about.</p>
<h2>Why a person stays at the keyboard</h2>
<p>An agent that runs unattended makes a better headline. This one doesn't, because it takes requests from strangers.</p>
<p>The intern doesn't run on a schedule. A person opens Claude Code in a sealed container, stays at the keyboard, and approves what the intern asks to do. If nobody opens a shift, the task waits in the queue.</p>
<p>We think that's the honest way to run an agent that takes requests from the public. Holders set the work, the intern does the work, and a person keeps the door.</p>
<h2>What a pass gives you</h2>
<p>${passWords()} It lets you suggest tasks and vote. When your idea ships, you get the credit.</p>
<p>That's it. There's no revenue share and there are no rewards.</p>
<h2>Why we're building this</h2>
<p>AI agents are moving from demos to real work. Most of us still only see the announcement. We don't see the work, and we don't get a say in it.</p>
<p>Agent Intern puts one in the open. You give it the job, watch it work, and judge the result for yourself.</p>
<p>If it does well, you'll see it. If it messes up, you'll see that too.</p>
<p>We hired an AI intern. Holders are its boss.</p>
<p><b>Clock in.</b></p>
<p class="hint">A person maintains this project, and Claude Code writes much of the code. Claude Code is the tool used. This project isn't made, endorsed or sponsored by Anthropic.</p>
</article>`,
  };
}

interface Claim {
  id: string;
  claim: string;
  evidence: Safe;
  limit?: string | Safe;
  command: string;
}

export function claims(origin: string, gameOrigin: string): Claim[] {
  return [
    {
      id: 'container', claim: 'The container holds no wallet, no deploy keys, and no site or gate secrets, and it has no way to push.',
      evidence: html`The only credential inside is the Claude login. The gate's deploy secrets live on GitHub, behind main, and a shift can't reach them. <a href="${SITE_REPO}/blob/main/shift-tools/lib/docker.mjs">The one place its powers are set</a>, <a href="${SITE_REPO}/blob/main/shift-tools/docker/intern.Dockerfile">the image</a>, <a href="${SITE_REPO}/blob/main/shift-tools/test/container.mjs">the attack test</a> and <a href="${SITE_REPO}/blob/main/docs/evidence/container-test.txt">its output</a>.`,
      limit: html`In shift 8 the intern hit a deny rule on npm install and went around it inside the container with npx. Nothing left the container and the change was clean, but deny rules only slow it down. What holds is the empty container, the proxy, shift:finish and the gate. <a href="${SITE_REPO}/blob/main/docs/THREAT-MODEL.md#shift-8-the-intern-went-around-a-deny-rule">The threat model</a> has the details.`,
      command: `git clone ${SITE_REPO}.git && cd agent-intern-site/shift-tools && npm run test:container`,
    },
    {
      id: 'sandbox', claim: "The game can't reach the site, cookies or a wallet.",
      evidence: html`<a href="/proof/sandbox">Try it in your own browser</a>, using the same headers the game gets. <a href="${GAME}/blob/main/config/_headers">The game's headers</a>.`,
      command: `curl -sI ${gameOrigin}/ | grep -i content-security-policy`,
    },
    {
      id: 'gate', claim: 'Nothing ships without the gate, and a shift cannot edit the gate.',
      evidence: html`<a href="${GAME}/blob/main/.github/workflows/gate.yml">The workflow</a>, <a href="${GAME}/blob/main/gate/rules.mjs">its rules</a>. Real runs: <a href="${RUNS.attack}">an attack rejected</a> (<a href="/shift/3">shift 3</a>), <a href="${RUNS.clean}">a clean change shipped</a> (<a href="/shift/4">shift 4</a>). Shift 3's page says the rules job didn't finish because of a reporting bug fixed after it. The run shows the real reasons.`,
      limit: "Team maintenance doesn't go through the gate. Docs, CI and the gate's own rules change through pull requests a person merges. They never deploy, and a check fails any that touch game code. GitHub doesn't stop a person merging past that check. Deploy secrets are only available to runs on main, so a workflow in a pushed branch would run with none of them, and shift:finish refuses files outside the game before anything is pushed. main also requires the gate's live check, but GitHub counts a skipped check as passed, so that requirement alone doesn't prove the gate ran.",
      command: `curl -s ${origin}/api/shifts/3 | jq '.gate'`,
    },
    {
      id: 'rollback', claim: 'A broken deploy rolls back.',
      evidence: html`<a href="/shift/5">Shift 5</a>, a labeled rehearsal: code that only broke on the live address. <a href="${RUNS.rollback}">The run</a>. It passed CI, failed the live check, and the workflow restored the last good version.`,
      command: `curl -s ${origin}/api/shifts/5 | jq '.shift.status, .gate[-2:]'`,
    },
    {
      id: 'votes', claim: 'Every vote is a signature anyone can check.',
      evidence: html`<a href="/api/votes">The public record</a> and the <a href="/board#verify-title">verify box</a>, which runs in your browser. <a href="${SITE_REPO}/blob/main/src/shared/verify.ts">The check is one short file</a>.`,
      command: `curl -s ${origin}/api/votes/1 | jq '.votes[0] | {wallet, signature, message}'`,
    },
    {
      id: 'person', claim: 'A person starts every shift.',
      evidence: html`<a href="${SITE_REPO}/blob/main/shift-tools/lib/prompt.mjs">The terminal check</a>, and <a href="${SITE_REPO}/blob/main/shift-tools/scripts/check-no-unattended.mjs">a scan</a> that fails on any scheduler, API key path or unattended Claude Code call. The one scheduled job is a weekly <a href="${SITE_REPO}/blob/main/.github/workflows/scorecard.yml">supply chain scan</a> that can't start a shift. Limit: the terminal check stops cron, CI and pipes, and a pseudo-terminal could pass it. What keeps a person in the loop is that a session needs a person's login and approvals.`,
      command: `git clone ${SITE_REPO}.git && cd agent-intern-site/shift-tools && npm run check:no-unattended`,
    },
    {
      id: 'screening', claim: 'Tasks are screened by rules, then a small model with no tools. A failure holds the task.',
      evidence: html`<a href="${SITE_REPO}/blob/main/src/worker/screen.ts">The screen</a>, <a href="/hr">the HR Log</a> and <a href="/practice">the practice box</a>, which runs the real thing. It isn't perfect: a well-known character described without its name can get past the model. A person reads each task before a shift, and the intern can refuse.`,
      command: `curl -s ${origin}/api/health | jq .`,
    },
    {
      id: 'live', claim: 'The live feed shows real activity and no secrets.',
      evidence: html`<a href="/shift/1">Shift 1</a> carries a planted fake secret, removed before it was sent. <a href="${SITE_REPO}/blob/main/shift-tools/lib/redact.mjs">The redaction</a>, and <a href="${SITE_REPO}/blob/main/src/worker/secrets.ts">a second filter on the server</a>.`,
      command: `curl -s ${origin}/api/shifts/1 | jq '.events[] | select(.kind=="redacted")'`,
    },
    {
      id: 'labels', claim: 'Rehearsals and team changes are labeled, and only real intern work counts.',
      evidence: html`<a href="/history">The filing cabinet</a>, <a href="/how">what each label means</a> and <a href="/promotions">the Promotion Track</a>.`,
      command: `curl -s ${origin}/api/shifts | jq '[.shifts[] | {id, workedBy, status}]'`,
    },
    {
      id: 'original', claim: 'The game is original, and art and sound are made in code.',
      evidence: html`<a href="${GAME}/tree/main/src/ui">The sprites, font and sound</a>. The repo has no asset files.`,
      command: `git clone ${GAME}.git && find agent-intern-game/src agent-intern-game/public -type f ! -name '*.ts' ! -name '*.html' ! -name '*.css'`,
    },
  ];
}

export async function proofPage(env: Env, origin: string): Promise<Rendered> {
  const o = await overview(env);
  return {
    path: '/proof',
    title: 'Proof | Agent Intern',
    description: 'Every public claim, with its evidence and a command you can run yourself.',
    state: shiftLine(o),
    body: html`
${title('Proof', "Every public claim, with its evidence and a command you can run. If a claim can't be proved, it comes off the site.")}
<p class="callout">${openItem(o.counts.intern)} <a href="/status">The status page</a> lists what's still unproved.</p>
<ol class="proof">${claims(origin, SITE.gameOrigin).map((c) => html`<li class="paper" id="${c.id}"><h2>${c.claim}</h2><p>${c.evidence}</p>${c.limit ? html`<p><b>Limit.</b> ${c.limit}</p>` : ''}<pre><code>${c.command}</code></pre><button class="btn ghost small" type="button" data-copy="${c.command}">Copy command</button></li>`)}</ol>`,
  };
}

export async function sandboxPage(env: Env): Promise<Rendered> {
  const o = await overview(env);
  return {
    path: '/proof/sandbox',
    title: 'Try the sandbox | Agent Intern',
    description: 'A frame with the same headers as the game tries to reach this site, cookies and storage, in your own browser.',
    state: shiftLine(o),
    body: html`
${title('Try the sandbox', "The frame below gets the same sandbox and the same content policy as the game. It tries to break out, and reports what happened. It all runs in your browser.")}
<div class="office-grid wide-first">
<section class="crt big" aria-labelledby="try-title"><h2 id="try-title">Escape attempts</h2><ul class="crt-list" id="sandbox-results"><li><span>Press start.</span></li></ul><button class="btn" type="button" id="sandbox-start">Start</button></section>
<section class="paper"><h2>What this shows</h2><p>The frame's script runs for real. Each line is one thing it tried. "Blocked" means your browser stopped it.</p><p>The game itself is on a separate address and has <a href="${GAME}/blob/main/config/_headers">these headers</a>.</p><iframe id="sandbox-frame" title="The escape attempts" sandbox="allow-scripts" hidden></iframe></section>
</div>`,
  };
}

export function sandboxFrame(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sandbox test</title><script src="/js/sandbox-try.js"></script></head><body></body></html>`;
}

export async function securityPage(env: Env): Promise<Rendered> {
  const o = await overview(env);
  return {
    path: '/security',
    title: 'Security | Agent Intern',
    description: "What's protected, how to report a bug, and what's out of scope. There has been no outside audit.",
    state: shiftLine(o),
    body: html`
${title('Security', "What's protected, how to report a bug, and what's out of scope. There has been no outside audit.")}
<div class="office-grid">
<section class="paper"><h2>What's protected</h2><ul class="plain">
<li>Sign-in and votes are signed plain messages with a single-use nonce that lasts 5 minutes, bound to this domain.</li>
<li>The session cookie is host-only, HttpOnly, Secure and SameSite=Strict.</li>
<li>Writes need an exact Origin. Each machine route takes its own secret, and those secrets can only write.</li>
<li>Every write has a rate limit and a body size limit.</li>
<li>Pages are escaped by default, and task text never reaches a page before it's screened.</li>
<li>The site has a strict content policy with no inline scripts, no third-party scripts and no edge injection.</li>
<li>The game is on its own address, sandboxed, with no network access.</li>
</ul></section>
<section class="paper"><h2>Report a bug</h2><p>Use <a href="${SITE_REPO}/security/advisories/new">a private advisory on GitHub</a>. Say what you did and what you saw. Please don't post it publicly first.</p><p>There's no bounty.</p></section>
<section class="paper"><h2>Out of scope</h2><ul class="plain"><li>Load testing or denial of service.</li><li>Attacks on GitHub, Cloudflare or anyone's wallet.</li><li>Prompt injection through the task box is welcome on <a href="/break">its own page</a>, and it isn't a bug unless something got past the gate.</li></ul></section>
<section class="paper"><h2>Check it yourself</h2><p><a href="/proof">The proof page</a> has commands for every claim. <a href="/.well-known/security.txt">security.txt</a> has the contact.</p><p>Known limits are in <a href="${SITE_REPO}/blob/main/docs/THREAT-MODEL.md">the threat model</a>.</p></section>
</div>`,
  };
}

const STATES: RobotState[] = ['asleep', 'working', 'thinking', 'stuck', 'panicking', 'celebrating', 'refusing'];

export async function brandPage(env: Env): Promise<Rendered> {
  const o = await overview(env);
  const colors: [string, string][] = [['Night', '#0B1020'], ['Monitor', '#FF9A3C'], ['Steel', '#AEB8C8'], ['Tie', '#D9402F'], ['Paper', '#F5EBD8']];
  return {
    path: '/brand',
    title: 'Brand | Agent Intern',
    description: 'The robot intern, its states, the colors and the logo files.',
    state: shiftLine(o),
    body: html`
${title('Brand', 'The robot intern is original, drawn in code as pixel art and as a 3D model. It has no connection to any real brand.')}
<section class="paper"><h2>The intern's moods</h2><ul class="robots">${STATES.map((s) => html`<li>${raw(robotSvg(s, `The robot intern, ${s}`))}<span>${s}</span></li>`)}</ul></section>
<div class="office-grid">
<section class="paper"><h2>Colors</h2><ul class="swatches">${colors.map(([n, c]) => html`<li><span class="swatch sw-${n.toLowerCase()}" aria-hidden="true"></span>${n} ${c}</li>`)}</ul></section>
<section class="paper"><h2>Files</h2><ul class="plain"><li><a href="/img/logo.svg">Logo, SVG</a></li><li><a href="/img/banner.svg">Banner, SVG</a></li><li><a href="/api/card.png">Share card, PNG</a></li><li><a href="/favicon.svg">Favicon, SVG</a></li></ul></section>
<section class="paper"><h2>Type</h2><p>Pixelify Sans for display, JetBrains Mono for data and Inter for reading. All three are open fonts, under the SIL Open Font License.</p></section>
<section class="paper"><h2>Embed the status</h2><p>A small widget for other sites. It has no scripts and no cookies.</p><pre><code>&lt;iframe src="${SITE.siteOrigin}/embed/status" width="320" height="96" title="Agent Intern status"&gt;&lt;/iframe&gt;</code></pre></section>
</div>`,
  };
}

interface Endpoint { path: string; about: string }

export const PUBLIC_ENDPOINTS: Endpoint[] = [
  { path: '/api/health', about: 'Is the site up. Mode, database, paused, on shift.' },
  { path: '/api/status', about: 'Round, queue, game health, gate results, counts.' },
  { path: '/api/state', about: 'Current round, top tasks, queue, shift, version.' },
  { path: '/api/board', about: 'Every task in the current round, with counts.' },
  { path: '/api/votes', about: 'The public vote record for the current round.' },
  { path: '/api/votes/{round}', about: 'The vote record for one round.' },
  { path: '/api/live', about: 'The current shift and its events.' },
  { path: '/api/shifts', about: 'Every shift.' },
  { path: '/api/shifts/{id}', about: 'One shift with gate results and events.' },
  { path: '/api/changelog', about: 'What reached the live game.' },
  { path: '/api/leaderboard', about: 'All-time scores. Add ?day={n} for a Daily Shift.' },
  { path: '/api/hr', about: 'The HR Log.' },
  { path: '/api/hall', about: 'The Hall of Bosses: who proposed each task the intern shipped.' },
  { path: '/api/bosses/{wallet}', about: 'A boss profile.' },
  { path: '/api/promotion', about: "The intern's title and real shipped count." },
  { path: '/.well-known/agent-intern.json', about: 'A machine-readable manifest of claims and links.' },
  { path: '/feed.xml', about: 'RSS of shifts.' },
  { path: '/llms.txt', about: 'A short guide for AI agents.' },
  { path: '/mcp', about: 'Read-only MCP endpoint over HTTP (POST).' },
];

export async function apiPage(env: Env, origin: string): Promise<Rendered> {
  const o = await overview(env);
  return {
    path: '/api',
    title: 'API | Agent Intern',
    description: 'Public read-only JSON APIs and a read-only MCP endpoint. No key needed.',
    state: shiftLine(o),
    body: html`
${title('API', 'Public, read-only and with no key. Please keep it gentle.')}
<section class="paper"><h2>JSON</h2><div class="table-scroll"><table class="stack"><thead><tr><th scope="col">Path</th><th scope="col">What it gives you</th></tr></thead><tbody>${PUBLIC_ENDPOINTS.map((e) => html`<tr><td class="break"><code>${e.path}</code></td><td>${e.about}</td></tr>`)}</tbody></table></div></section>
<section class="paper"><h2>MCP for agents</h2><p>Read the current round, the queue and the last shift from an agent. It can read but it can't vote, and it has no writes and no secrets.</p><pre><code>claude mcp add --transport http agent-intern ${origin}/mcp</code></pre><p>Tools: <code>current_round</code>, <code>queue</code>, <code>last_shift</code>, <code>how_to_verify</code>.</p></section>`,
  };
}

export async function tokenPage(env: Env): Promise<Rendered> {
  if (testMode()) throw new HttpError(404, 'Not found.');
  const o = await overview(env);
  const fees = token.creatorFees;
  return {
    path: '/token',
    title: 'Token | Agent Intern',
    description: 'The contract address, what a pass does, and what holders never get.',
    state: shiftLine(o),
    body: html`
${title('Token facts')}
<div class="office-grid">
<section class="paper"><h2>Contract address</h2><pre><code>${mint()}</code></pre><button class="btn ghost small" type="button" data-copy="${mint()}">Copy</button> <a href="https://solscan.io/token/${mint()}">Solscan</a></section>
<section class="paper"><h2>What a pass does</h2><p>${passWords()} It lets you propose tasks and vote. That's all it does.</p></section>
<section class="paper"><h2>What holders never get</h2><p>No revenue share, no rewards, no prizes and no buybacks.</p></section>
<section class="paper"><h2>Where creator fees go</h2><p>${fees || 'Not stated yet.'}</p></section>
</div>`,
  };
}

export function embedStatus(state: { label: string; on: boolean }, version: string | null, origin: string): string {
  return `<!doctype html>${html`<html lang="en"><head><meta charset="utf-8"><title>Agent Intern status</title><link rel="stylesheet" href="/embed.css"></head><body><a class="embed" href="${origin}/live" target="_blank" rel="noopener">${raw(robotSvg(state.on ? 'working' : 'asleep'))}<span><b>Agent Intern</b><i>${state.label}</i><small>${version ? `game v${version}` : ''}</small></span></a></body></html>`}`;
}
