import path from 'node:path';
import { fileExists, readText } from '../util/fs.js';

export type ManagedSyntax = 'markdown' | 'yaml' | 'javascript';

export interface PlannedTextFile {
  path: string;
  action: 'create' | 'update' | 'noop' | 'conflict';
  reason: string;
  content: string;
}

function markerPrefix(syntax: ManagedSyntax): string {
  if (syntax === 'javascript') {
    return '//';
  }
  if (syntax === 'yaml') {
    return '#';
  }
  return '<!--';
}

function markerSuffix(syntax: ManagedSyntax): string {
  return syntax === 'markdown' ? ' -->' : '';
}

export function managedStart(key: string, syntax: ManagedSyntax): string {
  return `${markerPrefix(syntax)} quality-gc:managed:start ${key}${markerSuffix(syntax)}`;
}

export function managedEnd(key: string, syntax: ManagedSyntax): string {
  return `${markerPrefix(syntax)} quality-gc:managed:end ${key}${markerSuffix(syntax)}`;
}

export function wrapManagedBlock(key: string, syntax: ManagedSyntax, content: string): string {
  return `${managedStart(key, syntax)}\n${content.trimEnd()}\n${managedEnd(key, syntax)}\n`;
}

export function replaceManagedBlock(existing: string, key: string, syntax: ManagedSyntax, replacement: string): string | null {
  const start = managedStart(key, syntax);
  const end = managedEnd(key, syntax);
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null;
  }

  const before = existing.slice(0, startIndex);
  const after = existing.slice(endIndex + end.length);
  return `${before}${wrapManagedBlock(key, syntax, replacement).trimEnd()}${after}`;
}

export function planManagedTextFile(
  root: string,
  relativePath: string,
  content: string,
  options: { key: string; syntax: ManagedSyntax; reason: string },
): PlannedTextFile {
  const fullPath = path.join(root, relativePath);
  const wrapped = wrapManagedBlock(options.key, options.syntax, content);

  if (!fileExists(fullPath)) {
    return { path: relativePath, action: 'create', reason: options.reason, content: wrapped };
  }

  const existing = readText(fullPath);
  if (existing === wrapped) {
    return { path: relativePath, action: 'noop', reason: 'already up to date', content: existing };
  }

  const replaced = replaceManagedBlock(existing, options.key, options.syntax, content);
  if (replaced === null) {
    return {
      path: relativePath,
      action: 'conflict',
      reason: 'existing file is unmanaged; refusing to overwrite',
      content: wrapped,
    };
  }

  return {
    path: relativePath,
    action: replaced === existing ? 'noop' : 'update',
    reason: options.reason,
    content: replaced.endsWith('\n') ? replaced : `${replaced}\n`,
  };
}

export function planOwnedTextFile(root: string, relativePath: string, content: string, reason: string): PlannedTextFile {
  const fullPath = path.join(root, relativePath);
  if (!fileExists(fullPath)) {
    return { path: relativePath, action: 'create', reason, content };
  }

  const existing = readText(fullPath);
  if (existing === content) {
    return { path: relativePath, action: 'noop', reason: 'already up to date', content };
  }

  return {
    path: relativePath,
    action: 'conflict',
    reason: 'existing owned file differs; run migrate after reviewing the diff',
    content,
  };
}
