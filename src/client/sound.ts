import { byId, store } from './dom';

// Optional and off by default. Every sound is synthesized, so there are no audio files.
let audio: AudioContext | null = null;

function blip(freq: number, seconds: number, type: OscillatorType, gain: number, slide?: number): void {
  if (!audio) return;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, audio.currentTime + seconds);
  amp.gain.setValueAtTime(gain, audio.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0005, audio.currentTime + seconds);
  osc.connect(amp).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + seconds);
}

export function startSound(): void {
  const toggle = byId<HTMLButtonElement>('sound-toggle');
  if (!toggle) return;
  toggle.hidden = false;
  const render = (): void => {
    const on = store('sound') === 'on';
    toggle.textContent = on ? 'Sound on' : 'Sound off';
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  render();
  toggle.addEventListener('click', () => {
    store('sound', store('sound') === 'on' ? 'off' : 'on');
    audio ??= new AudioContext();
    render();
  });
  document.addEventListener('click', (event) => {
    if (store('sound') !== 'on') return;
    audio ??= new AudioContext();
    const el = (event.target as HTMLElement).closest('.btn, a');
    if (!el) return;
    if (el.classList.contains('big')) blip(150, 0.14, 'square', 0.12, 60); // the punch clock
    else if (el.classList.contains('btn')) blip(110, 0.09, 'sawtooth', 0.1, 50); // a stamp
    else blip(1400, 0.02, 'square', 0.03); // a key
  });
}
