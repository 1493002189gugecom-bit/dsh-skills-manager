// Load the built client bundle exactly the way the GUI's __ModuleLoader__ does,
// then assert the plugin contract. This is the check the JS test suite cannot
// make: every spec imports src/ directly and never touches the packaged bundle.
//
// It caught a real defect: a wrapper without `return module.exports` builds
// green, then fails to mount in the GUI and takes the shell down with it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const file = process.argv[2] ?? join(process.cwd(), 'lib', 'client.js')
const source = readFileSync(file, 'utf8')

// --- minimal DOM/browser surface the bundle touches at module scope ----------
const injectedStyles = []
const head = { appendChild: (tag) => injectedStyles.push(tag) }
const fakeDocument = {
  documentElement: { lang: 'zh' },
  head,
  body: { appendChild: () => {} },
  createElement: () => ({ dataset: {}, textContent: '', appendChild: () => {} }),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
}
const registered = []
const fakeWindow = {
  __ModuleLoader__: { load: (registration) => registered.push(registration) },
  confirm: () => false,
  addEventListener: () => {},
  removeEventListener: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { href: 'http://127.0.0.1:43120/' },
}
Object.assign(globalThis, { document: fakeDocument, window: fakeWindow })
// Node 24 exposes `navigator` as a getter-only global whose own properties are
// also accessors, so define the one field the bundle reads instead of assigning.
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'zh-CN', userAgent: 'node' },
    configurable: true,
    writable: true,
  })
} catch {
  /* an environment that forbids redefining navigator: the bundle falls back */
}

// Run the bundle: it calls window.__ModuleLoader__.load({ id, factory }).
new Function(source)()

const problems = []
if (registered.length !== 1) problems.push(`expected exactly one ModuleLoader registration, got ${registered.length}`)
const registration = registered[0] ?? {}
if (typeof registration.id !== 'string' || registration.id === '') problems.push('registration has no id')
if (typeof registration.factory !== 'function') problems.push('registration has no factory function')

// Every module the bundle asks for must be one the shell provides; requiring
// anything else (a dependency that was not bundled, or not externalised) would
// throw at mount time in the GUI.
const provided = new Map([
  ['react', {}],
  ['react-dom', {}],
  ['react-dom/client', {}],
  ['react/jsx-runtime', {}],
])
const requested = []
let plugin
if (typeof registration.factory === 'function') {
  plugin = registration.factory((name) => {
    requested.push(name)
    if (!provided.has(name)) throw new Error(`bundle required an unexpected module: ${name}`)
    return provided.get(name)
  })
}

if (plugin === null || typeof plugin !== 'object') {
  problems.push(`factory returned ${plugin === null ? 'null' : typeof plugin}, not a module object`)
} else {
  if (typeof plugin.apply !== 'function') problems.push(`exported apply is ${typeof plugin.apply}, expected a function`)
  if (!Array.isArray(plugin.inject)) problems.push(`exported inject is ${JSON.stringify(plugin.inject)}, expected an array`)
}

console.log(`registration id:         ${JSON.stringify(registration.id)}`)
console.log(`externals requested:     ${requested.length > 0 ? [...new Set(requested)].join(', ') : '(none at load time)'}`)
console.log(`apply:                   ${typeof plugin?.apply}`)
console.log(`inject:                  ${JSON.stringify(plugin?.inject)}`)
console.log(`styles injected on load: ${injectedStyles.length}`)

if (problems.length > 0) {
  console.error(`\nFAILED:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('\nOK: the client bundle satisfies the ModuleLoader plugin contract')
