import { tryCommand } from '../util/exec.js';

export function assertNotDefaultBranch(root: string, allowDefaultBranch: boolean, commandName: string): void {
  if (allowDefaultBranch) {
    return;
  }

  const currentBranch = tryCommand('git', ['branch', '--show-current'], { cwd: root });
  const originHead = tryCommand('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root });
  if (!currentBranch || !originHead) {
    return;
  }

  const defaultBranch = originHead.replace(/^origin\//, '');
  if (currentBranch === defaultBranch) {
    throw new Error(
      `Refusing to apply ${commandName} on default branch ${defaultBranch}. Create a setup branch first or pass --allow-default-branch for a controlled fixture.`,
    );
  }
}
