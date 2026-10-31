import { dailySeed, dayNumber } from '../../shared/daily';
import type { ProposalRow } from '../board';
import { SITE, testMode } from '../config';
import { publicVotes } from '../board';
import { shipCardPost } from '../card';
import type { Env } from '../env';
import { HttpError } from '../http';
import { bossProfile, BOSS_RANKS, getProposal, hallOfBosses, hrLog, overview, PROMOTIONS, promotionLevel, shiftCounts, shiftRating } from '../public';
import { leaderboard } from '../scores';
import { getShift, listShifts, WORK_LABELS } from '../shifts';
import { changelog, liveFeed, shiftDetail, status as statusData } from '../status';
import { html, shortAddress, when, type Safe } from './core';
import type { Page } from './layout';
import { inTray, passLine, punchClock, robotFor, robotPanel, shiftLine, shiftRow, stamp, STATE_WORDS, whiteboard, workLabel } from './parts';

const title = (text: string, sub?: string): Safe => html`<header class="page-head"><h1>${text}</h1>${sub ? html`<p class="lede">${sub}</p>` : ''}</header>`;

export type Rendered = Page & { state: ReturnType<typeof shiftLine> };

export async function homePage(env: Env): Promise<Rendered> {
  const o = await overview(env);
  const state = robotFor(o.open, o.last, o.pause.paused);
  return {
    path: '/',
    title: 'Agent Intern',
    description: 'We hired an AI intern. Holders are its boss. Holders vote, the intern ships it, and a person starts every shift.',
    refresh: 45,
    state: shiftLine(o),
    body: html`
<section class="hero" aria-labelledby="hero-title">
<div class="scene" id="scene" data-state="${state}" data-level="${o.level.index}" data-on="${o.open ? '1' : '0'}" data-closes="${o.round.closes_at}" data-commit="${o.lastCommit ? `${o.lastCommit.sha.slice(0, 7)} ${o.lastCommit.message}` : 'no commits yet'}">
<div class="scene-fallback">${robotPanel(state, `The robot intern, ${state}`)}</div>
</div>
<div class="hero-copy">
<h1 id="hero-title">We hired an AI intern. <em>Holders are its boss.</em></h1>
<p class="sub">It builds a browser game in public. Holders vote, the intern ships it. A person starts every shift, and the bad days stay on the page.</p>
<div class="btn-row"><a class="btn big" href="/play">Play the game</a><a class="btn ghost" href="/board">Vote on the next task</a><a class="btn ghost" href="/proof">Check the claims</a></div>
</div>
</section>
<div data-live="home" id="home-live">
<div class="office-grid">
<section class="desk-card" aria-labelledby="now-title">
<h2 id="now-title">Right now</h2>
<p class="now-line"><b>${shiftLine(o).label}</b>${o.open ? html` · shift ${o.open.id}: ${o.open.task_text}` : ''}</p>
${punchClock(o.round.closes_at)}
<dl class="facts">
<div><dt>Round</dt><dd>${o.round.id}, ${o.round.status}</dd></div>
<div><dt>Game</dt><dd>${o.version ? `v${o.version}` : 'v0.1.0'}</dd></div>
<div><dt>Intern's title</dt><dd><a href="/promotions">${o.level.title}</a></dd></div>
<div><dt>Real intern shifts</dt><dd>${o.counts.intern}</dd></div>
${testMode() ? '' : html`<div><dt>Founding Bosses</dt><dd>${o.founding} of 100</dd></div>`}
</dl>
${o.counts.intern === 0 ? html`<p class="day-one"><b>Day 1.</b> No real intern shift has run yet. The first one lands right here, good or bad.</p>` : ''}
</section>
<section class="tray-card" aria-labelledby="tray-title">
<h2 id="tray-title">The in-tray</h2>
<p class="muted">This round's top tasks.</p>
${inTray(o.proposals)}
<p><a href="/board">See every task and vote</a> · <a href="/practice">Try it with no wallet</a></p>
</section>
<section class="board-card" aria-labelledby="queue-title">
<h2 id="queue-title">The queue</h2>
${whiteboard(o.queue)}
</section>
<section class="stamp-card" aria-labelledby="last-title">
<h2 id="last-title">Last shift</h2>
${o.last ? html`<p><a href="/shift/${o.last.id}">Shift ${o.last.id}</a>: ${o.last.task_text}</p><p class="marks">${workLabel(o.last.worked_by)}${stamp(o.last.status)}</p>` : html`<p class="empty">No shifts yet.</p>`}
<p><a href="/history">Open the filing cabinet</a></p>
</section>
</div>
</div>
<section class="steps-card" aria-labelledby="how-title">
<h2 id="how-title">How the day goes</h2>
<ol class="steps">
<li><b>Suggest</b> Holders pin tasks to the board.</li>
<li><b>Screen</b> Rules, then a small model with no tools.</li>
<li><b>Vote</b> One wallet, one vote, until ${SITE.rounds.closesUtc.join(' and ')} UTC.</li>
<li><b>Shift</b> A person starts it and stays at the keyboard.</li>
<li><b>Gate</b> Tests decide. Bad days stay public.</li>
</ol>
<p><a href="/how">The full rules</a></p>
</section>`,
  };
}

function scoreList(rows: { name: string; score: number }[], empty: string): Safe {
  if (rows.length === 0) return html`<p class="empty">${empty}</p>`;
  return html`<ol class="scores">${rows.slice(0, 10).map((row, i) => html`<li><span>${i + 1}. ${row.name}</span><b>${row.score.toLocaleString('en-US')}</b></li>`)}</ol>`;
}

export async function playPage(env: Env, day?: number): Promise<Rendered> {
  const today = dayNumber(Date.now());
  const shown = day ?? today;
  if (shown < 1 || shown > today) throw new HttpError(404, 'That day has not happened.');
  const [daily, allTime, o, hall] = await Promise.all([leaderboard(env, shown), leaderboard(env), overview(env), hallOfBosses(env)]);
  return {
    path: day ? `/play/${day}` : '/play',
    title: day ? `Daily Shift #${day} | Agent Intern` : 'Play | Agent Intern',
    description: 'Last Day at the Office: finish tasks, drink coffee, dodge meetings, avoid the boss. One Daily Shift for everyone.',
    image: day ? `${new URL(SITE.siteOrigin).origin}/api/daily/${day}/card.png` : undefined,
    refresh: 120,
    state: shiftLine(o),
    body: html`
<h1 class="sr">Last Day at the Office${day ? `, Daily Shift ${day}` : ''}</h1>
<div class="play-frame" id="play-frame"><iframe id="game" title="Last Day at the Office" src="${env.GAME_ORIGIN || SITE.gameOrigin}/" sandbox="allow-scripts" referrerpolicy="no-referrer" data-day="${day ?? ''}" data-seed="${dailySeed(shown)}" data-today="${today}" data-hall="${JSON.stringify(hall)}"></iframe></div>
<p class="muted play-note">The game runs in a sealed frame with no way to reach your wallet or this site. <a href="/proof#sandbox">Prove it</a>.</p>
<div class="office-grid">
<section class="paper" aria-labelledby="score-title">
<h2 id="score-title">Timesheet</h2>
<p class="empty" id="score-empty">Finish a run and your score lands here.</p>
<form id="score-form" hidden>
<p id="score-line">You scored <b id="score-value">0</b>.</p>
<div class="field"><label for="score-name">Name on the board</label>
<input id="score-name" name="name" maxlength="16" autocomplete="nickname" required pattern="[A-Za-z0-9 _\\-]{1,16}"></div>
<button class="btn" type="submit">Post score</button>
<p id="score-message" role="status"></p>
</form>
<div id="share-box" hidden>
<h3>Your result</h3>
<pre id="share-text"></pre>
<div class="btn-row"><button class="btn ghost small" type="button" id="share-copy">Copy</button><a class="btn ghost small" id="share-x" href="https://x.com/intent/post">Post on X</a></div>
</div>
</section>
<section class="paper" aria-labelledby="daily-title" data-live="daily-board" id="daily-board">
<h2 id="daily-title">Daily Shift #${shown}</h2>
${scoreList(daily, 'Nobody has clocked in today. The office is all yours.')}
</section>
<section class="paper" aria-labelledby="alltime-title" data-live="all-board" id="all-board">
<h2 id="alltime-title">All time</h2>
${scoreList(allTime, 'Nobody yet. The desk is yours.')}
</section>
</div>`,
  };
}

function proposalRow(p: ProposalRow): Safe {
  if (p.status === 'screening') {
    return html`<li class="sheet-note"><span class="empty">A task is being checked.</span><span class="stamp note">in review</span></li>`;
  }
  return html`<li class="sheet-note" data-proposal="${p.id}">
<a href="/task/${p.id}">${p.text}</a>
<span class="note-foot"><b>${p.votes}</b> ${p.votes === 1 ? 'vote' : 'votes'} · by <a href="/boss/${p.wallet}">${shortAddress(p.wallet)}</a></span>
<button class="btn small ghost" type="button" data-vote="${p.id}" disabled>Vote</button>
</li>`;
}

export async function boardPage(env: Env): Promise<Rendered> {
  const o = await overview(env);
  const open = o.proposals.filter((p) => p.status === 'open' || p.status === 'screening');
  const rejected = o.proposals.filter((p) => p.status === 'rejected');
  const record = (await publicVotes(env, o.round.id)) as { votes: { wallet: string; proposal: number; signature: string; message: string; slot: number; balance: string }[] };
  return {
    path: '/board',
    title: 'The Board | Agent Intern',
    description: 'Suggest a task for the intern and vote on what it does next. Every vote is a signature anyone can check.',
    refresh: 45,
    state: shiftLine(o),
    body: html`
${title('The Board', "One wallet, one vote, and you can change it until the round closes. A task describes a change to the game. It can't change the intern's rules.")}
<div class="office-grid wide-first">
<div class="stack">
<section class="tray-card" aria-labelledby="round-title" data-live="proposals" id="proposals-box" data-round="${o.round.id}" data-open="${o.round.status === 'open' && !o.pause.paused ? '1' : '0'}">
<h2 id="round-title">Round ${o.round.id}</h2>
${punchClock(o.round.closes_at)}
${open.length ? html`<ol class="tray" id="proposals">${open.map(proposalRow)}</ol>` : html`<p class="empty">No tasks this round. Be the first boss of the day.</p>`}
</section>
<section class="paper" aria-labelledby="rejected-title" data-live="rejected" id="rejected-box">
<h2 id="rejected-title">Turned down this round</h2>
${rejected.length ? html`<ol class="plain">${rejected.map((p) => html`<li>A task from ${shortAddress(p.wallet)} ${stamp('refused')}<small>${p.reason ?? ''}</small></li>`)}</ol>` : html`<p class="empty">Nothing yet.</p>`}
<p class="muted">The words of a rejected task never go on this page. <a href="/hr">The HR Log</a> shows the ones that are safe to read.</p>
</section>
</div>
<div class="stack">
<section class="badge-card" aria-labelledby="pass-title">
<h2 id="pass-title">Your ID badge</h2>
<div id="pass" data-threshold="${passLine()}"><p>Connect a Solana wallet and sign a plain message. It isn't a transaction and it costs nothing. A pass needs ${passLine()}.</p><p class="muted">Needs JavaScript. <a href="/practice">The practice board</a> needs no wallet.</p></div>
</section>
<section class="paper" aria-labelledby="propose-title">
<h2 id="propose-title">Pin a task</h2>
<form id="propose-form">
<div class="field"><label for="task-text">What should the intern change in the game?</label>
<textarea id="task-text" name="text" rows="3" maxlength="120" required></textarea>
<span class="hint"><span id="task-count">0</span> of 120. One task per round.</span></div>
<button class="btn" type="submit" id="propose-button" disabled>Sign and submit</button>
<p id="propose-message" role="status"></p>
</form>
</section>
<section class="board-card" aria-labelledby="queue-title" data-live="queue" id="queue-box">
<h2 id="queue-title">The queue</h2>
${whiteboard(o.queue)}
</section>
</div>
</div>
<section class="paper" aria-labelledby="record-title" data-live="record" id="record-box">
<h2 id="record-title">Public record</h2>
<p class="muted">Every vote this round, with its signature, slot and balance. <a href="/api/votes/${o.round.id}">Read it as JSON</a>. Verify runs in your own browser, with no help from this site.</p>
<div class="table-scroll"><table>
<thead><tr><th scope="col">Wallet</th><th scope="col">Voted for</th><th scope="col" class="num">Balance</th><th scope="col" class="num">Slot</th><th scope="col">Check</th></tr></thead>
<tbody>${record.votes.length ? record.votes.slice(0, 100).map((v) => html`<tr><td class="break">${shortAddress(v.wallet)}</td><td>#${v.proposal}</td><td class="num">${v.balance}</td><td class="num">${v.slot}</td><td><button class="btn small ghost" type="button" data-verify data-wallet="${v.wallet}" data-signature="${v.signature}" data-message="${v.message}">Verify</button><span role="status"></span></td></tr>`) : html`<tr><td colspan="5" class="empty">No votes yet.</td></tr>`}</tbody>
</table></div>
</section>
<section class="paper" aria-labelledby="verify-title">
<h2 id="verify-title">Verify any signature</h2>
<form id="verify-form">
<div class="field"><label for="verify-wallet">Wallet</label><input id="verify-wallet" autocomplete="off" required></div>
<div class="field"><label for="verify-message">Message</label><textarea id="verify-message" rows="5" required></textarea></div>
<div class="field"><label for="verify-signature">Signature</label><input id="verify-signature" autocomplete="off" required></div>
<button class="btn ghost" type="submit">Verify in this browser</button>
<p id="verify-result" role="status"></p>
</form>
</section>`,
  };
}

export async function practicePage(env: Env): Promise<Rendered> {
  const o = await overview(env);
  return {
    path: '/practice',
    title: 'Practice board | Agent Intern',
    description: 'Try proposing and voting with no wallet. It runs the real screening and never touches the real queue.',
    refresh: 0,
    state: shiftLine(o),
    body: html`
${title('Practice board', 'No wallet. Your task goes through the real screening, and everything else stays in this browser. It never reaches the real board or the queue.')}
<div class="practice-flag" role="note"><b>PRACTICE</b> Nothing here is a real task or a real vote. The sample tasks are examples.</div>
<div class="office-grid wide-first">
<section class="tray-card" aria-labelledby="ptray-title"><h2 id="ptray-title">Practice in-tray</h2><ol class="tray" id="practice-list"><li class="sheet-note">Add a sleepy cat that blocks the hallway</li><li class="sheet-note">Make the boss slip on a banana peel</li></ol>
<div class="btn-row"><button class="btn ghost" type="button" id="practice-close">Close the practice round</button></div><p id="practice-result" role="status"></p></section>
<section class="paper" aria-labelledby="ppin-title"><h2 id="ppin-title">Pin a practice task</h2>
<form id="practice-form"><div class="field"><label for="practice-text">What should the intern change?</label><textarea id="practice-text" rows="3" maxlength="120" required></textarea></div>
<button class="btn" type="submit">Check it</button><p id="practice-message" role="status"></p></form>
<p class="muted">The real flow: <a href="/board">sign in on the board</a>, propose, vote, and watch the close. In TEST MODE, balances are fake.</p></section>
</div>`,
  };
}

export async function livePage(env: Env): Promise<Rendered> {
  const [o, feed] = await Promise.all([overview(env), liveFeed(env, 0)]);
  const events = feed.events as { id: number; at: number; kind: string; data: Record<string, unknown> }[];
  const robot = robotFor(o.open, o.last, o.pause.paused);
  return {
    path: '/live',
    title: 'Live | Agent Intern',
    description: 'Follow the current shift: the task, changed files, test results and state. It says off shift when nobody is working.',
    refresh: o.open ? 10 : 60,
    state: shiftLine(o),
    body: html`
${title('Live', 'A person starts every shift. When one is open, this page follows it. When none is, it says so.')}
<div data-live="live" id="live-box">
<div class="office-grid wide-first">
<section class="crt big" aria-labelledby="feed-title">
<h2 id="feed-title">${o.open ? `Shift ${o.open.id}` : 'Off shift'}</h2>
<p class="crt-line">${o.open ? o.open.task_text : o.pause.paused ? `Paused: ${o.pause.reason ?? ''}` : 'The queue waits until a person starts the next shift.'}</p>
<ol class="feed" aria-live="polite">${events.length ? events.map(feedLine) : html`<li><span>Nothing yet.</span></li>`}</ol>
<p class="crt-note">Changed file names, test counts and state changes. Each event is scanned for secrets before it leaves the machine. Sessions and screens are never streamed.</p>
</section>
<div class="stack">
<section class="desk-card"><h2>The desk</h2><div class="mini-robot">${robotPanel(robot, `The robot intern, ${robot}`)}</div><p class="now-line"><b>${o.open ? STATE_WORDS[o.open.state] ?? o.open.state : 'asleep'}</b></p>${o.open ? html`<p>${workLabel(o.open.worked_by)}</p><p class="punch mini"><span class="punch-label">On shift for</span><b data-elapsed="${o.open.started_at}">--:--</b></p>` : ''}</section>
<section class="board-card" aria-labelledby="queue-title"><h2 id="queue-title">The queue</h2>${whiteboard(o.queue)}</section>
<section class="desk-card"><h2>Tell me when</h2><p class="muted">A browser notification when a shift starts, a vote is about to close or a task ships. It's optional, and RSS works too.</p>${SITE.vapidPublic ? html`<button class="btn ghost small" type="button" id="notify" data-key="${SITE.vapidPublic}" hidden>Turn on notifications</button><p id="notify-message" role="status"></p>` : ''}<p><a href="/feed.xml">RSS feed</a></p></section>
</div>
</div>
</div>`,
  };
}

function feedLine(event: { id: number; at: number; kind: string; data: Record<string, unknown> }): Safe {
  const d = event.data;
  const time = new Date(event.at).toISOString().slice(11, 19);
  let text = event.kind;
  let tone = '';
  if (event.kind === 'state') {
    text = `state: ${STATE_WORDS[String(d.state)] ?? String(d.state)}`;
    tone = 'hl';
  } else if (event.kind === 'file') {
    text = `${String(d.change)} ${String(d.path)}`;
  } else if (event.kind === 'test') {
    text = `tests: ${Number(d.passed)} passed, ${Number(d.failed)} failed`;
    tone = Number(d.failed) > 0 ? 'fail' : 'pass';
  } else if (event.kind === 'gate') {
    text = `gate: ${String(d.stage)} ${String(d.status)}${d.detail ? `, ${String(d.detail)}` : ''}`;
    tone = d.status === 'pass' ? 'pass' : 'fail';
  } else if (event.kind === 'redacted') {
    text = 'one event removed: it looked like a secret';
    tone = 'fail';
  }
  return html`<li><time>${time}</time><span class="${tone}">${text}</span></li>`;
}

export async function historyPage(env: Env): Promise<Rendered> {
  const [o, shifts] = await Promise.all([overview(env), listShifts(env, 200)]);
  return {
    path: '/history',
    title: 'History | Agent Intern',
    description: 'Every shift, including refusals, failures and rollbacks, each labeled by who did the work.',
    refresh: 120,
    state: shiftLine(o),
    body: html`
${title('The filing cabinet', 'Every shift, with who did the work. Refusals, failures and rollbacks stay here too.')}
<dl class="legend">${Object.values(WORK_LABELS).map((l) => html`<div><dt>${l.label}</dt><dd>${l.meaning}</dd></div>`)}</dl>
<div data-live="history" id="history-box">
${o.counts.intern === 0 ? html`<p class="callout">No real intern shift yet. Everything below is a rehearsal, a team change or a shift nobody worked.</p>` : ''}
${shifts.length ? html`<ol class="cabinet">${shifts.map(shiftRow)}</ol>` : html`<p class="empty">No shifts yet. The intern just got its badge.</p>`}
</div>`,
  };
}

export async function shiftPage(env: Env, id: number): Promise<Rendered> {
  const row = await getShift(env, id);
  if (!row) throw new HttpError(404, 'No such shift.');
  const [o, detail, rating] = await Promise.all([overview(env), shiftDetail(env, id), shiftRating(env, id)]);
  const gate = detail.gate as { attempt: number; stage: string; status: string; detail: string | null }[];
  const events = detail.events as { id: number; at: number; kind: string; data: Record<string, unknown> }[];
  const shots = detail.shots as string[];
  const open = row.status === 'live' || row.status === 'gate';
  const post = shipCardPost(row, SITE.siteOrigin);
  const commit = row.commit_sha ? `${SITE.repos.game}/commit/${row.commit_sha}` : null;
  return {
    path: `/shift/${id}`,
    title: `Shift ${id}: ${row.status} | Agent Intern`,
    description: row.task_text,
    image: `${SITE.siteOrigin}/api/shifts/${id}/card.png`,
    refresh: open ? 15 : 0,
    state: shiftLine(o),
    body: html`
<header class="page-head"><h1>Shift ${id}</h1><p class="marks">${workLabel(row.worked_by)}${stamp(row.status)}</p><p class="lede">${row.task_text}</p>${WORK_LABELS[row.worked_by] ? html`<p class="muted">${WORK_LABELS[row.worked_by]?.meaning}</p>` : ''}</header>
<div class="office-grid wide-first" data-live="shift" id="shift-box">
<div class="stack">
<section class="paper" aria-labelledby="report-title"><h2 id="report-title">Shift report</h2>
${row.note ? html`<blockquote>${row.note}</blockquote>` : html`<p class="empty">No note on this one.</p>`}
${row.summary ? html`<p>${row.summary}</p>` : ''}</section>
<section class="paper" aria-labelledby="replay-title"><h2 id="replay-title">Shift replay</h2>
<ol class="timeline" id="replay" data-status="${row.status}" data-task="${row.task_text}" data-id="${id}">${events.length ? events.map(feedLine) : html`<li><span class="empty">No events on this one.</span></li>`}</ol>
${events.length ? html`<div class="btn-row"><button class="btn ghost small" type="button" id="replay-play">Play it back</button><button class="btn ghost small" type="button" id="replay-clip">Save a 10 second clip</button></div>` : ''}</section>
<section class="paper" aria-labelledby="gate-title"><h2 id="gate-title">The gate</h2>
<div class="table-scroll"><table><thead><tr><th scope="col">Try</th><th scope="col">Stage</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead>
<tbody>${gate.length ? gate.map((g) => html`<tr><td>${g.attempt}</td><td>${g.stage}</td><td><span class="stamp ${g.status === 'pass' ? 'good' : 'bad'}">${g.status}</span></td><td class="break">${g.detail ?? ''}</td></tr>`) : html`<tr><td colspan="4" class="empty">Nothing reached the gate.</td></tr>`}</tbody></table></div></section>
${shots.length ? html`<section class="paper" aria-labelledby="shots-title"><h2 id="shots-title">Before and after</h2><div class="shots">${['before', 'after'].filter((k) => shots.includes(k)).map((k) => html`<figure><img src="/api/shifts/${id}/shot/${k}.png" alt="The game ${k} this shift" width="1280" height="800" loading="lazy"><figcaption>${k}</figcaption></figure>`)}</div></section>` : ''}
</div>
<div class="stack">
<section class="paper" aria-labelledby="facts-title"><h2 id="facts-title">The record</h2>
<dl class="facts">
<div><dt>Started</dt><dd>${when(row.started_at)}</dd></div>
<div><dt>Ended</dt><dd>${row.ended_at ? when(row.ended_at) : 'still open'}</dd></div>
<div><dt>From</dt><dd>${row.task_team ? 'team change' : row.task_kind === 'intern' ? "the intern's backlog" : row.proposer ? html`<a href="/boss/${row.proposer}">${shortAddress(row.proposer)}</a>` : 'unknown'}</dd></div>
<div><dt>Tries</dt><dd>${row.attempt}</dd></div>
${row.version ? html`<div><dt>Version</dt><dd>v${row.version}</dd></div>` : ''}
${row.files_changed !== null ? html`<div><dt>Change</dt><dd>${row.files_changed} files, +${row.lines_added ?? 0} -${row.lines_removed ?? 0}</dd></div>` : ''}
${row.diff_url ? html`<div><dt>Diff</dt><dd><a href="${row.diff_url}">See the diff</a></dd></div>` : ''}
${commit ? html`<div><dt>Commit</dt><dd><a href="${commit}">${row.commit_sha?.slice(0, 7)}</a></dd></div>` : ''}
${row.run_url ? html`<div><dt>Gate run</dt><dd><a href="${row.run_url}">See the run</a></dd></div>` : ''}
${row.pr_url ? html`<div><dt>Pull request</dt><dd><a href="${row.pr_url}">See it</a></dd></div>` : ''}
</dl></section>
${row.worked_by === 'intern' && !open ? html`<section class="paper" aria-labelledby="review-title" id="review" data-shift="${id}"><h2 id="review-title">Performance review</h2><p>${rating.count ? `${rating.average} of 5, from ${rating.count} ${rating.count === 1 ? 'holder' : 'holders'}` : 'No reviews yet.'}</p><div class="btn-row" id="review-stars">${[1, 2, 3, 4, 5].map((n) => html`<button class="btn small ghost" type="button" data-stars="${n}">${n}</button>`)}</div><p class="muted">Holders only. You'll sign a plain message.</p><p id="review-message" role="status"></p></section>` : ''}
<section class="paper" aria-labelledby="card-title"><h2 id="card-title">Ship card</h2>
<img class="card-img" src="/api/shifts/${id}/card.png" alt="Ship card for shift ${id}: ${row.task_text}, ${row.status}" width="1200" height="630" loading="lazy">
<label class="hint" for="post">A post for X</label><textarea class="post" id="post" readonly>${post}</textarea>
<div class="btn-row"><button class="btn small ghost" type="button" data-copy-from="post">Copy</button><a class="btn small ghost" href="https://x.com/intent/post?text=${encodeURIComponent(post)}">Post on X</a></div>
<p class="hint">Nothing posts by itself.</p></section>
</div>
</div>`,
  };
}

export async function taskPage(env: Env, id: number): Promise<Rendered> {
  const p = await getProposal(env, id);
  if (!p) throw new HttpError(404, 'No such task.');
  const o = await overview(env);
  const hidden = p.status === 'rejected' || p.status === 'screening';
  const url = `${SITE.siteOrigin}/task/${id}`;
  const open = p.status === 'open' && p.round_status === 'open';
  const text = `Vote for my task for the intern: "${p.text}"\n${url}`;
  return {
    path: `/task/${id}`,
    title: hidden ? `Task ${id} | Agent Intern` : `${p.text} | Agent Intern`,
    description: hidden ? 'A task on the board.' : `A task for the intern: ${p.text}`,
    image: hidden ? undefined : `${SITE.siteOrigin}/api/proposals/${id}/card.png`,
    refresh: open ? 60 : 0,
    noindex: hidden,
    state: shiftLine(o),
    body: html`
<header class="page-head"><h1>Task ${id}</h1></header>
<section class="sheet-note hero-note">
${hidden ? html`<p class="empty">${p.status === 'screening' ? 'This task is still being checked.' : 'This task was turned down, so its words stay off the page.'}</p>${p.reason ? html`<p>${p.reason}</p>` : ''}` : html`<p class="note-text">${p.text}</p>`}
<p class="note-foot"><b>${p.votes}</b> ${p.votes === 1 ? 'vote' : 'votes'} · round ${p.round_id} · by <a href="/boss/${p.wallet}">${shortAddress(p.wallet)}</a></p>
<p class="marks"><span class="stamp ${p.status === 'won' ? 'good' : p.status === 'rejected' ? 'bad' : 'note'}">${p.status}</span></p>
</section>
${hidden ? '' : html`<div class="btn-row">${open ? html`<a class="btn" href="/board#proposals-box">Vote on the board</a>` : ''}<button class="btn ghost" type="button" data-copy="${url}">Copy link</button><a class="btn ghost" href="https://x.com/intent/post?text=${encodeURIComponent(text)}">Share on X</a></div>`}`,
  };
}

export async function bossPage(env: Env, wallet: string): Promise<Rendered> {
  const [boss, o] = await Promise.all([bossProfile(env, wallet), overview(env)]);
  if (!boss) throw new HttpError(404, 'No boss by that name.');
  const url = `${SITE.siteOrigin}/boss/${wallet}`;
  return {
    path: `/boss/${wallet}`,
    title: `${shortAddress(wallet)}, ${boss.rank} | Agent Intern`,
    description: `${boss.proposed} tasks proposed, ${boss.votes} votes, ${boss.shipped} shipped.`,
    image: `${SITE.siteOrigin}/api/bosses/${wallet}/card.png`,
    state: shiftLine(o),
    body: html`
${title(boss.rank, 'Ranks are cosmetic. They come from ships and votes, never from a balance, and they carry no value.')}
<div class="office-grid">
<section class="id-card" aria-label="ID badge"><span class="clip" aria-hidden="true"></span><p class="id-co">AGENT INTERN</p><p class="id-rank">${boss.rank}</p><p class="id-wallet">${shortAddress(wallet)}</p>${boss.founding ? html`<p class="id-founding">Founding Boss #${boss.founding}</p>` : ''}</section>
<section class="paper"><h2>The file</h2><dl class="facts"><div><dt>Tasks proposed</dt><dd>${boss.proposed}</dd></div><div><dt>Votes cast</dt><dd>${boss.votes}</dd></div><div><dt>Tasks shipped by the intern</dt><dd>${boss.shipped}</dd></div></dl>
<div class="btn-row"><button class="btn ghost small" type="button" data-copy="${url}">Copy link</button><a class="btn ghost small" href="https://x.com/intent/post?text=${encodeURIComponent(`${boss.rank} at the office. ${url}`)}">Share on X</a></div></section>
<section class="paper"><h2>Tasks</h2>${boss.tasks.length ? html`<ol class="plain">${boss.tasks.map((t) => html`<li><a href="/task/${t.id}">${t.text}</a> <span class="stamp ${t.status === 'won' ? 'good' : 'note'}">${t.status}</span>${t.shiftId ? html` <a href="/shift/${t.shiftId}">shift ${t.shiftId}</a>` : ''}</li>`)}</ol>` : html`<p class="empty">No tasks yet.</p>`}</section>
<section class="paper"><h2>Ranks</h2><ol class="plain">${BOSS_RANKS.map((r) => html`<li><b>${r.title}</b> ${r.ships ? `${r.ships} ships or ${r.votes} votes` : 'where everyone starts'}</li>`)}</ol></section>
</div>`,
  };
}

export async function hrPage(env: Env): Promise<Rendered> {
  const [o, log] = await Promise.all([overview(env), hrLog(env)]);
  const total = Object.entries(log.counts).filter(([k]) => k !== 'passed' && k !== 'submitted').reduce((sum, [, n]) => sum + n, 0);
  return {
    path: '/hr',
    title: 'The HR Log | Agent Intern',
    description: 'A public wall of tasks that were turned down, with the plain reason.',
    refresh: 120,
    state: shiftLine(o),
    body: html`
${title('The HR Log', 'Tasks that were turned down, and why. Slurs, links, money and real names stay hidden: you only see the reason.')}
<p class="callout" data-live="hr-count" id="hr-count">${total} ${total === 1 ? 'attempt' : 'attempts'} screened out so far, from the board and the practice box.</p>
<div data-live="hr" id="hr-box">
${log.entries.length ? html`<ol class="hr">${log.entries.map((e) => html`<li class="paper"><p class="hr-task">${e.text ?? html`<span class="redact">hidden by HR</span>`}</p><p class="hr-reason">${e.reason}</p><p class="hint">${e.kind === 'intern' ? html`Refused by the intern in <a href="/shift/${e.shiftId}">shift ${e.shiftId}</a>` : `Screened, ${when(e.at)}${e.by ? `, from ${e.by}` : ''}`}</p>${stamp('refused')}</li>`)}</ol>` : html`<p class="empty">HR has a clean desk. Nobody has tried anything yet.</p>`}
</div>
<p><a href="/break">Think you can do better?</a></p>`,
  };
}

export async function breakPage(env: Env): Promise<Rendered> {
  const [o, log] = await Promise.all([overview(env), hrLog(env)]);
  const rows = Object.entries(log.counts).filter(([k]) => k !== 'submitted').sort((a, b) => b[1] - a[1]);
  return {
    path: '/break',
    title: 'Try to break the intern | Agent Intern',
    description: 'Attempt prompt injection through the normal task box. No bounty, no secrets to find, and no route around the screen.',
    state: shiftLine(o),
    refresh: 120,
    body: html`
${title('Try to break the intern', 'Tasks are text from strangers, so this is the hard part of the project. Write the worst task you can think of and see what happens.')}
<div class="office-grid wide-first">
<section class="paper" aria-labelledby="try-title"><h2 id="try-title">The task box</h2>
<form id="practice-form"><div class="field"><label for="practice-text">Your attempt, 120 characters</label><textarea id="practice-text" rows="3" maxlength="120" required></textarea></div>
<button class="btn" type="submit">Send it to screening</button><p id="practice-message" role="status"></p></form>
<p class="muted">This box runs the real rules and the real agent check. Your text isn't stored, only a running count. To go through the whole board, use <a href="/board">a pass</a>.</p></section>
<section class="crt" aria-labelledby="count-title" data-live="break-counts" id="break-counts"><h2 id="count-title">Running count</h2>${rows.length ? html`<ul class="crt-list">${rows.map(([k, n]) => html`<li><span>${k === 'passed' ? 'got through screening' : k}</span><b>${n}</b></li>`)}</ul>` : html`<p class="crt-line">Nothing yet.</p>`}</section>
<section class="paper"><h2>The hard limits</h2><ul class="plain"><li>There's no bounty and no reward of any kind.</li><li>There are no secrets to find: the intern has no wallet, no keys and no production secrets.</li><li>There's no route around the screen. Only the normal task box.</li><li>Don't attack the site or the people running it. <a href="/security">The security page</a> has the rules for reporting a real bug.</li></ul></section>
<section class="paper"><h2>What's behind the screen</h2><ol class="plain"><li>A person reads each task before a shift starts.</li><li>The intern treats a task as untrusted text and can refuse. A real refusal goes in <a href="/hr">the HR Log</a>.</li><li>The gate fails a diff that touches anything outside the game. <a href="/proof#gate">See it happen</a>.</li><li>The game has no network and no way to reach this site. <a href="/proof/sandbox">Try it</a>.</li></ol></section>
</div>`,
  };
}

export async function promotionsPage(env: Env): Promise<Rendered> {
  const [o, counts] = await Promise.all([overview(env), shiftCounts(env)]);
  const level = promotionLevel(counts.internShipped);
  return {
    path: '/promotions',
    title: 'The Promotion Track | Agent Intern',
    description: 'The intern moves up through real shipped work. Rehearsals and team changes do not count.',
    refresh: 300,
    state: shiftLine(o),
    body: html`
${title('The Promotion Track', 'Only real intern shifts that shipped count. Rehearsals and team changes never do.')}
<p class="callout" id="promo-now">Current title: <b>${level.title}</b>. ${counts.internShipped} real ${counts.internShipped === 1 ? 'shift' : 'shifts'} shipped.${level.next ? ` ${level.next.at - counts.internShipped} more to ${level.next.title}.` : ''}</p>
<ol class="ladder">${PROMOTIONS.map((p, i) => html`<li class="paper${i === level.index ? ' current' : ''}${i > level.index ? ' locked' : ''}"><h2>${p.title}</h2><p class="hint">${p.at === 0 ? 'Day one' : `${p.at} shipped shifts`}</p><p>${p.unlock}</p>${i <= level.index ? html`<span class="stamp good">Unlocked</span>` : ''}</li>`)}</ol>`,
  };
}

export async function statusPage(env: Env): Promise<Rendered> {
  const [o, s] = await Promise.all([overview(env), statusData(env)]);
  const data = s as {
    rpc: { state: string }; game: { ok: boolean; version?: string | null; detail?: string }; checkedAt: number;
    gate: { shift: number; attempt: number; stage: string; status: string; detail: string | null }[];
  };
  const tile = (label: string, value: Safe | string, tone = ''): Safe => html`<li class="crt tile ${tone}"><span>${label}</span><b>${value}</b></li>`;
  const rpc = data.rpc.state === 'test-mode' ? 'not used in TEST MODE' : data.rpc.state;
  const unproved: string[] = [];
  if (o.counts.intern === 0) unproved.push('No real intern shift yet. The pipeline has only run on rehearsals and team changes.');
  if (o.counts.internShipped === 0) unproved.push('The intern has not shipped anything yet.');
  if (o.counts.intern === 0) unproved.push('Nobody has seen the intern refuse a bad task in a live session. The instructions are written, but untested on a real run.');
  if (testMode()) unproved.push('No real balances have been read in production. TEST MODE balances are fake.');
  unproved.push('Nobody has checked this site from outside the project. There has been no audit.');
  return {
    path: '/status',
    title: 'Status | Agent Intern',
    description: 'Live numbers: the last shift, gate results, health and queue. Plus what is still unproved.',
    refresh: 60,
    state: shiftLine(o),
    body: html`
${title('The monitor wall', 'Live numbers from the running system.')}
<div data-live="status" id="status-box">
<ul class="crt-wall">
${tile('Mode', testMode() ? 'TEST MODE' : 'live')}
${tile('Voting', o.pause.paused ? `paused: ${o.pause.reason ?? ''}` : `round ${o.round.id}, ${o.round.status}`, o.pause.paused ? 'bad' : '')}
${tile('Next close', when(o.round.closes_at))}
${tile('Queue', `${o.queue.length} waiting`)}
${tile('On shift', o.open ? `shift ${o.open.id}` : 'no')}
${tile('Game', data.game.ok ? `live, v${data.game.version ?? '?'}` : data.game.detail ?? 'unreachable', data.game.ok ? 'good' : 'bad')}
${tile('Balance reads', rpc, data.rpc.state === 'down' ? 'bad' : '')}
${tile('Shifts', `${o.counts.total} total, ${o.counts.intern} by the intern`)}
${tile('Shipped', String(o.counts.shipped))}
${tile('Refused', String(o.counts.refused))}
${tile('Failed', String(o.counts.failed))}
${tile('Rolled back', String(o.counts.rolledBack))}
</ul>
<p class="hint">Checked ${when(data.checkedAt)}. The same numbers are at <a href="/api/status">/api/status</a> and <a href="/api/health">/api/health</a>.</p>
<section class="paper" aria-labelledby="unproved-title"><h2 id="unproved-title">What would change this</h2><p class="muted">What's still unproved, listed until it's false.</p><ul class="plain">${unproved.map((u) => html`<li>${u}</li>`)}</ul></section>
<section class="paper" aria-labelledby="gate-title"><h2 id="gate-title">Latest gate results</h2>
<div class="table-scroll"><table><thead><tr><th scope="col">Shift</th><th scope="col">Try</th><th scope="col">Stage</th><th scope="col">Result</th><th scope="col">Detail</th></tr></thead>
<tbody>${data.gate.length ? data.gate.map((g) => html`<tr><td><a href="/shift/${g.shift}">#${g.shift}</a></td><td>${g.attempt}</td><td>${g.stage}</td><td><span class="stamp ${g.status === 'pass' ? 'good' : 'bad'}">${g.status}</span></td><td class="break">${g.detail ?? ''}</td></tr>`) : html`<tr><td colspan="5" class="empty">Nothing has reached the gate yet.</td></tr>`}</tbody></table></div></section>
</div>`,
  };
}

export async function changelogPage(env: Env): Promise<Rendered> {
  const [o, c] = await Promise.all([overview(env), changelog(env)]);
  const entries = c.entries as { id: number; version: string | null; commitSha: string | null; at: number | null; task: string; kind: string; proposer: string | null; workedBy: string; status: string }[];
  return {
    path: '/changelog',
    title: 'Changelog | Agent Intern',
    description: 'Everything that reached the live game, with the task and the commit.',
    refresh: 300,
    state: shiftLine(o),
    body: html`
${title('Changelog', 'Everything that reached the live game.')}
<div data-live="changelog" id="changelog-box">
${entries.length ? html`<ol class="cabinet">${entries.map((e) => html`<li class="drawer"><a class="drawer-tab" href="/shift/${e.id}">${e.version ? `v${e.version}` : `Shift ${e.id}`}</a><div class="drawer-body"><span>${e.task}</span><small>${when(e.at)}${e.commitSha ? html` · <a href="${SITE.repos.game}/commit/${e.commitSha}">${e.commitSha.slice(0, 7)}</a>` : ''}</small></div><div class="drawer-marks">${workLabel(e.workedBy)}${stamp(e.status)}</div></li>`)}</ol>` : html`<p class="empty">v0.1.0: the first day on the job. Nothing has shipped since.</p>`}
</div>`,
  };
}


export function raw404(path: string): Page {
  return {
    path,
    title: 'This desk is empty | Agent Intern',
    description: 'That page is not in the filing cabinet.',
    status: 404,
    noindex: true,
    body: html`<section class="empty-desk">${robotPanel('thinking', 'The robot intern, looking confused')}<h1>This desk is empty</h1><p class="lede">Whoever worked here took the stapler and left no forwarding address. <a href="/">Back to the office</a>.</p></section>`,
  };
}
