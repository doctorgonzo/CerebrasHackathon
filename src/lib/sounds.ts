let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function osc(
  freq: number,
  type: OscillatorType,
  attack: number,
  sustain: number,
  release: number,
  gain: number,
  detune = 0,
) {
  const c = getCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + attack);
  g.gain.setValueAtTime(gain, c.currentTime + attack + sustain);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + attack + sustain + release);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + attack + sustain + release + 0.1);
}

export function spawnSound() {
  const base = 300 + Math.random() * 200;
  osc(base, "sine", 0.01, 0.04, 0.15, 0.08);
  osc(base * 1.5, "sine", 0.02, 0.03, 0.12, 0.04, 5);
}

export function thinkingSound() {
  osc(180 + Math.random() * 40, "triangle", 0.05, 0.1, 0.3, 0.03);
}

export function completeSound() {
  const base = 500 + Math.random() * 100;
  osc(base, "sine", 0.01, 0.08, 0.4, 0.06);
  setTimeout(() => osc(base * 1.25, "sine", 0.01, 0.06, 0.3, 0.05), 80);
}

export function errorSound() {
  osc(200, "sawtooth", 0.01, 0.05, 0.2, 0.04);
  osc(150, "sawtooth", 0.02, 0.05, 0.25, 0.03);
}

export function synthesisSound() {
  const notes = [440, 554, 659, 880];
  notes.forEach((freq, i) => {
    setTimeout(() => {
      osc(freq, "sine", 0.05, 0.15, 0.8, 0.06, 3);
      osc(freq * 0.5, "triangle", 0.08, 0.2, 1.0, 0.03);
    }, i * 120);
  });
}
