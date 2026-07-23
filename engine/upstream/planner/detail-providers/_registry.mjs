import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

let cache;

export async function loadDetailProviders(directory = path.dirname(fileURLToPath(import.meta.url))) {
  if (cache && directory === path.dirname(fileURLToPath(import.meta.url))) return cache;
  const providers = [];
  for (const file of (await readdir(directory)).filter((name) => name.endsWith('.mjs') && !name.startsWith('_')).sort()) {
    const module = await import(pathToFileURL(path.join(directory, file)).href);
    const provider = module.default;
    if (!provider || typeof provider.id !== 'string' || typeof provider.match !== 'function' || typeof provider.apiUrl !== 'function' || typeof provider.parse !== 'function') {
      throw new Error(`Invalid detail provider: ${file}`);
    }
    if (providers.some((item) => item.id === provider.id)) throw new Error(`Duplicate detail provider id: ${provider.id}`);
    providers.push(provider);
  }
  if (directory === path.dirname(fileURLToPath(import.meta.url))) cache = providers;
  return providers;
}

export async function resolveDetailProvider(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  for (const provider of await loadDetailProviders()) {
    const match = provider.match(url);
    if (match) return { id: provider.id, source: provider.source || provider.id[0].toUpperCase() + provider.id.slice(1), url: provider.apiUrl(match), match, provider };
  }
  return null;
}
