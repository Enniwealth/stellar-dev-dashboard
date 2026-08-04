import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(repoRoot, 'docs');
const rootPackage = path.join(repoRoot, 'package.json');

const externalLinkPattern = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;
const markdownLinkPattern = /!?\[[^\]]*\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/g;
const npmRunPattern = /npm run\s+([\w:-]+)/g;

async function collectMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseMarkdownLinks(content) {
  const links = [];
  let match;
  while ((match = markdownLinkPattern.exec(content)) !== null) {
    links.push(match[1]);
  }
  return links;
}

function parseNpmRunCommands(content) {
  const scripts = [];
  let match;
  while ((match = npmRunPattern.exec(content)) !== null) {
    scripts.push(match[1]);
  }
  return scripts;
}

function isExternalLink(href) {
  return externalLinkPattern.test(href) || href.startsWith('mailto:') || href.startsWith('tel:');
}

function normalizeLinkHref(href) {
  return href.replace(/^\.+\//, '').replace(/#.*$/, '');
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveLink(sourceFile, rawHref) {
  const href = rawHref.split('#', 1)[0];
  if (!href || href.startsWith('#')) {
    return null;
  }

  const candidates = [];
  const isAbsoluteDocs = href.startsWith('docs/') || href.startsWith('/docs/') || href.startsWith('./docs/') || href.startsWith('../docs/');

  const sourceDir = path.dirname(sourceFile);
  const referenced = path.normalize(href);

  if (!path.isAbsolute(referenced)) {
    candidates.push(path.join(sourceDir, referenced));
    if (isAbsoluteDocs) {
      const relativeToRoot = path.join(repoRoot, referenced.replace(/^\/*/, ''));
      candidates.push(relativeToRoot);
    }
  } else {
    candidates.push(path.join(repoRoot, referenced));
  }

  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (await fileExists(normalized)) return normalized;
    const withMd = `${normalized}.md`;
    const withMdx = `${normalized}.mdx`;
    const indexMd = path.join(normalized, 'index.md');
    const readmeMd = path.join(normalized, 'README.md');
    if (await fileExists(withMd)) return withMd;
    if (await fileExists(withMdx)) return withMdx;
    if (await fileExists(indexMd)) return indexMd;
    if (await fileExists(readmeMd)) return readmeMd;
  }

  return null;
}

async function loadPackageScripts() {
  try {
    const pkgJson = JSON.parse(await fs.readFile(rootPackage, 'utf8'));
    return new Set(Object.keys(pkgJson.scripts || {}));
  } catch (error) {
    console.error('Unable to read package.json for npm script validation:', error.message);
    return new Set();
  }
}

async function main() {
  const files = await collectMarkdownFiles(docsRoot);
  const packageScripts = await loadPackageScripts();
  const errors = [];

  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    const links = parseMarkdownLinks(content);
    for (const link of links) {
      if (isExternalLink(link) || link.startsWith('#')) continue;
      const resolved = await resolveLink(file, link);
      if (!resolved) {
        errors.push({ type: 'missing-file', file, link, resolved: path.join(path.dirname(file), link) });
      }
    }

    const scripts = parseNpmRunCommands(content);
    for (const script of scripts) {
      if (!packageScripts.has(script)) {
        errors.push({ type: 'missing-script', file, script });
      }
    }
  }

  if (errors.length === 0) {
    console.log('=== Documentation Drift Detection ===');
    console.log(`Scanned ${files.length} documentation files.`);
    console.log('No missing docs links or npm scripts were found.');
    process.exit(0);
  }

  console.log('=== Documentation Drift Detection ===');
  console.log(`Scanned ${files.length} documentation files.`);
  console.log();
  for (const error of errors) {
    if (error.type === 'missing-file') {
      console.log(`ERROR: File not found: "${error.link}" (resolved: ${error.resolved}) — referenced from ${path.relative(repoRoot, error.file)}`);
    } else if (error.type === 'missing-script') {
      console.log(`ERROR: Script not found: "npm run ${error.script}" — referenced from ${path.relative(repoRoot, error.file)}`);
    }
  }
  console.log();
  console.log(`Errors: ${errors.length}`);
  process.exit(1);
}

main().catch((error) => {
  console.error('Unexpected error during docs drift validation:', error);
  process.exit(1);
});
#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { globSync } from "glob";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

let exitCode = 0;
const errors = [];
const warnings = [];

function error(msg) {
  errors.push(msg);
  console.error(`  ERROR: ${msg}`);
  exitCode = 1;
}

function warn(msg) {
  warnings.push(msg);
  console.warn(`  WARN:  ${msg}`);
}

function exists(filePath) {
  return fs.existsSync(path.resolve(ROOT, filePath));
}

function resolveRef(baseDir, ref) {
  if (ref.startsWith("/")) return ref;
  const dir = path.dirname(baseDir);
  return path.resolve(dir, ref);
}

const IGNORE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".woff", ".woff2", ".ttf", ".eot",
]);

const IGNORE_PATTERNS = [
  /^https?:\/\//,
  /^#/,
  /^{{/,
  /^\/\/github\.com/,
  /^mailto:/,
  /^v\d+\.\d+\.\d+/,
];

function isIgnored(ref) {
  return IGNORE_PATTERNS.some((p) => p.test(ref));
}

function getFilePaths(markdown) {
  const refs = new Set();
  const linkRegex = /(?<!\w)(?:`)?([\w./-]+(?:\.[\w]+)?)(?:`)?(?=\s*[)}\]])/g;
  let m;
  while ((m = linkRegex.exec(markdown)) !== null) {
    const ref = m[1].trim();
    if (ref && !isIgnored(ref)) refs.add(ref);
  }
  const codeBlockRegex = /```(?:bash|sh|shell|console|terminal)\n([\s\S]*?)```/g;
  let cb;
  while ((cb = codeBlockRegex.exec(markdown)) !== null) {
    const code = cb[1];
    const cmdRegex = /(?:node|python3|npm\s+run|npx)\s+([\w./-]+(?:\.[\w]+)?)/g;
    let c;
    while ((c = cmdRegex.exec(code)) !== null) {
      refs.add(c[1]);
    }
  }
  return [...refs];
}

function getReferencedScripts(markdown) {
  const scripts = new Set();
  const npmRegex = /npm\s+run\s+(\S+)/g;
  let m;
  while ((m = npmRegex.exec(markdown)) !== null) {
    scripts.add(m[1]);
  }
  return [...scripts];
}

function validateFileRefs(filePath, refs) {
  const relPath = path.relative(ROOT, filePath);
  for (const ref of refs) {
    const resolved = resolveRef(filePath, ref);
    const relResolved = path.relative(ROOT, resolved);
    if (relResolved.startsWith("..")) continue;
    const ext = path.extname(relResolved).toLowerCase();
    if (IGNORE_EXTS.has(ext)) continue;
    if (path.basename(relResolved) === "package-lock.json") continue;
    if (!exists(relResolved) && !exists(relResolved.replace(/\.md$/, ".mdx"))) {
      error(`File not found: "${ref}" (resolved: ${relResolved}) — referenced from ${relPath}`);
    }
  }
}

function validateScriptRefs(pkg, scripts, filePath) {
  const relPath = path.relative(ROOT, filePath);
  for (const script of scripts) {
    if (!pkg.scripts || !(script in pkg.scripts)) {
      error(`Script not found: "npm run ${script}" — referenced from ${relPath}`);
    }
  }
}

function validateGeneratedDocs() {
  const generatedDir = path.join(ROOT, "docs", "api", "generated");
  if (!fs.existsSync(generatedDir)) {
    warn("No generated API docs directory found at docs/api/generated/");
    return;
  }
  const files = fs.readdirSync(generatedDir);
  if (files.length === 0) {
    warn("Generated API docs directory is empty — run 'npm run docs:api:generate'");
  }
}

function validateInternalLinks() {
  const mdFiles = globSync("docs/**/*.md", { cwd: ROOT, ignore: ["node_modules/**"] });
  for (const mdFile of mdFiles) {
    const content = fs.readFileSync(path.join(ROOT, mdFile), "utf8");
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let m;
    while ((m = linkRegex.exec(content)) !== null) {
      const href = m[2];
      if (href.startsWith("http") || href.startsWith("#") || href.startsWith("mailto:")) continue;
      const resolved = resolveRef(path.join(ROOT, mdFile), href);
      if (!fs.existsSync(resolved)) {
        error(`Broken internal link: "${href}" in ${mdFile} (resolved: ${path.relative(ROOT, resolved)})`);
      }
    }
  }
}

console.log("=== Documentation Drift Detection ===\n");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const mdFiles = globSync("docs/**/*.md", { cwd: ROOT, ignore: ["node_modules/**"] });
console.log(`Scanning ${mdFiles.length} documentation files...\n`);

for (const mdFile of mdFiles) {
  const content = fs.readFileSync(path.join(ROOT, mdFile), "utf8");
  const refs = getFilePaths(content);
  validateFileRefs(path.join(ROOT, mdFile), refs);
  const scripts = getReferencedScripts(content);
  validateScriptRefs(pkg, scripts, path.join(ROOT, mdFile));
}

console.log("\nValidating generated API documentation...");
validateGeneratedDocs();

console.log("\nChecking internal documentation links...");
validateInternalLinks();

console.log("\n=== Results ===");
console.log(`  Errors:   ${errors.length}`);
console.log(`  Warnings: ${warnings.length}`);

if (errors.length > 0) {
  console.log("\nFailed checks:");
  for (const e of errors) {
    console.log(`  - ${e}`);
  }
}

process.exit(exitCode);
