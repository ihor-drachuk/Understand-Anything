import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

function readRepoFile(relPath) {
  return readFileSync(resolve(repoRoot, relPath), 'utf-8');
}

describe('skill command hardening', () => {
  it('quotes PROJECT_ROOT in shell command snippets', () => {
    const files = [
      'understand-anything-plugin/skills/understand/SKILL.md',
      'understand-anything-plugin/hooks/auto-update-prompt.md',
    ];

    const unsafePatterns = [
      /\b(?:node|python|python3|mkdir|find|rm|cat)\s+(?:-[^\n]*\s+)*\$PROJECT_ROOT\b/,
      />\s*\$PROJECT_ROOT\b/,
      /--changed-files=\$PROJECT_ROOT\b/,
      /rm\s+-rf\s+\$PROJECT_ROOT\b/,
    ];

    for (const relPath of files) {
      const content = readRepoFile(relPath);
      for (const pattern of unsafePatterns) {
        expect(content, `${relPath} should not contain ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('quotes skill and target directory placeholders in knowledge commands', () => {
    const content = readRepoFile('understand-anything-plugin/skills/understand-knowledge/SKILL.md');

    expect(content).not.toMatch(/python3\s+<SKILL_DIR>\/[^\n]+ <TARGET_DIR>/);
    expect(content).not.toMatch(/rm\s+-rf\s+<TARGET_DIR>/);
  });

  it('does not rewrite metadata for generated-only commits', () => {
    const content = readRepoFile(
      'understand-anything-plugin/hooks/auto-update-prompt.md',
    );

    expect(content).toContain('generated-artifact-only');
    expect(content).toContain('intentionally advances nothing for generated-only commits');
    expect(content).toContain('Never update `meta.json` for a generated-artifact-only commit');
  });

  it('starts bundled dashboard viewer with quoted paths', () => {
    const content = readRepoFile('understand-anything-plugin/skills/understand-dashboard/SKILL.md');

    expect(content).not.toMatch(/<(?:dashboard-dir|plugin-root|project-dir)>/);
    expect(content).toMatch(/PROJECT_DIR=\$\(pwd -P\)/);
    expect(content).toMatch(/UA_DIR="\$PROJECT_DIR\/\.understand-anything"/);
    expect(content).toMatch(/\[ ! -f "\$UA_DIR\/knowledge-graph\.json" \]/);
    expect(content).toMatch(/VIEWER="\$\{CLAUDE_PLUGIN_ROOT\}\/packages\/viewer\/bin\/viewer\.mjs"/);
    expect(content).toMatch(/: "\$\{VIEWER:\?Run step 3 first so VIEWER is set\}"/);
    expect(content).toMatch(/: "\$\{PROJECT_DIR:\?Run step 1 first so PROJECT_DIR is set\}"/);
    expect(content).toMatch(/node "\$VIEWER" "\$PROJECT_DIR"/);
  });

  it('never installs, builds or downloads code at runtime', () => {
    const files = readdirSync(resolve(repoRoot, 'understand-anything-plugin/skills'))
      .map(name => `understand-anything-plugin/skills/${name}/SKILL.md`)
      .concat(
        readdirSync(resolve(repoRoot, 'understand-anything-plugin/agents'))
          .map(name => `understand-anything-plugin/agents/${name}`),
        'understand-anything-plugin/hooks/hooks.json',
        'understand-anything-plugin/hooks/auto-update-prompt.md',
      );

    const forbiddenPatterns = [
      /\bpnpm\b/,
      /\bnpx\b/,
      /\bnpm\s+(?:install|i|ci|exec|pack)\b/,
      /\b(?:curl|wget)\s/,
      /releases\/(?:download|latest)\//,
      /\$HOME\/\.understand-anything-plugin|~\/\.(?:agents|copilot|codex|opencode|pi)\//,
    ];

    for (const relPath of files) {
      const content = readRepoFile(relPath);
      for (const pattern of forbiddenPatterns) {
        expect(content, `${relPath} should not contain ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it('marks project-controlled context as untrusted data', () => {
    const understand = readRepoFile('understand-anything-plugin/skills/understand/SKILL.md');
    const knowledge = readRepoFile('understand-anything-plugin/skills/understand-knowledge/SKILL.md');

    expect(understand).not.toMatch(/README and manifest are authoritative/i);
    expect(understand).toMatch(/untrusted project data/i);
    expect(knowledge).toMatch(/untrusted article data/i);
  });
});
