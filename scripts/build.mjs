import { copyFile, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'dist'), { recursive: true });
for (const file of ['index.html', 'styles.css', 'universe.js', 'hand-controller.js', 'gesture-worker.js']) {
  await copyFile(path.join(root, file), path.join(root, 'dist', file));
}
await cp(path.join(root, 'assets'), path.join(root, 'dist', 'assets'), { recursive: true });
console.log('静态文件已生成至 dist/，无需安装依赖。');
