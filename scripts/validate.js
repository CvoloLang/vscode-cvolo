'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`check failed: ${message}`);
  process.exitCode = 1;
}

function readText(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function readJson(relative) {
  try {
    return JSON.parse(readText(relative));
  } catch (error) {
    fail(`${relative} must contain valid JSON: ${error.message}`);
    return {};
  }
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function walkFiles(directory, predicate, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, '/');

    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.github', 'scripts', 'test', 'tests', 'specs', 'server'].includes(entry.name)) {
        continue;
      }
      walkFiles(absolute, predicate, output);
      continue;
    }

    if (entry.isFile() && predicate(relative)) {
      output.push(relative);
    }
  }

  return output;
}

function collectIncludes(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectIncludes(item, output);
    return output;
  }

  if (!value || typeof value !== 'object') {
    return output;
  }

  for (const [key, item] of Object.entries(value)) {
    if (key === 'include' && typeof item === 'string') {
      output.push(item);
    }
    collectIncludes(item, output);
  }

  return output;
}

const pkg = readJson('package.json');
const grammar = readJson('syntaxes/cvolo.tmLanguage.json');
const languageConfiguration = readJson('language-configuration.json');
const lock = readJson('package-lock.json');
const extensionSource = readText('extension.js');
const runtimeSource = readText('extension-runtime.js');
const vscodeIgnore = readText('.vscodeignore');

if (pkg.engines?.vscode !== '^1.82.0') {
  fail('package.json must require VS Code ^1.82.0');
}

if (pkg.dependencies?.['vscode-languageclient'] !== '9.0.1') {
  fail('vscode-languageclient must be pinned to 9.0.1');
}

if (lock.packages?.['']?.dependencies?.['vscode-languageclient'] !== '9.0.1') {
  fail('package-lock root dependency must pin vscode-languageclient 9.0.1');
}

if (lock.packages?.['node_modules/vscode-languageclient']?.version !== '9.0.1') {
  fail('package-lock must resolve vscode-languageclient 9.0.1');
}

if (!sameArray(pkg.extensionKind, ['workspace'])) {
  fail('extensionKind must be exactly ["workspace"]');
}

const virtualWorkspaces = pkg.capabilities?.virtualWorkspaces;
if (virtualWorkspaces?.supported !== false) {
  fail('capabilities.virtualWorkspaces.supported must be false');
}
if (typeof virtualWorkspaces?.description !== 'string' || !virtualWorkspaces.description.trim()) {
  fail('virtualWorkspaces must have a non-empty explanatory description');
}

if (!pkg.activationEvents?.includes('onLanguage:cvolo')) {
  fail('activationEvents must include onLanguage:cvolo');
}

const language = pkg.contributes?.languages?.find(item => item.id === 'cvolo');
if (!language || !language.extensions?.includes('.cvl')) {
  fail('language id cvolo with .cvl extension is required');
}
if (language?.configuration !== './language-configuration.json') {
  fail('cvolo language configuration must be ./language-configuration.json');
}

const grammarContribution = pkg.contributes?.grammars?.find(item => item.language === 'cvolo');
if (!grammarContribution
    || grammarContribution.scopeName !== 'source.cvolo'
    || grammarContribution.path !== './syntaxes/cvolo.tmLanguage.json') {
  fail('Cvolo grammar contribution must use source.cvolo and ./syntaxes/cvolo.tmLanguage.json');
}
if (grammar.scopeName !== 'source.cvolo') {
  fail('TextMate grammar scopeName must be source.cvolo');
}

for (const include of collectIncludes(grammar)) {
  if (path.posix.isAbsolute(include) || path.win32.isAbsolute(include)) {
    fail(`TextMate grammar include must not be an absolute path: ${include}`);
  }
}

if (languageConfiguration.comments?.lineComment !== '//'
    || !sameArray(languageConfiguration.comments?.blockComment, ['/*', '*/'])) {
  fail('language configuration must define Cvolo line and block comments');
}
if (!Array.isArray(languageConfiguration.brackets) || languageConfiguration.brackets.length === 0) {
  fail('language configuration must define brackets');
}
if (!Array.isArray(languageConfiguration.autoClosingPairs) || languageConfiguration.autoClosingPairs.length === 0) {
  fail('language configuration must define autoClosingPairs');
}

const properties = pkg.contributes?.configuration?.properties ?? {};
const trace = properties['cvolo.trace.server'];
if (!trace) {
  fail('canonical cvolo.trace.server setting is required');
} else {
  if (trace.type !== 'string' || trace.default !== 'off') {
    fail('cvolo.trace.server must be a string with default off');
  }
  if (!sameArray(trace.enum, ['off', 'messages', 'verbose'])) {
    fail('cvolo.trace.server enum must be off/messages/verbose');
  }
}
if (Object.prototype.hasOwnProperty.call(properties, 'cvolo.server.trace')) {
  fail('legacy cvolo.server.trace setting must not be contributed');
}
if (Object.prototype.hasOwnProperty.call(properties, 'cvolo.server.arguments')) {
  fail('VSCode-0 must not contribute generic cvolo.server.arguments');
}

if (!extensionSource.match(/new LanguageClient\(\s*['"]cvolo['"]/s)) {
  fail('LanguageClient id must be cvolo');
}
if (!extensionSource.match(/documentSelector:\s*\[\{\s*scheme:\s*['"]file['"],\s*language:\s*['"]cvolo['"]\s*\}\]/s)) {
  fail('LanguageClient document selector must target file + cvolo');
}
if (!extensionSource.match(/connectionOptions:\s*\{\s*maxRestartCount:\s*0\s*\}/s)) {
  fail('LanguageClient connectionOptions.maxRestartCount must be 0');
}
if (!extensionSource.includes('cvolo.restartLanguageServer')) {
  fail('restart command wiring is missing');
}
if (!runtimeSource.includes("'cvolo-language-server'")) {
  fail('Language Server PATH fallback is missing');
}
if (!extensionSource.includes("affectsConfiguration('cvolo.server.path')")) {
  fail('cvolo.server.path changes must trigger restart logic');
}
if ((extensionSource.match(/affectsConfiguration\(/g) || []).length !== 1) {
  fail('only cvolo.server.path may have extension-owned configuration restart logic');
}
if (/\.setTrace\s*\(/.test(extensionSource)) {
  fail('extension-owned protocol trace setTrace logic is forbidden');
}
if (extensionSource.includes('--verbose')) {
  fail('protocol trace must not derive Language Server CLI --verbose arguments');
}
if (extensionSource.includes('cvolo.server.trace')) {
  fail('production extension code must not use legacy cvolo.server.trace');
}
if (extensionSource.includes('cvolo.trace.server')) {
  fail('production extension code must leave cvolo.trace.server handling to vscode-languageclient');
}
if (!extensionSource.includes('LifecycleController')) {
  fail('extension must use the serialized LifecycleController');
}

const productionJs = walkFiles(root, relative => relative.endsWith('.js'));
if (productionJs.length < 2) {
  fail('expected extension.js and at least one Node-loadable runtime helper module');
}

const forbidden = [
  /efm-langserver/i,
  /Cvolo\.Compiler\.Tooling/,
  /Cvolo\.Compiler/,
  /Antlr4\.Runtime/,
  /antlr(?:4)?(?:\.runtime|\/runtime|\\runtime)/i,
  /compiler[^\n'"`]*\.dll/i,
  /\bCVL\d{4}\b/
];
const machineSpecificPath = /(?:[A-Za-z]:\\(?:Users|Programming|dev|src)\\|\/(?:home|Users)\/[A-Za-z0-9._-]+\/)/;

for (const relative of productionJs) {
  const source = readText(relative);
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      fail(`forbidden compiler/prototype/diagnostic reference found in ${relative}: ${pattern}`);
    }
  }
  if (machineSpecificPath.test(source)) {
    fail(`machine-specific absolute development path found in ${relative}`);
  }
}

if (/require\(['"]vscode['"]\)/.test(runtimeSource)) {
  fail('extension-runtime.js must be Node-loadable without the VS Code extension-host API');
}

for (const line of vscodeIgnore.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
  if (/^server\/(?:\*\*?|\*\/\*\*)\/?$/.test(line)) {
    fail('.vscodeignore must not exclude the entire future server/** runtime tree');
  }
}

if (!process.exitCode) {
  console.log(`Cvolo.VSCode static checks passed (${productionJs.join(', ')}).`);
}
