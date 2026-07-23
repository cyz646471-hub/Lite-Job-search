import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultDirectory = path.dirname(fileURLToPath(import.meta.url));
let cache;

export async function loadPageProviders(directory = defaultDirectory) {
  if (cache && directory === defaultDirectory) return cache;
  const providers = [];
  const files = (await readdir(directory)).filter((name) => name.endsWith('.mjs') && !name.startsWith('_')).sort();
  for (const file of files) {
    const provider = (await import(pathToFileURL(path.join(directory, file)).href)).default;
    if (!provider || typeof provider.id !== 'string' || typeof provider.match !== 'function' || typeof provider.parse !== 'function') {
      throw new Error(`Invalid page provider: ${file}`);
    }
    if (providers.some((item) => item.id === provider.id)) throw new Error(`Duplicate page provider id: ${provider.id}`);
    providers.push(provider);
  }
  providers.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  if (directory === defaultDirectory) cache = providers;
  return providers;
}

export async function resolvePageProvider(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  for (const provider of await loadPageProviders()) if (provider.match(url)) return provider;
  return null;
}
