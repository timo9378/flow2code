# Flow2Code — VSCode Extension

> Right-click to convert between **TypeScript** and **Flow IR**, preview flow graphs, and auto-validate — all inside VS Code.

## Features

### 🔄 Decompile TypeScript → Flow IR

Right-click any `.ts` / `.js` file (or selected code) and choose **"Flow2Code: Decompile to Flow IR"**.

- Entire file or selection-only supported
- Generates `.flow.json` side-by-side
- Shows confidence score on completion

### ⚙️ Compile Flow IR → TypeScript

Right-click any `.flow.json` file and choose **"Flow2Code: Compile to TypeScript"**.

- Validates IR before compiling
- Configurable target platform (Next.js / Express / Cloudflare Workers)
- Reports missing npm dependencies

### 📊 Preview Flow Graph

Right-click a `.flow.json` file → **"Flow2Code: Preview Flow Graph"**.

- SVG-based DAG visualization with category colors
- Pan, zoom, fit-to-view controls
- Hover tooltips with node IDs
- Auto-refreshes when file changes on disk

### ✅ Auto-Validation

- Inline diagnostics appear when you open or save a `.flow.json` file
- Errors are positioned at the offending node/edge in the JSON
- Configurable: disable via `flow2code.autoValidate`

### 📝 Visual Editor (Open With…)

Right-click a `.flow.json` → **Open With… > Flow2Code Visual Editor** for a read-only graphical view alongside the JSON source.

### 🔢 Status Bar

When a `.flow.json` is active, the status bar shows:

```
$(graph) MyFlow (5N·4E)
```

Click it to open the flow preview.

---

## Commands

| Command | Context | Description |
|---|---|---|
| `Flow2Code: Decompile to Flow IR` | Editor / Explorer on `.ts`/`.js` | Convert TypeScript to Flow IR |
| `Flow2Code: Decompile Selection to Flow IR` | Editor with selection | Convert selected code to Flow IR |
| `Flow2Code: Compile to TypeScript` | Editor / Explorer on `.flow.json` | Compile Flow IR to TypeScript |
| `Flow2Code: Validate Flow IR` | Editor on `.flow.json` | Run validation and show diagnostics |
| `Flow2Code: Preview Flow Graph` | Editor / Explorer on `.flow.json` | Open DAG preview panel |

## Settings

| Setting | Default | Description |
|---|---|---|
| `flow2code.platform` | `nextjs` | Target platform: `nextjs`, `express`, `cloudflare` |
| `flow2code.autoValidate` | `true` | Validate `.flow.json` on open/save |
| `flow2code.compileOnSave` | `false` | Auto-compile `.flow.json` to TypeScript on save |

## Development

```bash
cd vscode-extension
pnpm install
pnpm run build        # one-shot build
pnpm run watch        # rebuild on change
```

Press **F5** in VS Code to launch the Extension Development Host.

## Architecture

```
vscode-extension/
├── package.json              # Extension manifest (commands, menus, config)
├── esbuild.mjs               # Build script with @/ alias resolution
├── tsconfig.json              # TypeScript config for IDE support
├── src/
│   ├── extension.ts           # Entry point — registers all providers
│   ├── commands.ts            # 5 command implementations
│   ├── diagnostics.ts         # Auto-validation on open/save
│   ├── status-bar.ts          # Flow info in status bar
│   ├── flow-editor-provider.ts# Custom editor (read-only visual)
│   └── webview/
│       └── preview-html.ts    # SVG DAG renderer for preview panel
```

The extension bundles the flow2code compiler, decompiler, and validator via esbuild. The `@/` path alias resolves to the main project's `src/` directory, so the extension always uses the latest source.

`ts-morph` is kept as an external dependency (not bundled) because it loads TypeScript lib files from disk at runtime.

## License

MIT — see [LICENSE](../LICENSE)
