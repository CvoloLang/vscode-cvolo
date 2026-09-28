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
const editorIntelligenceSource = readText('editor-intelligence.js');
const editorIntelligenceRuntimeSource = readText('editor-intelligence-runtime.js');
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
const libraryPaths = properties['cvolo.libraryPaths'];
if (!libraryPaths) {
  fail('cvolo.libraryPaths setting is required');
} else {
  if (libraryPaths.type !== 'array' || !sameArray(libraryPaths.default, [])) {
    fail('cvolo.libraryPaths must be an array with default []');
  }
  if (libraryPaths.items?.type !== 'string') {
    fail('cvolo.libraryPaths items must be strings');
  }
  if (libraryPaths.scope !== 'window') {
    fail('cvolo.libraryPaths must have window scope');
  }
  if (typeof libraryPaths.description !== 'string'
      || !libraryPaths.description.includes('loose Cvolo workspaces only')
      || !libraryPaths.description.includes('top-level .cvlib files')
      || !libraryPaths.description.includes('ignored for manifest-backed .cvlproj projects')) {
    fail('cvolo.libraryPaths description must document loose-only top-level directory mounting and manifest-project suppression');
  }
}

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

const readonlyInclude = pkg.contributes?.configurationDefaults?.['files.readonlyInclude'];
if (readonlyInclude?.['**/.cvolo/build/**'] !== true) {
  fail('files.readonlyInclude default must mark **/.cvolo/build/** read-only');
}

const decorationDefaults = {
  'cvolo.codeLens.references': true,
  'cvolo.codeLens.layout': true,
  'cvolo.codeLens.fields': true,
  'cvolo.codeLens.fieldReferences': false,
  'cvolo.codeLens.fieldLayout': true,
  'cvolo.codeLens.nativeInterop': true,
  'cvolo.inlayHints.types': true,
  'cvolo.inlayHints.parameters': true,
  'cvolo.inlayHints.receiverMutability': true,
  'cvolo.inlayHints.layout': false,
  'cvolo.inlayHints.enumValues': false,
  'cvolo.inlayHints.genericArguments': false
};

for (const [key, expected] of Object.entries(decorationDefaults)) {
  const setting = properties[key];
  if (!setting) {
    fail(`${key} setting is required`);
    continue;
  }
  if (setting.type !== 'boolean' || setting.default !== expected) {
    fail(`${key} must be a boolean with default ${expected}`);
  }
  if (setting.scope !== 'window') {
    fail(`${key} must have window scope`);
  }
  if (typeof setting.description !== 'string' || !setting.description.trim()) {
    fail(`${key} must have a non-empty description`);
  }
}

if (Object.prototype.hasOwnProperty.call(properties, 'cvolo.codeLens.members')) {
  fail('cvolo.codeLens.members must be replaced by cvolo.codeLens.fields/fieldReferences/fieldLayout');
}

// The offset notation is a choice, not a boolean, so it carries its own contract: only the three
// documented words are accepted, because an unknown word would silently keep an old notation.
const offsetFormat = properties['cvolo.layout.offsetFormat'];
if (!offsetFormat) {
  fail('cvolo.layout.offsetFormat setting is required');
} else {
  if (offsetFormat.type !== 'string' || offsetFormat.default !== 'decimal') {
    fail('cvolo.layout.offsetFormat must be a string with default decimal');
  }
  const values = offsetFormat.enum;
  if (!Array.isArray(values) || values.join(',') !== 'decimal,hex,decimalAndHex') {
    fail('cvolo.layout.offsetFormat enum must be decimal/hex/decimalAndHex');
  }
  if (offsetFormat.scope !== 'window') {
    fail('cvolo.layout.offsetFormat must have window scope');
  }
  if (typeof offsetFormat.description !== 'string' || !offsetFormat.description.trim()) {
    fail('cvolo.layout.offsetFormat must have a non-empty description');
  }
}

const layoutViewDefaults = {
  'cvolo.layout.showPaddingPercentage': false,
  'cvolo.layout.autoRefresh': true
};

for (const [key, expected] of Object.entries(layoutViewDefaults)) {
  const setting = properties[key];
  if (!setting) {
    fail(`${key} setting is required`);
    continue;
  }
  if (setting.type !== 'boolean' || setting.default !== expected) {
    fail(`${key} must be a boolean with default ${expected}`);
  }
  if (setting.scope !== 'window') {
    fail(`${key} must have window scope`);
  }
  if (typeof setting.description !== 'string' || !setting.description.trim()) {
    fail(`${key} must have a non-empty description`);
  }
}

// The layout view is a presentation format, so it needs its own language id: without one the editor
// falls back to plain text and the table loses every scope a theme would otherwise colour.
const layoutLanguage = (pkg.contributes?.languages ?? []).find(language => language.id === 'cvolo-layout');
if (!layoutLanguage) {
  fail('cvolo-layout language must be contributed');
} else {
  if (!Array.isArray(layoutLanguage.extensions) || !layoutLanguage.extensions.includes('.cvlayout')) {
    fail('cvolo-layout language must own the .cvlayout extension');
  }
  if (layoutLanguage.configuration !== undefined) {
    fail('cvolo-layout is a generated read-only view and must not claim a language configuration');
  }
}

const layoutGrammar = (pkg.contributes?.grammars ?? []).find(grammar => grammar.language === 'cvolo-layout');
if (!layoutGrammar) {
  fail('cvolo-layout grammar must be contributed');
} else {
  if (layoutGrammar.scopeName !== 'source.cvolo-layout') {
    fail('cvolo-layout grammar scopeName must be source.cvolo-layout');
  }
  if (layoutGrammar.path !== './syntaxes/cvolo-layout.tmLanguage.json') {
    fail('cvolo-layout grammar path must be ./syntaxes/cvolo-layout.tmLanguage.json');
  }
}

// The grammar has to name the scopes the viewer actually emits, and it must not carry a colour of its
// own: correctness and readability belong to the reader's theme, including the high contrast ones.
const layoutGrammarPath = path.join(root, 'syntaxes', 'cvolo-layout.tmLanguage.json');
if (!fs.existsSync(layoutGrammarPath)) {
  fail('syntaxes/cvolo-layout.tmLanguage.json must exist');
} else {
  let layoutGrammarSource = '';
  try {
    layoutGrammarSource = fs.readFileSync(layoutGrammarPath, 'utf8');
  } catch {
    fail('syntaxes/cvolo-layout.tmLanguage.json must be readable');
  }

  const scopes = [
    'entity.name.type.cvolo-layout',
    'keyword.other.layout.cvolo-layout',
    'support.constant.target.cvolo-layout',
    'constant.numeric.cvolo-layout',
    'keyword.other.unit.cvolo-layout',
    'markup.heading.cvolo-layout',
    'variable.other.member.cvolo-layout',
    'comment.block.padding.cvolo-layout'
  ];
  for (const scope of scopes) {
    if (!layoutGrammarSource.includes(scope)) {
      fail(`cvolo-layout grammar must scope ${scope}`);
    }
  }
  if (/"#[0-9a-fA-F]{3,8}"/.test(layoutGrammarSource)) {
    fail('cvolo-layout grammar must not hardcode a colour');
  }
  if (!layoutGrammarSource.includes('"scopeName": "source.cvolo-layout"')) {
    fail('cvolo-layout grammar must declare the source.cvolo-layout scope');
  }
}

const contributedCommands = pkg.contributes?.commands ?? [];
if (!contributedCommands.some(command => command.command === 'cvolo.showTypeLayout' && command.title === 'Cvolo: Show Type Layout')) {
  fail('cvolo.showTypeLayout must be contributed as Cvolo: Show Type Layout');
}
if (contributedCommands.some(command => command.command === 'cvolo.showReferences')) {
  fail('cvolo.showReferences is a CodeLens bridge and must not be contributed as a palette command');
}

const paletteEntries = pkg.contributes?.menus?.commandPalette ?? [];
if (!paletteEntries.some(entry => entry.command === 'cvolo.showTypeLayout' && entry.when === 'editorLangId == cvolo')) {
  fail('cvolo.showTypeLayout must be available in the command palette for Cvolo editors');
}
if (paletteEntries.some(entry => entry.command === 'cvolo.showReferences')) {
  fail('cvolo.showReferences must not be offered in the command palette');
}

const contextEntries = pkg.contributes?.menus?.['editor/context'] ?? [];
if (!contextEntries.some(entry => entry.command === 'cvolo.showTypeLayout' && entry.when === 'editorLangId == cvolo')) {
  fail('cvolo.showTypeLayout must be offered from the Cvolo editor context menu');
}

if (!/synchronize:\s*\{\s*configurationSection:\s*'cvolo'\s*\}/s.test(extensionSource)) {
  fail('the LanguageClient must synchronize the cvolo configuration section so decoration settings need no restart');
}
if (!extensionSource.includes("registerEditorIntelligence(context")) {
  fail('editor intelligence wiring must be registered during activation');
}
if (!editorIntelligenceSource.includes("require('./editor-intelligence-runtime')")) {
  fail('editor-intelligence.js must delegate to editor-intelligence-runtime.js');
}
if (!editorIntelligenceSource.includes('renderLayout(layout, options)')
    || !editorIntelligenceSource.includes('layoutViewOptions()')) {
  fail('editor-intelligence.js must render layouts with the pure runtime formatter and the reader\'s layout settings');
}
if (!editorIntelligenceSource.includes('registerDefinitionProvider')
    || !editorIntelligenceSource.includes('registerHoverProvider')) {
  fail('editor-intelligence.js must register the layout definition and hover providers');
}

if (!editorIntelligenceSource.includes('registerCodeLensProvider')) {
  fail('editor-intelligence.js must register a layout code lens provider for nested Show Layout');
}
if (!editorIntelligenceSource.includes('createLayoutRefresher')
    || !editorIntelligenceSource.includes('generation')
    || !editorIntelligenceSource.includes('onDidChangeTextDocument')
    || !editorIntelligenceSource.includes('onDidChangeConfiguration')
    || !editorIntelligenceSource.includes('onDidChange: layoutChanged.event')) {
  fail('editor-intelligence.js must refresh open layout views, by subject, when the project or settings change');
}
if (!editorIntelligenceSource.includes('LAYOUT_UNAVAILABLE_TEXT')) {
  fail('editor-intelligence.js must show the unavailable state when a subject no longer resolves');
}
if (!/getConfiguration\('cvolo'\)\.get\('layout'/.test(editorIntelligenceSource)) {
  fail('editor-intelligence.js must read the cvolo.layout settings for the viewer');
}
if (!editorIntelligenceSource.includes('sendRequest(TYPE_LAYOUT_REQUEST')) {
  fail('editor-intelligence.js must ask the server for compiler layout facts');
}
if (!/executeCommand\(REFERENCE_PROVIDER_COMMAND/.test(editorIntelligenceSource)) {
  fail('cvolo.showReferences must delegate to the normal reference provider command');
}
if (!/executeCommand\(SHOW_REFERENCES_EDITOR_COMMAND/.test(editorIntelligenceSource)) {
  fail('cvolo.showReferences must open the normal references editor command');
}
if (/parse(Source|Text)\s*\(/.test(editorIntelligenceRuntimeSource)) {
  fail('editor-intelligence-runtime.js must not parse Cvolo source');
}
if (!editorIntelligenceRuntimeSource.includes('LAYOUT_UNAVAILABLE_TEXT')) {
  fail('editor-intelligence-runtime.js must expose the unavailable layout text so the view can show it');
}

for (const relative of ['extension.js', 'editor-intelligence.js', 'editor-intelligence-runtime.js', 'extension-runtime.js']) {
  if (!pkg.scripts?.check?.includes(`node --check ${relative}`)) {
    fail(`package.json check script must syntax check ${relative}`);
  }
}

if (/require\(['"]vscode['"]\)/.test(editorIntelligenceRuntimeSource)) {
  fail('editor-intelligence-runtime.js must be Node-loadable without the VS Code extension-host API');
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
if (!extensionSource.includes("affectsConfiguration('cvolo.libraryPaths')")) {
  fail('cvolo.libraryPaths changes must trigger restart logic');
}
if ((extensionSource.match(/affectsConfiguration\(/g) || []).length !== 2) {
  fail('only cvolo.server.path and cvolo.libraryPaths may have extension-owned configuration restart logic');
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
