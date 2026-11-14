#!/usr/bin/env node
// Generates the voice guide's clips with ElevenLabs, once, ahead of time.
//
//   ELEVENLABS_API_KEY=... node scripts/generate-voice.mjs          (or put the key in .env)
//   ELEVENLABS_VOICE_ID=... to pick a voice; --force to regenerate existing clips.
//
// Only the fixed phrases in src/phrases.js are sent: no personal data, no readings.
// The app then plays the local MP3s and never calls ElevenLabs at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PHRASES } = require(path.join(root, 'src/phrases.js'));

function env(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const m = fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\r\\n]+)"?`, 'm'));
    return m ? m[1].trim() : '';
  } catch { return ''; }
}
const KEY = env('ELEVENLABS_API_KEY');
if (!KEY) { console.error('Set ELEVENLABS_API_KEY (environment or .env) first.'); process.exit(1); }
const API = 'https://api.elevenlabs.io/v1';
const MODEL = 'eleven_multilingual_v2';
const force = process.argv.includes('--force');
const outDir = path.join(root, 'assets/voice/en');
fs.mkdirSync(outDir, { recursive: true });

async function pickVoice() {
  const chosen = env('ELEVENLABS_VOICE_ID');
  if (chosen) return { voice_id: chosen, name: chosen };
  const r = await fetch(`${API}/voices`, { headers: { 'xi-api-key': KEY } });
  if (!r.ok) throw new Error(`Listing voices failed: ${r.status} ${await r.text()}`);
  const { voices = [] } = await r.json();
  const calm = ['Sarah', 'Alice', 'Matilda', 'Lily', 'Charlotte', 'Rachel', 'Laura'];
  return voices.find((v) => calm.some((n) => v.name?.startsWith(n))) || voices[0];
}

const voice = await pickVoice();
if (!voice) { console.error('No voices available on this account.'); process.exit(1); }
console.log(`Voice: ${voice.name} (${voice.voice_id}), model ${MODEL}`);
const ids = Object.keys(PHRASES);
console.log(`${ids.length} phrases, ${ids.reduce((n, id) => n + PHRASES[id].length, 0)} characters in total.`);

const done = [];
for (const id of ids) {
  const file = path.join(outDir, `${id}.mp3`);
  if (!force && fs.existsSync(file)) { done.push(id); continue; }
  const r = await fetch(`${API}/text-to-speech/${voice.voice_id}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: PHRASES[id],
      model_id: MODEL,
      voice_settings: { stability: 0.65, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true, speed: 0.9 },
    }),
  });
  if (!r.ok) { console.error(`✗ ${id}: ${r.status} ${await r.text()}`); continue; }
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  done.push(id);
  console.log(`✓ ${id}`);
}
fs.writeFileSync(path.join(root, 'assets/voice/manifest.json'), JSON.stringify({
  generator: 'ElevenLabs text-to-speech', model: MODEL, voice: voice.name, generatedAt: new Date().toISOString(), clips: done,
}, null, 2) + '\n');
console.log(`Done: ${done.length}/${ids.length} clips in assets/voice/en/.`);
