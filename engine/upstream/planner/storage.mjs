import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function readPipeline(filePath) {
  const text = await readFile(filePath, 'utf8');
  return [...text.matchAll(/^- \[ \]\s+(https?:\/\/\S+)/gm)].map((match) => ({ url: match[1] }));
}

export async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return fallback; }
}

export async function readStdinJson(fallback = null) {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString('utf8').trim();
    return text ? JSON.parse(text) : fallback;
  } catch { return fallback; }
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

export async function readStudents(rootDir, yaml) {
  const studentsDir = path.join(rootDir, 'students');
  const manifest = await readJson(path.join(studentsDir, 'students.json'), null);
  if (Array.isArray(manifest) && manifest.length) {
    return Promise.all(manifest.map(async (entry) => {
      const profilePath = path.resolve(studentsDir, entry.profile);
      const cvPath = path.resolve(studentsDir, entry.cv);
      return { profile: yaml.load(await readFile(profilePath, 'utf8')), cvText: await readFile(cvPath, 'utf8'), source: entry };
    }));
  }
  return [{ profile: yaml.load(await readFile(path.join(rootDir, 'config', 'profile.yml'), 'utf8')), cvText: await readFile(path.join(rootDir, 'cv.md'), 'utf8'), source: { id: 'default' } }];
}
