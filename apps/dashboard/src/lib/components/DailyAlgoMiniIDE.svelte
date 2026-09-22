<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  // Pas d'import de 'monaco-editor' entier : il embarque ~80 langages, les
  // services json/css/html et leurs workers, qui alourdissaient fortement le
  // build Vite. On ne charge que le coeur de l'editeur et les langages que
  // monacoLanguage() peut renvoyer : tout langage ajoute la-bas doit l'etre ici.
  import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
  import 'monaco-editor/esm/vs/editor/edcore.main.js';
  import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
  import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
  import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
  import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
  import 'monaco-editor/esm/vs/basic-languages/lua/lua.contribution.js';
  import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
  import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
  import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
  import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import { detectIdeLanguageFromCode, normalizeIdeLanguage, type IdeLanguage } from '../dailyAlgoIde';

  type ExerciseFunctionArg = {
    name: string;
    type?: string;
  };

  type ExerciseUnitTest = {
    name?: string;
    args: unknown[];
    expected: unknown;
  };

  type UnitTestResult = {
    name: string;
    passed: boolean;
    expected: unknown;
    actual: unknown;
    error?: string;
    durationMs: number;
  };

  type UnitTestSummary = {
    total: number;
    passed: number;
    failed: number;
    suggestedCorrectness: number;
    language: IdeLanguage;
    durationMs: number;
  };

  const ALL_SUPPORTED_LANGUAGES: IdeLanguage[] = ['javascript', 'typescript', 'python', 'c', 'lua', 'sqlite'];

  if (typeof window !== 'undefined' && !window.MonacoEnvironment?.getWorker) {
    window.MonacoEnvironment = {
      getWorker(_moduleId: string, label: string) {
        if (label === 'typescript' || label === 'javascript') return new tsWorker();
        return new editorWorker();
      },
    };
  }

  const PYODIDE_SCRIPT = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js';
  const PYODIDE_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';
  const TYPESCRIPT_SCRIPT = 'https://cdn.jsdelivr.net/npm/typescript@5.6.3/lib/typescript.js';
  const FENGARI_SCRIPT = 'https://cdn.jsdelivr.net/npm/fengari-web@0.1.4/dist/fengari-web.js';
  const SQLJS_SCRIPT = 'https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/sql-wasm.js';
  const SQLJS_WASM_BASE = 'https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/';
  const JSCPP_SCRIPT_CANDIDATES = [
    `${import.meta.env.BASE_URL}vendor/JSCPP.es5.min.js`,
    'https://cdn.jsdelivr.net/gh/felixhao28/JSCPP@gh-pages/dist/JSCPP.es5.min.js',
  ];

  const assetPromises = new Map<string, Promise<void>>();

  function ensureScript(url: string): Promise<void> {
    if (typeof document === 'undefined') return Promise.resolve();
    const cacheKey = `js:${url}`;
    const cached = assetPromises.get(cacheKey);
    if (cached) return cached;

    const existing = document.querySelector(`script[data-kotbo-asset="${url}"]`) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === 'true') {
      const ready = Promise.resolve();
      assetPromises.set(cacheKey, ready);
      return ready;
    }

    const promise = new Promise<void>((resolve, reject) => {
      const script = existing ?? document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.kotboAsset = url;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = () => reject(new Error(`Impossible de charger ${url}`));
      if (!existing) document.head.appendChild(script);
    });

    assetPromises.set(cacheKey, promise);
    return promise;
  }

  async function ensureJSCPP(): Promise<NonNullable<Window['JSCPP']>> {
    if (window.JSCPP?.run) return window.JSCPP;

    const loadErrors: string[] = [];

    for (const url of JSCPP_SCRIPT_CANDIDATES) {
      try {
        await ensureScript(url);
        if (window.JSCPP?.run) return window.JSCPP;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        loadErrors.push(`${url} (${message})`);
      }
    }

    const details = loadErrors.length > 0 ? ` Sources testees: ${loadErrors.join(' | ')}` : '';
    throw new Error(`Impossible de charger le runtime C (JSCPP).${details}`);
  }

  async function ensurePyodide(): Promise<Awaited<NonNullable<Window['__kotboPyodidePromise']>>> {
    if (!window.__kotboPyodidePromise) {
      window.__kotboPyodidePromise = (async () => {
        if (!window.loadPyodide) {
          await ensureScript(PYODIDE_SCRIPT);
        }
        if (!window.loadPyodide) {
          throw new Error('Pyodide indisponible.');
        }
        return window.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
      })();
    }

    return window.__kotboPyodidePromise;
  }

  async function ensureTypeScript(): Promise<NonNullable<Window['ts']>> {
    if (!window.ts?.transpileModule) {
      await ensureScript(TYPESCRIPT_SCRIPT);
    }
    if (!window.ts?.transpileModule) {
      throw new Error('Runtime TypeScript indisponible.');
    }
    return window.ts;
  }

  async function ensureFengari(): Promise<NonNullable<Window['fengari']>> {
    if (!window.fengari?.load) {
      await ensureScript(FENGARI_SCRIPT);
    }
    if (!window.fengari?.load) {
      throw new Error('Runtime Lua indisponible.');
    }
    return window.fengari;
  }

  async function ensureSqlJs(): Promise<Awaited<NonNullable<Window['__kotboSqlJsPromise']>>> {
    if (!window.__kotboSqlJsPromise) {
      window.__kotboSqlJsPromise = (async () => {
        if (!window.initSqlJs) {
          await ensureScript(SQLJS_SCRIPT);
        }
        if (!window.initSqlJs) {
          throw new Error('Runtime SQLite indisponible.');
        }
        return window.initSqlJs({
          locateFile: (file: string) => `${SQLJS_WASM_BASE}${file}`,
        });
      })();
    }

    return window.__kotboSqlJsPromise;
  }

  function nowLabel(): string {
    return new Date().toLocaleTimeString('fr-FR', { hour12: false });
  }

  function stringifyChunk(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
      return String(value);
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function toTransportSafeValue(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function') return '__FUNCTION__';
    if (typeof value === 'symbol') return String(value);

    if (Array.isArray(value)) {
      return value.map((entry) => toTransportSafeValue(entry, seen));
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      if (seen.has(value as object)) {
        return '__CIRCULAR__';
      }

      seen.add(value as object);
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        output[key] = toTransportSafeValue(entry, seen);
      }
      seen.delete(value as object);
      return output;
    }

    return String(value);
  }

  function formatSqlResultTable(columns: string[], values: unknown[][]): string {
    if (!columns.length) return '(aucune colonne)';

    const asCell = (value: unknown): string => {
      if (value === null || value === undefined) return 'NULL';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return stringifyChunk(value);
    };

    const rows = [columns, ...values.map((row) => columns.map((_, index) => asCell(row[index])))];
    const widths = columns.map((_, index) =>
      rows.reduce((max, row) => Math.max(max, (row[index] ?? '').length), 0),
    );

    const renderRow = (row: string[]) =>
      `| ${row.map((cell, index) => (cell ?? '').padEnd(widths[index], ' ')).join(' | ')} |`;
    const separator = `|-${widths.map((width) => ''.padEnd(width, '-')).join('-|-')}-|`;

    const lines = [renderRow(columns), separator];
    for (const row of values) {
      const paddedRow = columns.map((_, index) => asCell(row[index]));
      lines.push(renderRow(paddedRow));
    }
    return lines.join('\n');
  }

  function normalizedLanguage(languageInput: string | undefined, sourceCode: string): IdeLanguage {
    const normalized = normalizeIdeLanguage(languageInput);
    if (languageInput && languageInput.trim()) return normalized;
    return detectIdeLanguageFromCode(sourceCode);
  }

  function monacoLanguage(languageInput: IdeLanguage): string {
    if (languageInput === 'typescript') return 'typescript';
    if (languageInput === 'python') return 'python';
    if (languageInput === 'c') return 'cpp';
    if (languageInput === 'lua') return 'lua';
    if (languageInput === 'sqlite') return 'sql';
    return 'javascript';
  }

  function extensionForLanguage(languageInput: IdeLanguage): string {
    if (languageInput === 'typescript') return 'ts';
    if (languageInput === 'python') return 'py';
    if (languageInput === 'c') return 'c';
    if (languageInput === 'lua') return 'lua';
    if (languageInput === 'sqlite') return 'sql';
    return 'js';
  }

  function runtimeLabel(languageInput: IdeLanguage): string {
    if (languageInput === 'javascript') return 'JS Worker';
    if (languageInput === 'typescript') return 'TypeScript + JS Worker';
    if (languageInput === 'python') return 'Pyodide';
    if (languageInput === 'c') return 'JSCPP';
    if (languageInput === 'lua') return 'Fengari';
    return 'sql.js';
  }

  function languageDisplayName(languageInput: IdeLanguage): string {
    if (languageInput === 'javascript') return 'JavaScript';
    if (languageInput === 'typescript') return 'TypeScript';
    if (languageInput === 'python') return 'Python';
    if (languageInput === 'c') return 'C / C++';
    if (languageInput === 'lua') return 'Lua';
    return 'SQLite';
  }

  function normalizedAllowedLanguages(): IdeLanguage[] {
    const normalized = (Array.isArray(allowedLanguages) ? allowedLanguages : [])
      .map((entry) => {
        const value = typeof entry === 'string' ? entry.trim().toLowerCase() : '';
        if (!value) return null;
        if (value === 'javascript' || value === 'js') return 'javascript';
        if (value === 'typescript' || value === 'ts') return 'typescript';
        if (value === 'python' || value === 'py') return 'python';
        if (value === 'c' || value === 'cpp' || value === 'c++') return 'c';
        if (value === 'lua') return 'lua';
        if (value === 'sqlite' || value === 'sql') return 'sqlite';
        return null;
      })
      .filter((entry): entry is IdeLanguage => Boolean(entry))
      .filter((entry, index, array) => ALL_SUPPORTED_LANGUAGES.includes(entry) && array.indexOf(entry) === index);

    if (normalized.length > 0) return normalized;
    return [...ALL_SUPPORTED_LANGUAGES];
  }

  function normalizedFunctionName(): string {
    if (typeof functionName !== 'string') return '';
    const trimmed = functionName.trim();
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : '';
  }

  function normalizedFunctionArgs(): ExerciseFunctionArg[] {
    if (!Array.isArray(functionArgs)) return [];

    return functionArgs
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const candidate = entry as { name?: unknown; type?: unknown };
        const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
        const type = typeof candidate.type === 'string' ? candidate.type.trim() : '';
        if (!name) return null;
        return { name, type };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }

  function normalizedUnitTests(): ExerciseUnitTest[] {
    if (!Array.isArray(unitTests)) return [];

    return unitTests
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') return null;
        const candidate = entry as { name?: unknown; args?: unknown; expected?: unknown };
        const args = Array.isArray(candidate.args) ? candidate.args : null;
        if (!args) return null;
        const name = typeof candidate.name === 'string' && candidate.name.trim()
          ? candidate.name.trim()
          : `Test ${index + 1}`;

        return {
          name,
          args,
          expected: candidate.expected,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }

  function testFunctionSignature(): string {
    const fnName = normalizedFunctionName();
    if (!fnName) return 'Aucune fonction attendue';

    const args = normalizedFunctionArgs().map((entry) => {
      if (!entry.type) return entry.name;
      return `${entry.name}: ${entry.type}`;
    });
    return `${fnName}(${args.join(', ')})`;
  }

  function testSupportLabel(languageInput: IdeLanguage): string {
    if (languageInput === 'javascript' || languageInput === 'typescript' || languageInput === 'python') {
      return 'Tests automatiques disponibles';
    }
    return 'Tests automatiques indisponibles pour ce runtime';
  }

  function hasConfiguredUnitTests(): boolean {
    return normalizedUnitTests().length > 0;
  }

  function canRunAutomatedTests(languageInput: IdeLanguage): boolean {
    return languageInput === 'javascript' || languageInput === 'typescript' || languageInput === 'python';
  }

  function hasCMainFunction(source: string): boolean {
    return /\bmain\s*\(/.test(source);
  }

  function stripCommonIndentation(source: string): string {
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const nonEmpty = lines.filter((line) => line.trim().length > 0);
    if (nonEmpty.length === 0) return source;

    const minIndent = nonEmpty.reduce((min, line) => {
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      return Math.min(min, indent);
    }, Number.POSITIVE_INFINITY);

    return lines.map((line) => line.slice(Math.min(minIndent, line.length))).join('\n');
  }

  function wrapCSnippetWithMain(source: string): string {
    const snippet = stripCommonIndentation(source.trim());
    const body = snippet
      .split('\n')
      .map((line) => (line.trim().length > 0 ? `  ${line}` : ''))
      .join('\n');

    return [
      '#include <iostream>',
      '#include <stdio.h>',
      '#include <stdlib.h>',
      '#include <string.h>',
      'using namespace std;',
      '',
      'int main() {',
      body,
      '  return 0;',
      '}',
      '',
    ].join('\n');
  }

  function heightValueToCss(heightInput: number | string): string {
    if (typeof heightInput === 'number') return `${heightInput}px`;
    const trimmed = heightInput.trim();
    if (/^\d+$/.test(trimmed)) return `${trimmed}px`;
    return trimmed;
  }

  const {
    initialCode = '',
    initialLanguage = 'javascript',
    height = 560,
    showPopoutButton = false,
    popoutLabel = 'Ouvrir dans une fenetre',
    fileLabel = 'solution',
    languagePersistenceKey = '',
    allowedLanguages = [],
    functionName = '',
    functionArgs = [],
    unitTests = [],
  } = $props<{
    initialCode?: string;
    initialLanguage?: string;
    height?: number | string;
    showPopoutButton?: boolean;
    popoutLabel?: string;
    fileLabel?: string;
    languagePersistenceKey?: string;
    allowedLanguages?: string[];
    functionName?: string;
    functionArgs?: ExerciseFunctionArg[];
    unitTests?: ExerciseUnitTest[];
  }>();

  const dispatch = createEventDispatcher<{ popout: { code: string; language: IdeLanguage } }>();

  let code = $state('');
  let language = $state<IdeLanguage>('javascript');
  let stdin = $state('');
  let isRunning = $state(false);
  let isRunningTests = $state(false);
  let unitTestResults = $state<UnitTestResult[]>([]);
  let unitTestError = $state('');
  let hasAutoRunUnitTests = $state(false);
  let bootError = $state('');
  let runtimeHint = $state('');
  let terminalLineCount = $state(0);
  let lastUnitTestSummary = $state<UnitTestSummary | null>(null);

  let cursorLine = $state(1);
  let cursorColumn = $state(1);
  let lineCount = $state(1);

  let editorContainer: HTMLDivElement | null = null;
  let terminalContainer: HTMLDivElement | null = null;

  let editor: monaco.editor.IStandaloneCodeEditor | null = null;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let editorDisposables: monaco.IDisposable[] = [];
  let terminalResizeObserver: ResizeObserver | null = null;
  let removeWindowResizeListener: (() => void) | null = null;

  function storageLanguageKey(): string | null {
    if (!languagePersistenceKey || !languagePersistenceKey.trim()) return null;
    return `kotbo:daily-ide:language:${languagePersistenceKey.trim()}`;
  }

  function readPersistedLanguage(fallback: IdeLanguage): IdeLanguage {
    if (typeof window === 'undefined') return fallback;
    const key = storageLanguageKey();
    if (!key) return fallback;
    const saved = window.localStorage.getItem(key);
    if (!saved) return fallback;
    return normalizeIdeLanguage(saved);
  }

  function persistLanguage(nextLanguage: IdeLanguage) {
    if (typeof window === 'undefined') return;
    const key = storageLanguageKey();
    if (!key) return;
    window.localStorage.setItem(key, nextLanguage);
  }

  function writeTerminal(kind: 'info' | 'stdout' | 'stderr' | 'error' | 'result', text: string) {
    if (!terminal) return;
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const tag =
      kind === 'stderr' ? 'WARN' :
      kind === 'error' ? 'ERROR' :
      kind === 'result' ? 'RESULT' :
      kind === 'stdout' ? 'OUT' :
      'INFO';

    for (const line of lines) {
      const printed = line.length > 0 ? line : ' ';
      terminal.writeln(`[${nowLabel()}] ${tag}: ${printed}`);
      terminalLineCount += 1;
    }
  }

  function resetTerminal() {
    if (!terminal) return;
    terminal.clear();
    terminalLineCount = 0;
    writeTerminal('info', 'Kotbo IDE ready.');
    writeTerminal('info', 'Execution client-side: JS/TS Worker, Python Pyodide, C JSCPP, Lua Fengari, SQLite sql.js.');
  }

  function clearTerminal() {
    resetTerminal();
  }

  function formatExecutionDuration(durationMs: number): string {
    if (!Number.isFinite(durationMs) || durationMs < 0) return 'n/a';
    if (durationMs < 1000) {
      return `${durationMs.toFixed(durationMs < 10 ? 2 : 1)} ms`;
    }

    const seconds = durationMs / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds - minutes * 60;
    return `${minutes} min ${remainingSeconds.toFixed(1)} s`;
  }

  function updateRuntimeHint(nextLanguage: IdeLanguage) {
    if (nextLanguage === 'typescript') {
      runtimeHint = 'TypeScript transpile en JavaScript dans le navigateur, puis execute dans un Web Worker.';
      return;
    }
    if (nextLanguage === 'c') {
      runtimeHint = 'C/C++ execute dans le navigateur via JSCPP local (aucun serveur de compilation).';
      return;
    }
    if (nextLanguage === 'python') {
      runtimeHint = 'Python execute dans le navigateur via Pyodide (WASM).';
      return;
    }
    if (nextLanguage === 'lua') {
      runtimeHint = 'Lua execute dans le navigateur via Fengari (VM Lua en JavaScript).';
      return;
    }
    if (nextLanguage === 'sqlite') {
      runtimeHint = 'SQLite execute dans le navigateur via sql.js (base en memoire, non persistante).';
      return;
    }
    runtimeHint = 'JavaScript execute dans un Web Worker isole.';
  }

  function updateModelLanguage(nextLanguage: IdeLanguage) {
    const model = editor?.getModel();
    if (!model) return;
    monaco.editor.setModelLanguage(model, monacoLanguage(nextLanguage));
  }

  function updateEditorStats() {
    const model = editor?.getModel();
    lineCount = model?.getLineCount() ?? 1;
    const pos = editor?.getPosition();
    cursorLine = pos?.lineNumber ?? 1;
    cursorColumn = pos?.column ?? 1;
  }

  function onLanguageChange(nextLanguage: IdeLanguage, persist = true) {
    const available = normalizedAllowedLanguages();
    const resolved = available.includes(nextLanguage) ? nextLanguage : available[0];
    language = resolved;
    updateRuntimeHint(resolved);
    updateModelLanguage(resolved);

    if (persist) persistLanguage(resolved);
  }

  async function runJavaScript(source: string): Promise<void> {
    const workerSource = `
      const asText = (value) => {
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value);
        try { return JSON.stringify(value, null, 2); } catch { return String(value); }
      };

      const send = (kind, payload) => postMessage({ kind, payload });

      self.onmessage = async (event) => {
        const code = String(event?.data?.code ?? '');
        try {
          const scopedConsole = {
            log: (...args) => send('stdout', args.map(asText).join(' ')),
            info: (...args) => send('stdout', args.map(asText).join(' ')),
            warn: (...args) => send('stderr', args.map(asText).join(' ')),
            error: (...args) => send('error', args.map(asText).join(' ')),
          };

          const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
          const fn = new AsyncFunction('console', code);
          const result = await fn(scopedConsole);

          if (typeof result !== 'undefined') {
            send('result', asText(result));
          }

          send('done', 'ok');
        } catch (error) {
          const message = error && error.stack ? error.stack : String(error);
          send('error', message);
          send('done', 'error');
        }
      };
    `;

    const blob = new Blob([workerSource], { type: 'application/javascript' });
    const objectUrl = URL.createObjectURL(blob);
    const worker = new Worker(objectUrl);

    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => {
        writeTerminal('error', 'Execution JavaScript interrompue (timeout 8s).');
        worker.terminate();
        resolve();
      }, 8000);

      worker.onmessage = (event: MessageEvent<{ kind: string; payload: string }>) => {
        const { kind, payload } = event.data;

        if (kind === 'done') {
          clearTimeout(timeout);
          worker.terminate();
          resolve();
          return;
        }

        if (kind === 'stdout') {
          writeTerminal('stdout', payload);
          return;
        }
        if (kind === 'stderr') {
          writeTerminal('stderr', payload);
          return;
        }
        if (kind === 'result') {
          writeTerminal('result', payload);
          return;
        }

        writeTerminal('error', payload);
      };

      worker.onerror = (error) => {
        clearTimeout(timeout);
        writeTerminal('error', error.message || 'Erreur JavaScript inconnue.');
        worker.terminate();
        resolve();
      };

      worker.postMessage({ code: source });
    });

    URL.revokeObjectURL(objectUrl);
  }

  async function runTypeScript(source: string): Promise<void> {
    const tsCompiler = await ensureTypeScript();
    const transpiled = tsCompiler.transpileModule(source, {
      compilerOptions: {
        module: tsCompiler.ModuleKind.ES2020,
        target: tsCompiler.ScriptTarget.ES2020,
        strict: false,
        sourceMap: false,
      },
      reportDiagnostics: true,
    });

    for (const diagnostic of transpiled.diagnostics ?? []) {
      const message = tsCompiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (message.trim().length > 0) {
        writeTerminal('stderr', `TypeScript: ${message}`);
      }
    }

    const output = transpiled.outputText ?? '';
    if (!output.trim()) {
      writeTerminal('info', 'TypeScript transpile, mais aucun JavaScript n\'a ete genere.');
      return;
    }

    await runJavaScript(output);
  }

  async function runPython(source: string): Promise<void> {
    const pyodide = await ensurePyodide();

    pyodide.setStdout?.({
      batched: (text: string) => {
        writeTerminal('stdout', text);
      },
    });

    pyodide.setStderr?.({
      batched: (text: string) => {
        writeTerminal('stderr', text);
      },
    });

    const result = await pyodide.runPythonAsync(source);
    if (typeof result !== 'undefined') {
      writeTerminal('result', stringifyChunk(result));
    }
  }

  async function runLua(source: string): Promise<void> {
    const fengari = await ensureFengari();
    window.__kotboLuaPrint = (message: string) => {
      writeTerminal('stdout', message);
    };

    const instrumentedSource = [
      'local __kotbo_ok, __kotbo_js = pcall(require, "js")',
      'if __kotbo_ok and __kotbo_js and __kotbo_js.global and __kotbo_js.global.__kotboLuaPrint then',
      '  function print(...)',
      '    local __kotbo_parts = {}',
      '    for i = 1, select("#", ...) do',
      '      __kotbo_parts[i] = tostring(select(i, ...))',
      '    end',
      '    __kotbo_js.global.__kotboLuaPrint(table.concat(__kotbo_parts, "\\t"))',
      '  end',
      'end',
      '',
      source,
    ].join('\n');

    try {
      const runChunk = fengari.load(instrumentedSource, 'kotbo.lua');
      const result = runChunk();
      if (typeof result !== 'undefined') {
        writeTerminal('result', stringifyChunk(result));
      }
    } finally {
      delete window.__kotboLuaPrint;
    }
  }

  async function runC(source: string, input: string): Promise<void> {
    const jscpp = await ensureJSCPP();
    let outputBuffer = '';

    const execute = (program: string) => {
      outputBuffer = '';
      const result = jscpp.run(program, input, {
        stdio: {
          write: (chunk: string) => {
            outputBuffer += chunk;
          },
        },
      });

      if (outputBuffer.trim().length > 0) {
        writeTerminal('stdout', outputBuffer.trimEnd());
      }

      if (typeof result !== 'undefined' && String(result).trim().length > 0) {
        writeTerminal('result', stringifyChunk(result));
      }
    };

    try {
      execute(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const mainMissing = /method main is not defined in \$global/i.test(message);

      if (!mainMissing || hasCMainFunction(source)) {
        throw error;
      }

      writeTerminal('info', 'Aucune fonction main detectee: tentative automatique avec un wrapper int main().');

      try {
        execute(wrapCSnippetWithMain(source));
      } catch {
        throw error;
      }
    }
  }

  async function runSQLite(source: string): Promise<void> {
    const sqlJs = await ensureSqlJs();
    const db = new sqlJs.Database();

    try {
      const results = db.exec(source);

      if (results.length === 0) {
        writeTerminal('info', 'Execution SQLite terminee (aucun resultat tabulaire).');
        return;
      }

      results.forEach((result, index) => {
        writeTerminal('result', `Resultat ${index + 1}:`);
        writeTerminal('stdout', formatSqlResultTable(result.columns, result.values));
      });
    } finally {
      db.close();
    }
  }

  async function runJavaScriptUnitTests(
    source: string,
    functionNameInput: string,
    testCases: ExerciseUnitTest[],
  ): Promise<UnitTestResult[]> {
    const workerSource = `
      const toCloneable = (value, seen = new WeakSet()) => {
        if (value === null || value === undefined) return value;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'function') return '__FUNCTION__';
        if (typeof value === 'symbol') return String(value);
        if (Array.isArray(value)) return value.map((entry) => toCloneable(entry, seen));
        if (value instanceof Date) return value.toISOString();
        if (value && typeof value === 'object') {
          if (seen.has(value)) return '__CIRCULAR__';
          seen.add(value);
          const out = {};
          for (const [key, entry] of Object.entries(value)) {
            out[key] = toCloneable(entry, seen);
          }
          seen.delete(value);
          return out;
        }
        return String(value);
      };

      const normalize = (value) => {
        if (Array.isArray(value)) {
          return value.map((entry) => normalize(entry));
        }
        if (value && typeof value === 'object') {
          const entries = Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, normalize(entry)]);
          return Object.fromEntries(entries);
        }
        if (typeof value === 'number' && Number.isNaN(value)) return '__NaN__';
        if (typeof value === 'undefined') return '__UNDEFINED__';
        if (typeof value === 'function') return '__FUNCTION__';
        if (typeof value === 'bigint') return value.toString();
        return value;
      };

      const deepEqual = (left, right) => {
        try {
          return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
        } catch {
          return String(left) === String(right);
        }
      };

      self.onmessage = async (event) => {
        const code = String(event?.data?.code ?? '');
        const fnName = String(event?.data?.functionName ?? '');
        const tests = Array.isArray(event?.data?.tests) ? event.data.tests : [];
        try {
          const accessor = "typeof " + fnName + " === 'function' ? " + fnName + " : (typeof globalThis !== 'undefined' && typeof globalThis[fnName] === 'function' ? globalThis[fnName] : null)";
          const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
          const loadFn = new AsyncFunction('fnName', 'globalThis', code + "\\n; return (" + accessor + ");");
          const fn = await loadFn(fnName, globalThis);
          const results = [];
          if (typeof fn !== 'function') {
            const missingMessage = "Fonction '" + fnName + "' introuvable dans le code.";
            for (let index = 0; index < tests.length; index += 1) {
              const test = tests[index] || {};
              const expected = Object.prototype.hasOwnProperty.call(test, 'expected') ? test.expected : null;
              const name = typeof test.name === 'string' && test.name.trim() ? test.name.trim() : "Test " + (index + 1);
              results.push({
                name,
                passed: false,
                expected: toCloneable(expected),
                actual: null,
                error: missingMessage,
                durationMs: 0,
              });
            }
            postMessage({ kind: 'done', payload: results });
            return;
          }

          for (let index = 0; index < tests.length; index += 1) {
            const test = tests[index] || {};
            const args = Array.isArray(test.args) ? test.args : [];
            const expected = Object.prototype.hasOwnProperty.call(test, 'expected') ? test.expected : null;
            const name = typeof test.name === 'string' && test.name.trim() ? test.name.trim() : "Test " + (index + 1);
            const startedAt = performance.now();

            try {
              const actual = await fn(...args);
              const passed = deepEqual(actual, expected);
              results.push({
                name,
                passed,
                expected: toCloneable(expected),
                actual: toCloneable(actual),
                durationMs: Math.max(0, performance.now() - startedAt),
              });
            } catch (error) {
              const message = error && typeof error.message === 'string' && error.message.trim()
                ? String(error.message)
                : (error && error.stack ? String(error.stack) : String(error));
              results.push({
                name,
                passed: false,
                expected: toCloneable(expected),
                actual: null,
                error: message,
                durationMs: Math.max(0, performance.now() - startedAt),
              });
            }
          }

          postMessage({ kind: 'done', payload: results });
        } catch (error) {
          const message = error && typeof error.message === 'string' && error.message.trim()
            ? String(error.message)
            : (error && error.stack ? String(error.stack) : String(error));
          postMessage({ kind: 'fatal', payload: message });
        }
      };
    `;

    const blob = new Blob([workerSource], { type: 'application/javascript' });
    const objectUrl = URL.createObjectURL(blob);
    const worker = new Worker(objectUrl);

    try {
      const results = await new Promise<UnitTestResult[]>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          worker.terminate();
          reject(new Error('Timeout pendant l execution des tests JavaScript (12s).'));
        }, 12000);

        worker.onmessage = (event: MessageEvent<{ kind?: string; payload?: unknown }>) => {
          const kind = event.data?.kind;
          const payload = event.data?.payload;

          if (kind === 'done' && Array.isArray(payload)) {
            clearTimeout(timeout);
            worker.terminate();
            resolve(payload as UnitTestResult[]);
            return;
          }

          if (kind === 'fatal') {
            clearTimeout(timeout);
            worker.terminate();
            reject(new Error(typeof payload === 'string' ? payload : 'Erreur inconnue pendant les tests.'));
            return;
          }
        };

        worker.onerror = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(event.message || 'Erreur worker pendant les tests.'));
        };

        const transportTests = testCases.map((test, index) => ({
          name: typeof test?.name === 'string' && test.name.trim() ? test.name.trim() : `Test ${index + 1}`,
          args: Array.isArray(test?.args) ? test.args.map((entry) => toTransportSafeValue(entry)) : [],
          expected: toTransportSafeValue(test?.expected),
        }));

        worker.postMessage({
          code: source,
          functionName: functionNameInput,
          tests: transportTests,
        });
      });

      return results;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function runTypeScriptUnitTests(
    source: string,
    functionNameInput: string,
    testCases: ExerciseUnitTest[],
  ): Promise<UnitTestResult[]> {
    const tsCompiler = await ensureTypeScript();
    const transpiled = tsCompiler.transpileModule(source, {
      compilerOptions: {
        module: tsCompiler.ModuleKind.ES2020,
        target: tsCompiler.ScriptTarget.ES2020,
        strict: false,
        sourceMap: false,
      },
      reportDiagnostics: true,
    });

    for (const diagnostic of transpiled.diagnostics ?? []) {
      const message = tsCompiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (message.trim().length > 0) {
        writeTerminal('stderr', `TypeScript: ${message}`);
      }
    }

    const output = transpiled.outputText ?? '';
    if (!output.trim()) {
      throw new Error('TypeScript transpile, mais aucun JavaScript n a ete genere.');
    }

    return runJavaScriptUnitTests(output, functionNameInput, testCases);
  }

  async function runPythonUnitTests(
    source: string,
    functionNameInput: string,
    testCases: ExerciseUnitTest[],
  ): Promise<UnitTestResult[]> {
    const pyodide = await ensurePyodide();
    const globals = (pyodide as unknown as {
      globals?: {
        set?: (key: string, value: unknown) => void;
        delete?: (key: string) => void;
      };
    }).globals;

    if (!globals?.set || !globals?.delete) {
      throw new Error('Pyodide globals indisponible pour les tests unitaires.');
    }

    globals.set('__kotbo_source', source);
    globals.set('__kotbo_function_name', functionNameInput);
    globals.set('__kotbo_tests_json', JSON.stringify(testCases));

    try {
      const raw = await pyodide.runPythonAsync(`
import json
import time

source = __kotbo_source
function_name = __kotbo_function_name
tests = json.loads(__kotbo_tests_json)

namespace = {}
exec(source, namespace)
fn = namespace.get(function_name)
if not callable(fn):
    raise Exception(f"Fonction '{function_name}' introuvable dans le code.")

results = []
for index, test in enumerate(tests):
    name = test.get("name") or f"Test {index + 1}"
    args = test.get("args")
    expected = test.get("expected")
    if not isinstance(args, list):
        results.append({
            "name": name,
            "passed": False,
            "expected": expected,
            "actual": None,
            "error": "args doit etre un tableau",
            "durationMs": 0.0,
        })
        continue

    started_at = time.perf_counter()
    try:
        actual = fn(*args)
        passed = actual == expected
        results.append({
            "name": name,
            "passed": bool(passed),
            "expected": expected,
            "actual": actual,
            "durationMs": (time.perf_counter() - started_at) * 1000,
        })
    except Exception as error:
        results.append({
            "name": name,
            "passed": False,
            "expected": expected,
            "actual": None,
            "error": str(error),
            "durationMs": (time.perf_counter() - started_at) * 1000,
        })

json.dumps(results, ensure_ascii=False, default=str)
      `);

      const payload = typeof raw === 'string' ? raw : String(raw);
      const parsed = JSON.parse(payload);
      if (!Array.isArray(parsed)) {
        throw new Error('Resultat inattendu des tests Python.');
      }

      return parsed.map((entry, index) => ({
        name: typeof entry?.name === 'string' && entry.name.trim() ? entry.name.trim() : `Test ${index + 1}`,
        passed: Boolean(entry?.passed),
        expected: entry?.expected,
        actual: entry?.actual,
        error: typeof entry?.error === 'string' ? entry.error : undefined,
        durationMs: Number.isFinite(Number(entry?.durationMs)) ? Number(entry.durationMs) : 0,
      })) as UnitTestResult[];
    } finally {
      globals.delete('__kotbo_source');
      globals.delete('__kotbo_function_name');
      globals.delete('__kotbo_tests_json');
    }
  }

  async function runUnitTests(options?: { auto?: boolean }) {
    if (isRunning) {
      if (!options?.auto) {
        writeTerminal('info', 'Attends la fin de l execution en cours avant de lancer les tests.');
      }
      return;
    }

    const source = editor?.getValue() ?? code;
    code = source;
    unitTestError = '';

    const functionNameInput = normalizedFunctionName();
    if (!functionNameInput) {
      unitTestResults = [];
      unitTestError = 'Nom de fonction attendu manquant.';
      if (!options?.auto) {
        writeTerminal('error', 'Impossible de lancer les tests: nom de fonction attendu manquant.');
      }
      return;
    }

    const expectedArgCount = normalizedFunctionArgs().length;
    const testCases = normalizedUnitTests();
    if (testCases.length === 0) {
      unitTestResults = [];
      unitTestError = 'Aucun test unitaire configure pour cet exercice.';
      if (!options?.auto) {
        writeTerminal('info', 'Aucun test unitaire configure pour cet exercice.');
      }
      return;
    }

    const invalidArgsCountTest = testCases.find((test) => !Array.isArray(test.args) || test.args.length !== expectedArgCount);
    if (invalidArgsCountTest) {
      unitTestResults = [];
      unitTestError = `Tests invalides: chaque test doit fournir exactement ${expectedArgCount} argument(s).`;
      writeTerminal(
        'error',
        `Tests invalides: chaque test doit fournir exactement ${expectedArgCount} argument(s).`,
      );
      return;
    }

    if (!canRunAutomatedTests(language)) {
      unitTestResults = [];
      unitTestError = `Tests automatiques indisponibles pour ${language.toUpperCase()}.`;
      writeTerminal(
        'info',
        `Tests non pris en charge pour ${language.toUpperCase()}. Utilise JavaScript, TypeScript ou Python pour le run automatique.`,
      );
      return;
    }

    isRunningTests = true;
    unitTestError = '';
    writeTerminal('info', `Lancement des tests unitaires (${testCases.length}) sur ${language.toUpperCase()}...`);
    const startedAt = performance.now();

    try {
      let results: UnitTestResult[] = [];

      if (language === 'javascript') {
        results = await runJavaScriptUnitTests(source, functionNameInput, testCases);
      } else if (language === 'typescript') {
        results = await runTypeScriptUnitTests(source, functionNameInput, testCases);
      } else {
        results = await runPythonUnitTests(source, functionNameInput, testCases);
      }

      unitTestResults = results;
      let passed = 0;
      for (const result of results) {
        if (result.passed) passed += 1;
      }

      const total = results.length;
      const failed = Math.max(0, total - passed);
      const ratio = total > 0 ? passed / total : 0;
      const suggestedCorrectness = Math.round(ratio * 50) / 10;
      const elapsedMs = performance.now() - startedAt;

      lastUnitTestSummary = {
        total,
        passed,
        failed,
        suggestedCorrectness,
        language,
        durationMs: elapsedMs,
      };

      writeTerminal(
        failed === 0 ? 'result' : 'stderr',
        `Resultats tests: ${passed}/${total} passes (${failed} en echec).`,
      );
      writeTerminal(
        'info',
        `Suggestion note correctitude: ${suggestedCorrectness.toFixed(1)}/5.`,
      );
    } catch (error) {
      lastUnitTestSummary = null;
      unitTestResults = [];
      const message = error instanceof Error ? error.message : String(error);
      unitTestError = message;
      writeTerminal('error', message);
    } finally {
      const elapsedMs = performance.now() - startedAt;
      writeTerminal('info', `Temps total tests: ${formatExecutionDuration(elapsedMs)}`);
      isRunningTests = false;
    }
  }

  async function runCode() {
    if (isRunningTests) {
      writeTerminal('info', 'Attends la fin des tests unitaires avant de lancer une execution.');
      return;
    }

    const executionLanguage = language;
    const source = editor?.getValue() ?? code;
    code = source;

    if (!source.trim()) {
      writeTerminal('info', 'Aucun code a executer.');
      return;
    }

    isRunning = true;
    writeTerminal('info', `Execution ${executionLanguage.toUpperCase()}...`);
    const startedAt = performance.now();

    try {
      if (executionLanguage === 'javascript') {
        await runJavaScript(source);
      } else if (executionLanguage === 'typescript') {
        await runTypeScript(source);
      } else if (executionLanguage === 'python') {
        await runPython(source);
      } else if (executionLanguage === 'c') {
        await runC(source, stdin);
      } else if (executionLanguage === 'lua') {
        await runLua(source);
      } else {
        await runSQLite(source);
      }

      writeTerminal('info', 'Execution terminee.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeTerminal('error', message);
    } finally {
      const elapsedMs = performance.now() - startedAt;
      writeTerminal('info', `Temps d'execution: ${formatExecutionDuration(elapsedMs)}`);
      isRunning = false;
    }
  }

  function handlePopout() {
    dispatch('popout', {
      code: editor?.getValue() ?? code,
      language,
    });
  }

  function fitTerminal() {
    fitAddon?.fit();
  }

  onMount(() => {
    try {
      monaco.editor.defineTheme('kotbo-vscode', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '6A9955' },
          { token: 'keyword', foreground: 'C586C0' },
          { token: 'string', foreground: 'CE9178' },
          { token: 'number', foreground: 'B5CEA8' },
          { token: 'type.identifier', foreground: '4EC9B0' },
        ],
        colors: {
          'editor.background': '#1e1e1e',
          'editorGutter.background': '#1e1e1e',
          'editorLineNumber.foreground': '#858585',
          'editorLineNumber.activeForeground': '#c6c6c6',
          'editorCursor.foreground': '#d4d4d4',
          'editor.selectionBackground': '#264f78',
          'editor.inactiveSelectionBackground': '#3a3d41',
          'editor.lineHighlightBackground': '#2a2d2e',
        },
      });

      code = initialCode;
      const bootLanguage = readPersistedLanguage(normalizedLanguage(initialLanguage, initialCode));
      const allowedAtBoot = normalizedAllowedLanguages();
      language = allowedAtBoot.includes(bootLanguage) ? bootLanguage : allowedAtBoot[0];
      updateRuntimeHint(language);

      if (editorContainer) {
        editor = monaco.editor.create(editorContainer, {
          value: code,
          language: monacoLanguage(language),
          theme: 'kotbo-vscode',
          automaticLayout: true,
          minimap: { enabled: true, renderCharacters: false, maxColumn: 100 },
          fontFamily: "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
          fontLigatures: true,
          fontSize: 13,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          renderLineHighlight: 'line',
          roundedSelection: false,
          tabSize: 2,
          insertSpaces: true,
          guides: {
            indentation: true,
            bracketPairs: true,
          },
        });

        editorDisposables.push(
          editor.onDidChangeModelContent(() => {
            code = editor?.getValue() ?? '';
            updateEditorStats();
          }),
          editor.onDidChangeCursorPosition(() => {
            updateEditorStats();
          }),
        );

        updateEditorStats();
      }

      if (terminalContainer) {
        terminal = new Terminal({
          convertEol: true,
          cursorBlink: true,
          fontSize: 12,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
          theme: {
            background: '#181818',
            foreground: '#d4d4d4',
            cursor: '#d4d4d4',
            selectionBackground: '#264f78',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#ffffff',
          },
          scrollback: 3000,
        });

        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(terminalContainer);

        fitTerminal();

        const onWindowResize = () => fitTerminal();
        window.addEventListener('resize', onWindowResize);
        removeWindowResizeListener = () => window.removeEventListener('resize', onWindowResize);

        if (typeof ResizeObserver !== 'undefined') {
          terminalResizeObserver = new ResizeObserver(() => fitTerminal());
          terminalResizeObserver.observe(terminalContainer);
        }

        resetTerminal();
      }

      onLanguageChange(language, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bootError = `Impossible d'initialiser Monaco/xterm: ${message}`;
    }
  });

  $effect(() => {
    const available = normalizedAllowedLanguages();
    if (!available.includes(language)) {
      onLanguageChange(available[0], false);
    }
  });

  $effect(() => {
    if (hasAutoRunUnitTests) return;
    if (!editor) return;
    if (isRunning || isRunningTests) return;
    if (!hasConfiguredUnitTests()) return;
    if (!normalizedFunctionName()) return;
    if (!canRunAutomatedTests(language)) return;

    hasAutoRunUnitTests = true;
    void runUnitTests({ auto: true });
  });

  onDestroy(() => {
    for (const disposable of editorDisposables) {
      disposable.dispose();
    }
    editorDisposables = [];

    removeWindowResizeListener?.();
    removeWindowResizeListener = null;

    terminalResizeObserver?.disconnect();
    terminalResizeObserver = null;

    editor?.dispose();
    terminal?.dispose();
    fitAddon?.dispose();

    editor = null;
    terminal = null;
    fitAddon = null;
  });
</script>

<div class="ide-root" style={`height: ${heightValueToCss(height)};`}>
  <div class="ide-titlebar">
    <div class="titlebar-left">
      <p class="titlebar-path">daily-algo / {fileLabel}.{extensionForLanguage(language)}</p>
    </div>

    <div class="titlebar-actions">
      <label for="daily-ide-language" class="ide-label">Langage</label>
      <select
        id="daily-ide-language"
        class="ide-select"
        bind:value={language}
        onchange={(event) => onLanguageChange((event.currentTarget as HTMLSelectElement).value as IdeLanguage)}
      >
        {#each normalizedAllowedLanguages() as languageOption}
          <option value={languageOption}>{languageDisplayName(languageOption)}</option>
        {/each}
      </select>

      <button type="button" class="ide-btn ghost" onclick={clearTerminal}>Clear</button>
      <button type="button" class="ide-btn ghost" onclick={() => runUnitTests()} disabled={isRunning || isRunningTests || !hasConfiguredUnitTests() || !normalizedFunctionName() || !canRunAutomatedTests(language)}>
        {isRunningTests ? 'Tests...' : 'Run tests'}
      </button>
      <button type="button" class="ide-btn run" onclick={() => runCode()} disabled={isRunning || isRunningTests}>
        {isRunning ? 'Execution...' : 'Run'}
      </button>

      {#if showPopoutButton}
        <button type="button" class="ide-btn ghost" onclick={handlePopout}>{popoutLabel}</button>
      {/if}
    </div>
  </div>

  {#if bootError}
    <div class="ide-banner error">{bootError}</div>
  {:else if runtimeHint}
    <div class="ide-banner hint">{runtimeHint}</div>
  {/if}

  <div class="ide-shell">
    <aside class="sidebar">
      <div class="sidebar-head">Explorer</div>
      <div class="tree-root">
        <p class="tree-folder">DAILY-ALGO</p>
        <p class="tree-file active">{fileLabel}.{extensionForLanguage(language)}</p>
        <p class="tree-meta">Langage: {language.toUpperCase()}</p>
        <p class="tree-meta">Lignes: {lineCount}</p>
        <p class="tree-meta">Runtime: {runtimeLabel(language)}</p>
        <p class="tree-meta">Signature: {testFunctionSignature()}</p>
        <p class="tree-meta">Tests: {normalizedUnitTests().length}</p>
        <p class="tree-meta">{testSupportLabel(language)}</p>
        <p class="tree-meta">Terminal: {terminalLineCount} lignes</p>
        {#if lastUnitTestSummary}
          <p class="tree-meta">Dernier run: {lastUnitTestSummary.passed}/{lastUnitTestSummary.total}</p>
          <p class="tree-meta">Note suggeree: {lastUnitTestSummary.suggestedCorrectness.toFixed(1)}/5</p>
        {/if}
      </div>

      <div class="tests-zone">
        <div class="tests-zone-head">
          <p class="tests-zone-title">Tests unitaires</p>
          <button
            type="button"
            class="tests-zone-run"
            onclick={() => runUnitTests()}
            disabled={isRunning || isRunningTests || !hasConfiguredUnitTests() || !normalizedFunctionName() || !canRunAutomatedTests(language)}
          >
            {isRunningTests ? 'Running...' : 'Run'}
          </button>
        </div>

        {#if !hasConfiguredUnitTests()}
          <p class="tests-zone-empty">Aucun test configure.</p>
        {:else if !normalizedFunctionName()}
          <p class="tests-zone-empty">Nom de fonction manquant.</p>
        {:else if !canRunAutomatedTests(language)}
          <p class="tests-zone-empty">Tests auto non disponibles sur {language.toUpperCase()}.</p>
        {:else if isRunningTests}
          <p class="tests-zone-empty">Execution des tests...</p>
        {:else if unitTestError}
          <div class="tests-zone-error">{unitTestError}</div>
        {:else if lastUnitTestSummary && unitTestResults.length > 0}
          <div class="tests-zone-score {lastUnitTestSummary.failed === 0 ? 'ok' : 'ko'}">
            <p class="tests-zone-score-main">
              {lastUnitTestSummary.passed}/{lastUnitTestSummary.total} reussis
            </p>
            <p class="tests-zone-score-sub">
              Score suggere: {lastUnitTestSummary.suggestedCorrectness.toFixed(1)}/5
            </p>
          </div>

          <div class="tests-zone-list">
            {#each unitTestResults as result}
              <article class="test-result-card {result.passed ? 'pass' : 'fail'}">
                <div class="test-result-head">
                  <span class="test-result-badge">{result.passed ? 'PASS' : 'FAIL'}</span>
                  <span class="test-result-name">{result.name}</span>
                  <span class="test-result-time">{formatExecutionDuration(result.durationMs)}</span>
                </div>

                {#if result.error}
                  <p class="test-result-error">{result.error}</p>
                {:else}
                  <div class="test-result-values">
                    <p class="test-result-label">Attendu</p>
                    <pre class="test-result-code">{stringifyChunk(result.expected)}</pre>
                    <p class="test-result-label">Obtenu</p>
                    <pre class="test-result-code">{stringifyChunk(result.actual)}</pre>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {:else}
          <p class="tests-zone-empty">Lance les tests pour voir attendu/obtenu.</p>
        {/if}
      </div>

      {#if language === 'c'}
        <div class="stdin-zone">
          <label for="daily-ide-stdin" class="ide-label">STDIN (optionnel)</label>
          <textarea
            id="daily-ide-stdin"
            rows="4"
            bind:value={stdin}
            placeholder="Entree standard pour scanf / cin"
            class="stdin-input"
          ></textarea>
        </div>
      {/if}
    </aside>

    <section class="workbench">
      <div class="editor-tabs">
        <div class="editor-tab active">{fileLabel}.{extensionForLanguage(language)}</div>
      </div>

      <div class="editor-stage">
        <div bind:this={editorContainer} class="monaco-host"></div>
      </div>

      <div class="panel-stage">
        <div class="panel-head">
          <div class="panel-tabs">
            <span class="panel-tab active">Terminal</span>
          </div>
          <button type="button" class="panel-clear" onclick={clearTerminal}>Clear</button>
        </div>
        <div bind:this={terminalContainer} class="terminal-host"></div>
      </div>

      <footer class="statusbar">
        <span>{language.toUpperCase()}</span>
        <span>Ln {cursorLine}, Col {cursorColumn}</span>
        <span>{lineCount} lignes</span>
      </footer>
    </section>
  </div>
</div>

<style>
  .ide-root {
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, var(--outline-variant, #343434) 80%, #000 20%);
    border-radius: 0.9rem;
    overflow: hidden;
    background: #1e1e1e;
    color: #d4d4d4;
    min-height: 420px;
  }

  .ide-titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.5rem 0.65rem;
    border-bottom: 1px solid #2d2d30;
    background: #3c3c3c;
  }

  .titlebar-left {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  .titlebar-path {
    margin: 0;
    font-size: 11px;
    color: #d4d4d4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: min(40vw, 360px);
    font-weight: 700;
  }

  .titlebar-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .ide-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #9ca3af;
  }

  .ide-select {
    border: 1px solid #4f4f52;
    border-radius: 0.4rem;
    background: #1f1f1f;
    color: #d4d4d4;
    padding: 0.32rem 0.46rem;
    font-size: 11px;
    font-weight: 700;
  }

  .ide-btn {
    border-radius: 0.4rem;
    padding: 0.35rem 0.6rem;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.11em;
    border: 1px solid transparent;
    cursor: pointer;
  }

  .ide-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .ide-btn.run {
    background: #0e639c;
    color: #ffffff;
    border-color: #1177bb;
  }

  .ide-btn.ghost {
    background: #2d2d2d;
    color: #d4d4d4;
    border-color: #454545;
  }

  .ide-banner {
    padding: 0.35rem 0.65rem;
    border-bottom: 1px solid #2d2d30;
    font-size: 11px;
    font-weight: 700;
  }

  .ide-banner.hint {
    background: #202737;
    color: #9cdcfe;
  }

  .ide-banner.error {
    background: rgba(127, 29, 29, 0.45);
    color: #fecdd3;
  }

  .ide-shell {
    min-height: 0;
    flex: 1;
    display: grid;
    grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
    background: #1e1e1e;
  }

  .sidebar {
    border-right: 1px solid #2d2d30;
    background: #252526;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
  }

  .sidebar-head {
    border-bottom: 1px solid #2d2d30;
    padding: 0.55rem 0.65rem;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: #9ca3af;
  }

  .tree-root {
    padding: 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.38rem;
  }

  .tree-folder,
  .tree-file,
  .tree-meta {
    margin: 0;
    font-size: 11px;
  }

  .tree-folder {
    color: #c8c8c8;
    font-weight: 600;
    letter-spacing: 0.08em;
  }

  .tree-file {
    color: #d4d4d4;
    font-weight: 700;
    padding: 0.3rem 0.45rem;
    border-radius: 0.45rem;
    border: 1px solid #3a3a3f;
    background: #1e1e1e;
  }

  .tree-file.active {
    border-color: #0e639c;
    background: color-mix(in srgb, #0e639c 18%, transparent);
  }

  .tree-meta {
    color: #9ca3af;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }

  .tests-zone {
    margin: 0.1rem 0.65rem 0.65rem;
    border: 1px solid #35363b;
    border-radius: 0.65rem;
    background: #1f2024;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .tests-zone-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.52rem 0.58rem;
    border-bottom: 1px solid #2e3036;
    background: #27292f;
  }

  .tests-zone-title {
    margin: 0;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #aeb5c2;
  }

  .tests-zone-run {
    border: 1px solid #3f6aa0;
    background: #0e639c;
    color: #ffffff;
    border-radius: 0.35rem;
    padding: 0.2rem 0.46rem;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    cursor: pointer;
  }

  .tests-zone-run:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tests-zone-empty {
    margin: 0;
    padding: 0.62rem 0.58rem;
    font-size: 11px;
    color: #9aa0ac;
    font-weight: 700;
  }

  .tests-zone-error {
    margin: 0.55rem;
    border: 1px solid #7f1d1d;
    background: rgba(127, 29, 29, 0.32);
    color: #fecdd3;
    border-radius: 0.5rem;
    padding: 0.52rem;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .tests-zone-score {
    margin: 0.55rem 0.55rem 0.45rem;
    border: 1px solid #3a3f49;
    border-radius: 0.5rem;
    padding: 0.48rem 0.52rem;
  }

  .tests-zone-score.ok {
    border-color: rgba(16, 185, 129, 0.45);
    background: rgba(16, 185, 129, 0.12);
  }

  .tests-zone-score.ko {
    border-color: rgba(239, 68, 68, 0.45);
    background: rgba(239, 68, 68, 0.1);
  }

  .tests-zone-score-main {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: #dbe2ef;
  }

  .tests-zone-score-sub {
    margin: 0.2rem 0 0;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #aeb5c2;
    font-weight: 600;
  }

  .tests-zone-list {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0 0.55rem 0.55rem;
    overflow: auto;
    max-height: 34vh;
  }

  .test-result-card {
    border: 1px solid #3a3e47;
    border-radius: 0.5rem;
    background: #24262d;
    padding: 0.45rem 0.5rem;
  }

  .test-result-card.pass {
    border-color: rgba(16, 185, 129, 0.4);
    background: rgba(16, 185, 129, 0.08);
  }

  .test-result-card.fail {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.08);
  }

  .test-result-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .test-result-badge {
    font-size: 9px;
    letter-spacing: 0.08em;
    font-weight: 600;
    text-transform: uppercase;
    border: 1px solid #3d4350;
    border-radius: 999px;
    padding: 0.08rem 0.33rem;
    background: #1f2025;
    color: #dce2ee;
  }

  .test-result-name {
    font-size: 11px;
    font-weight: 600;
    color: #dce2ee;
  }

  .test-result-time {
    margin-left: auto;
    font-size: 10px;
    color: #9aa0ac;
    font-weight: 700;
  }

  .test-result-error {
    margin: 0.35rem 0 0;
    color: #fecdd3;
    font-size: 10px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .test-result-values {
    margin-top: 0.36rem;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.18rem;
  }

  .test-result-label {
    margin: 0;
    font-size: 9px;
    color: #9aa0ac;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }

  .test-result-code {
    margin: 0;
    border: 1px solid #3c4049;
    border-radius: 0.42rem;
    background: #1b1d23;
    color: #e5e7eb;
    font-size: 10px;
    line-height: 1.4;
    padding: 0.28rem 0.34rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 7.5rem;
    overflow: auto;
    font-family: 'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
  }

  .stdin-zone {
    padding: 0.7rem;
    border-top: 1px solid #2d2d30;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .stdin-input {
    border: 1px solid #454545;
    border-radius: 0.55rem;
    background: #1f1f1f;
    color: #d4d4d4;
    padding: 0.5rem 0.65rem;
    font-size: 12px;
    line-height: 1.5;
    font-family: 'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
    resize: vertical;
  }

  .workbench {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) minmax(170px, 30%) auto;
    background: #1e1e1e;
  }

  .editor-tabs {
    border-bottom: 1px solid #2d2d30;
    background: #2d2d2d;
    padding: 0.28rem 0.35rem 0;
    display: flex;
    align-items: flex-end;
    gap: 0.3rem;
  }

  .editor-tab {
    border: 1px solid #3d3d40;
    border-bottom-color: #2d2d30;
    border-radius: 0.5rem 0.5rem 0 0;
    background: #252526;
    color: #b4b4b4;
    padding: 0.32rem 0.6rem;
    font-size: 11px;
    font-weight: 700;
  }

  .editor-tab.active {
    background: #1e1e1e;
    color: #ffffff;
    border-bottom-color: #1e1e1e;
  }

  .editor-stage {
    min-height: 0;
    border-bottom: 1px solid #2d2d30;
  }

  .monaco-host {
    width: 100%;
    height: 100%;
  }

  .panel-stage {
    min-height: 0;
    background: #181818;
    display: flex;
    flex-direction: column;
  }

  .panel-head {
    border-bottom: 1px solid #2d2d30;
    background: #252526;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
    padding: 0.33rem 0.48rem;
  }

  .panel-tabs {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .panel-tab {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: #9ca3af;
    padding: 0.24rem 0.42rem;
    border-radius: 0.35rem;
  }

  .panel-tab.active {
    background: #1e1e1e;
    color: #ffffff;
  }

  .panel-clear {
    border: 1px solid #454545;
    background: #2d2d2d;
    color: #d4d4d4;
    border-radius: 0.35rem;
    padding: 0.2rem 0.4rem;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    font-weight: 600;
  }

  .terminal-host {
    flex: 1;
    min-height: 0;
    padding: 0.28rem;
  }

  .terminal-host :global(.xterm-viewport) {
    scrollbar-width: thin;
  }

  .statusbar {
    border-top: 1px solid #1177bb;
    background: #0e639c;
    color: #ffffff;
    padding: 0.22rem 0.5rem;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.6rem;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  @media (max-width: 1100px) {
    .ide-shell {
      grid-template-columns: minmax(160px, 210px) minmax(0, 1fr);
    }
  }

  @media (max-width: 920px) {
    .ide-root {
      min-height: 380px;
    }

    .ide-titlebar {
      padding: 0.45rem 0.5rem;
    }

    .titlebar-path {
      max-width: 38vw;
      font-size: 10px;
    }

    .ide-shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto;
      position: relative;
    }

    .sidebar {
      border-right: none;
      border-bottom: 1px solid #2d2d30;
      max-height: 34vh;
    }

    .workbench {
      grid-template-rows: auto minmax(260px, 1fr) minmax(140px, 34%) auto;
    }

    .statusbar {
      justify-content: space-between;
      gap: 0.35rem;
      padding: 0.24rem 0.35rem;
      font-size: 9px;
    }
  }
</style>
