// Optional development helper. The app only reads these local files at runtime.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/';
const files = [
  ['vision_bundle.mjs', 'assets/mediapipe/vision_bundle.mjs'],
  ['wasm/vision_wasm_internal.js', 'assets/mediapipe/wasm/vision_wasm_internal.js'],
  ['wasm/vision_wasm_internal.wasm', 'assets/mediapipe/wasm/vision_wasm_internal.wasm'],
  ['wasm/vision_wasm_nosimd_internal.js', 'assets/mediapipe/wasm/vision_wasm_nosimd_internal.js'],
  ['wasm/vision_wasm_nosimd_internal.wasm', 'assets/mediapipe/wasm/vision_wasm_nosimd_internal.wasm'],
  ['https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', 'assets/mediapipe/hand_landmarker.task'],
  ['https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE', 'assets/mediapipe/LICENSE.txt']
];
for (const [source, target] of files) {
  const destination = path.join(root, target);
  try { if ((await stat(destination)).size > 100) { console.log(`Exists: ${target}`); continue; } } catch {}
  const response = await fetch(source.startsWith('https:') ? source : base + source, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`${target}: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, data);
  console.log(`Downloaded: ${target} (${data.length} bytes)`);
}
