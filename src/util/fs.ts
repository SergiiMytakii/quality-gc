import fs from 'node:fs';
import path from 'node:path';

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

export function relativePosix(root: string, filePath: string): string {
  return toPosixPath(path.relative(root, filePath));
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(readText(filePath)) as T;
}

export function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function writeJson(filePath: string, value: unknown): void {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function listFiles(root: string, options: { extensions?: string[]; includeHidden?: boolean } = {}): string[] {
  const results: string[] = [];
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'coverage']);
  const extensions = options.extensions ? new Set(options.extensions) : null;

  function visit(dir: string): void {
    if (!fs.existsSync(dir)) {
      return;
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!options.includeHidden && entry.name.startsWith('.') && entry.name !== '.github' && entry.name !== '.quality-gc') {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          visit(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (extensions && !extensions.has(path.extname(entry.name))) {
        continue;
      }

      results.push(fullPath);
    }
  }

  visit(root);
  return results.sort();
}

export function findPackageRoot(startFileUrl: string): string {
  let dir = path.dirname(new URL(startFileUrl).pathname);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not resolve package root.');
}
