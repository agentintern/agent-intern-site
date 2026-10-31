// Runs inside the sandboxed frame on /proof/sandbox, under the same policy the game gets.
const attempt = async (run: () => unknown): Promise<string> => {
  try {
    const outcome = await Promise.race([run(), new Promise((_, no) => setTimeout(() => no(new Error('timed out')), 2500))]);
    return String(outcome);
  } catch (cause) {
    return `blocked: ${cause instanceof Error ? cause.name : 'error'}`;
  }
};

async function main(): Promise<void> {
  const site = 'https://agentintern.online';
  const report: Record<string, string> = {
    'Read this site through fetch': await attempt(() => fetch(`${site}/api/me`, { credentials: 'include' }).then((r) => r.status)),
    'Reach the wider internet': await attempt(() => fetch('https://example.com/', { mode: 'no-cors' }).then(() => 'reached')),
    'Read cookies': await attempt(() => document.cookie),
    'Use local storage': await attempt(() => { localStorage.setItem('a', 'b'); return 'stored'; }),
    'Read the page that embeds it': await attempt(() => window.parent.document.title),
    'Look for a wallet in that page': await attempt(() => typeof (window.parent as unknown as Record<string, unknown>).solana),
    'Send the visitor to another page': await attempt(() => { window.top!.location.href = 'https://example.com/'; return 'navigated'; }),
    'Open a popup': await attempt(() => { const w = window.open('https://example.com/'); if (!w) throw new Error('none'); return 'opened'; }),
    'Load an outside image': await attempt(() => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok('loaded'); i.onerror = () => no(new Error('x')); i.src = 'https://example.com/a.png'; })),
  };
  window.parent.postMessage({ type: 'sandbox-report', report }, '*');
}

void main();
