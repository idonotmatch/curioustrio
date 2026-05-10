const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const scanRoots = ['app', 'components', 'services'];
const colorLiteralPattern = /#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\)/g;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolutePath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(absolutePath);
    }
  }
  return files;
}

const violations = [];

for (const root of scanRoots) {
  for (const file of walk(path.join(projectRoot, root))) {
    const source = fs.readFileSync(file, 'utf8');
    const matches = source.match(colorLiteralPattern);
    if (!matches) continue;
    const relativePath = path.relative(projectRoot, file);
    violations.push(`${relativePath}: ${[...new Set(matches)].join(', ')}`);
  }
}

if (violations.length) {
  process.stderr.write('[mobile-palette] hard-coded colors found outside theme/tokens.js\n');
  process.stderr.write(violations.join('\n'));
  process.stderr.write('\n');
  process.exit(1);
}

process.stdout.write('[mobile-palette] color token checks passed\n');
