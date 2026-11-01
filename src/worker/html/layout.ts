import ASSETS from '../../../config/assets.json';
import { SITE, siteOrigin, testMode, mint } from '../config';
import type { Env } from '../env';
import { html, raw, type Safe } from './core';

export interface Page {
  path: string;
  title: string;
  description: string;
  body: Safe;
  // Full-width content above the page's column.
  stage?: Safe;
  image?: string;
  // Seconds between refreshes of the [data-live] parts. Zero means the page doesn't change.
  refresh?: number;
  status?: number;
  noindex?: boolean;
}

const NAV: [string, string, string][] = [
  ['/', 'Office', 'home'],
  ['/play', 'Play', 'play'],
  ['/board', 'Board', 'board'],
  ['/live', 'Live', 'live'],
  ['/history', 'History', 'history'],
];

const MORE: [string, string][] = [
  ['/how', 'How it works'],
  ['/proof', 'Proof'],
  ['/hr', 'HR Log'],
  ['/break', 'Try to break it'],
  ['/promotions', 'Promotions'],
  ['/status', 'Status'],
  ['/changelog', 'Changelog'],
  ['/about', 'About'],
  ['/security', 'Security'],
  ['/brand', 'Brand'],
  ['/api', 'API'],
];

const current = (href: string, path: string): boolean => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));

function mintChip(): Safe | null {
  if (testMode()) return null;
  const value = mint();
  return html`<div class="chip-row"><button class="pill" type="button" data-copy="${value}" aria-label="Copy the contract address">CA ${value.slice(0, 4)}...${value.slice(-4)}</button><a class="pill" href="https://solscan.io/token/${value}">Solscan</a></div>`;
}

export function renderPage(env: Env, page: Page, state: { label: string; on: boolean; paused: string | null }): string {
  const origin = siteOrigin(env);
  const url = `${origin}${page.path === '/' ? '' : page.path}` || origin;
  const image = page.image ?? `${origin}/img/share-card.jpg`;
  const nav = NAV.map(([href, label]) =>
    html`<li><a href="${href}" ${raw(current(href, page.path) ? 'aria-current="page"' : '')}>${label}</a></li>`);
  const bottom = NAV.map(([href, label, icon]) =>
    html`<li><a href="${href}" ${raw(current(href, page.path) ? 'aria-current="page"' : '')}><span class="ico ico-${icon}" aria-hidden="true"></span>${label}</a></li>`);
  const more = MORE.map(([href, label]) => html`<a href="${href}">${label}</a>`);

  return `<!doctype html>${html`
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
<meta name="theme-color" content="#0b1020">
${page.noindex ? raw('<meta name="robots" content="noindex">') : ''}
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="alternate" type="application/rss+xml" title="Agent Intern shifts" href="/feed.xml">
<link rel="preload" href="/fonts/pixelify-sans-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css?v=${ASSETS.version}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Agent Intern">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@${SITE.x.split('/').pop()}">
<meta name="twitter:title" content="${page.title}">
<meta name="twitter:description" content="${page.description}">
<meta name="twitter:image" content="${image}">
<script type="module" src="/js/app.js?v=${ASSETS.version}"></script>
</head>
<body data-page="${page.path.split('/')[1] || 'home'}" data-refresh="${page.refresh ?? 0}" data-test-mode="${testMode() ? '1' : '0'}" data-shift="${state.on ? 'on' : 'off'}">
<a class="skip" href="#main">Skip to content</a>
${state.paused ? html`<div class="notice" role="status">Paused: ${state.paused}</div>` : ''}
<header class="top">
<div class="wrap top-row">
<a class="brand" href="/" aria-label="Agent Intern, the office"><img class="brand-head" id="brand-head" data-live="brand-head" src="/img/robot-head${state.on ? '' : '-asleep'}.webp" width="40" height="40" alt=""><span>Agent Intern</span></a>
<a class="pill${state.on ? ' on' : ''}${state.paused ? ' paused' : ''}" href="/live" data-live="pill" id="pill"><i aria-hidden="true"></i>${state.label}</a>
${mintChip()}
<nav aria-label="Main" class="top-nav"><ul>${nav}</ul></nav>
<button class="sound-toggle" type="button" id="sound-toggle" aria-pressed="false" hidden>Sound off</button>
</div>
</header>
<main id="main">${page.stage ?? ''}<div class="wrap">
${page.body}
</div></main>
<footer class="foot">
<div class="wrap">
<p>Holders vote, the intern ships it. A person starts every shift.</p>
<nav aria-label="More pages">${more}</nav>
<nav aria-label="Elsewhere"><a href="${SITE.x}">X</a><a href="${SITE.repos.site}">Site repo</a><a href="${SITE.repos.game}">Game repo</a><a href="/feed.xml">RSS</a><a href="/llms.txt">llms.txt</a></nav>
</div>
</footer>
<nav class="bottom-nav" aria-label="Phone"><ul>${bottom}</ul></nav>
</body>
</html>`}`;
}
