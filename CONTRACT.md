# dsh-sticky-board — build contract (read this before writing any file)

A DSH **client** plugin ("便签/Sticky notes") for the Harness Web UI: quick capture of
conversation content (selection → note), a floating notes panel with sections, drag &
drop, trash, rich content (tables/images/code), and pushing a note back into a chat
composer or into a picture-in-picture always-on-top window.

The plugin is authored as **one single plain-JavaScript browser bundle**:
`window.__ModuleLoader__.load({ id: 'dsh-sticky-board', factory(require) { ... } })`.
`src/*.js` are fragments of that one factory body, concatenated in this order:

```
00-head.js 10-core.js 15-i18n.js 20-model.js 30-content.js 40-styles.js
45-panel.js 50-board.js 60-capture.js 70-pip.js 80-sidebar.js 90-apply.js 95-tail.js
```

Build: `node build.mjs` (run from `D:\Desktop\dsh-sticky-board`). It writes `client.js`.
`00-head.js`/`95-tail.js`/`10-core.js`/`15-i18n.js`/`20-model.js`/`90-apply.js`/`build.mjs`
are **already written and must not be edited**. Your job is only the fragments assigned
to you; other fragments are written concurrently by other people.

## Hard rules

1. **No JSX, no `import`/`export`, no `require()`** (React is already in the factory scope),
   no TypeScript, no template-literal JSX. Plain ES5-flavoured JS with `var`/`function`.
   Optional chaining and `const`/`let` are allowed, but prefer `var` and guard
   (`state && state.notes`) so a null never throws in the render path.
2. Every fragment must be **independently** parseable: run `node --check src/<file>.js`
   after writing it. (Fragments are not modules, so a stray `export` fails here — that is
   intentional.)
3. **Never edit files outside your scope.** If you need a shared string key, a shared
   helper, or a change to another fragment, put the need in your final report instead.
4. All React access goes through `DSN.React` / `DSN.h` / `DSN.ReactDOM`
   (`DSN.h(type, props, ...children)`, `DSN.React.useState` etc., `DSN.ReactDOM.createRoot`).
5. **No user-visible string literals.** Every label comes from `t('key')`
   (`t` arrives as a component prop; fall back to `DSN.fallbackT`). Missing keys go through
   `DSN.addStrings({ 'zh...': '中文' }, { 'zh...': 'English' })` at the top of your file —
   that helper merges into `DSN.dicts` and runs before `apply()` registers them. Use a unique
   `yourarea.` prefix for new keys.
6. **No colours except theme tokens**: `var(--dsw-alias-..., <literal fallback>)`. Use the
   fallback form everywhere (the PiP window has no host CSS variables).
7. Every DOM listener/observer you install must return a disposer; everything installed at
   `apply()` time must be undone when the plugin unloads.
8. Do not touch `window.localStorage` directly — the store in `20-model.js` owns it.
9. Keep CSS class names prefixed `dsn-`; register CSS with `DSN.addCss('area', cssString)`.

## Foundation API (already available, do not re-implement)

```
DSN.React, DSN.h, DSN.ReactDOM, DSN.VERSION
DSN.NS = 'dshNotes'
DSN.log(...args)                    debug logging (no-op unless DSN.debug)
DSN.uid(prefix)                     unique id string
DSN.clamp(v, min, max)
DSN.escapeHtml(v)
DSN.debounce(fn, ms) / DSN.throttle(fn, ms)
DSN.on(target, type, handler, options) -> disposer
DSN.isEditable(node)                input/textarea/select/contenteditable guard
DSN.closest(node, selector) -> Element|null
DSN.bus.emit(event) / DSN.bus.subscribe(fn) -> disposer     events: {type:'toast',text,kind}
DSN.toast(text, kind)               kind: 'info' | 'error'
DSN.injectStyle(doc, cssText) -> disposer    idempotent per document
DSN.ICONS[name]                     SVG path arrays (note, plus, close, search, copy, trash,
                                    pin, insert, edit, check, pip, grip, chevron, more,
                                    folder, sections, restore, image, table, collapse,
                                    expand, float)
DSN.Icon({name, size, thick, className}) -> svg element
DSN.copyRich(html, text) -> Promise<boolean>      writes text/html + text/plain
DSN.copyText(text) -> Promise<boolean>
DSN.formatAge(timestamp, t) -> localized "3 分钟前"
DSN.headline(text, limit) -> single-line summary
DSN.addStrings(zhDict, enDict)
DSN.fallbackT(key, params)
```

### Store (`20-model.js`)

```js
var store = DSN.createStore({ t })            // one instance per plugin, created in 90-apply
store.getSnapshot() -> state                  // stable reference until a mutation happens
store.subscribe(fn) -> unsubscribe            // call fn(state) after every mutation
store.actions.<name>(...)                     // mutations, see below
store.flush()                                 // force persistence (pagehide)
```

State document:

```js
{
  version: 1,
  sections: [{ id, name, order }],            // at least one, first is the fallback
  notes: [{
    id, sectionId, html, text, title, kind,   // kind: 'text'|'table'|'image'|'code'|'mixed'|'link'
    source: { sessionId, sessionTitle } | null,
    createdAt, updatedAt, pinned, deletedAt,
  }],
  ui: { open, collapsed, panel: {x,y,w,h}|null, activeSectionId, view: 'board'|'trash', search }
}
```

Actions (all synchronous, all persist, all notify subscribers):

```
setOpen(open) toggleOpen() setCollapsed(bool) setPanelRect({x,y,w,h}|null)
setActiveSection(id) setView('board'|'trash') setSearch(query)
addNote({html?,text?,title?,kind?,sectionId?,source?,pinned?}) -> noteId
updateNote(id, patch) deleteNote(id) restoreNote(id) purgeNote(id) emptyTrash()
setPinned(id, bool) togglePin(id)
moveNote(noteId, sectionId, beforeNoteId|null)
addSection(name) -> id  renameSection(id, name)  deleteSection(id)
importState(raw) replaceState(raw)
```

React binding: `useSyncExternalStore(store.subscribe, store.getSnapshot)`
(`DSN.React.useSyncExternalStore`). Never copy state into `useState`.

## Fragment contract (who provides what)

### `src/30-content.js` — rich content: sanitize, render, edit, drag payload  → `DSN.Content`
Exports (used by the board and the composer):

```
DSN.htmlToText(html) -> string                  plain text, block elements -> newlines
DSN.detectKind(html, text) -> 'text'|'table'|'image'|'code'|'mixed'|'link'
DSN.sanitizeHtml(html) -> string                allowlist sanitizer (no scripts, no
                                                on* handlers, javascript: URLs stripped,
                                                keeps table/thead/tbody/tr/td/th/code/pre/
                                                img/src(https,data:image/*)/a[href]/ul/ol/li/
                                                strong/em/b/i/code/br/p/h1..h6/hr/blockquote/
                                                font? no; keeps style only for allowlisted
                                                properties)
DSN.textToHtml(text) -> string
DSN.Content({ html, kind, className })          React component: renders sanitized content;
                                                tables scroll horizontally, images max-width,
                                                code blocks preserved, links open externally
DSN.Editor({ value, onChange, onSubmit, placeholder, autoFocus, minHeight, t })
                                                contentEditable rich editor. Emits HTML through
                                                onChange(html) on input; onSubmit() on
                                                Ctrl/Cmd+Enter; paste keeps rich HTML and
                                                images => re-encode pasted <img> data URLs as-is;
                                                never wrap text in <b> automatically. Applies
                                                DSN.sanitizeHtml on paste.
DSN.dragHasContent(dataTransfer) -> boolean     true when the drag carries text/html,
                                                text/plain or files
DSN.readDragContent(dataTransfer) -> Promise<{ html, text, files: File[] }>
                                                Files are converted to data URLs for images;
                                                non-image files contribute their names only.
```

Sanitizer must run on **every** path that injects HTML into the DOM
(`dangerouslySetInnerHTML`). Sanitize content pasted from chat, dropped content, and content
restored from `localStorage` (the board may assume `DSN.sanitizeHtml` is cheap enough to run
at render time via a `useMemo`).

### `src/40-styles.js` — CSS infrastructure + base styles  → `DSN.cssText`
Exports:

```
DSN.addCss(name, cssText)                       appends a named chunk (idempotent per name)
DSN.cssText() -> string                         all chunks joined
DSN.TOKENS                                       ['--dsw-alias-bg-overlay', ...] the token
                                                names copied into the PiP document
DSN.CSS.base                                    base chunk: reset inside .dsn-root, type ramp,
                                                buttons, icon buttons, inputs, scrollbars,
                                                focus rings, panel shell + header + resize
                                                handle, toast, tooltip, chip
```

Invariant: the CSS string must style `:root`-independent `dsn-` classes only, and every
colour/size token needs a literal fallback, e.g.
`color: var(--dsw-alias-label-primary, #1b1b1f)`.
Support `[data-theme="dark"]` inherited (tokens handle it; do not hardcode dark variants).
Panel z-index: use `2147483000` for the overlay panel, `2147483001` for the selection chip,
`2147483002` for toasts — the overlay slot is already above app content.

### `src/45-panel.js` — the floating window chrome  → `DSN.Panel`, `DSN.ToastHost`
Exports:

```
DSN.Panel({ store, t, ctx, embedded })          the whole floating window.
    embedded === true renders chrome-less, filling its container (used by the PiP window).
    - header: note icon + t('panel.title') + note count badge; drag handle on the header
      (pointer events, not HTML5 drag); buttons: PiP (hidden when unsupported and when
      embedded), collapse toggle, close; double-click header toggles collapse.
    - draggable + resizable (bottom-right handle), rect persisted with store.actions.setPanelRect;
      default rect: right side of viewport, width 400, height min(620, innerHeight-120),
      respecting an 8px viewport margin.
    - collapsed: header strip only (height ~44px).
    - body: renders DSN.NotesApp({ store, t, bridge, ctx }).
    - Escape closes; the panel keeps its React tree mounted while closed only if open === true;
      when store.ui.open is false render null.
    - when a PiP window is open, show a hint instead of a second live board? No: both render,
      the store keeps them in sync.
DSN.ToastHost({ t })                            reads DSN.bus 'toast' events, renders up to 3
                                                stacked toasts bottom-centre of the panel with
                                                auto-dismiss 2.6s; also usable standalone in PiP.
DSN.useStore(store) -> state                    thin useSyncExternalStore wrapper helper
```

`DSN.Panel` is registered into the `shell.overlay` slot by `90-apply.js`; it receives no
session owner props, so `bridge` comes from `DSN.bridge.get()` (see 60-capture).

### `src/50-board.js` — panel body: tabs, sections, composer, list, trash, search → `DSN.NotesApp`
Exports:

```
DSN.NotesApp({ store, t, bridge, ctx })         full body, in this vertical order:
   1. toolbar row: view tabs "全部"(t('tab.all')) / "回收站"(t('tab.trash')) with counts,
      search input (t('search.placeholder')), section add button.
   2. section rail: horizontal chips for state.sections (active = ui.activeSectionId), plus
      "+" chip; each chip is a drop target that moves a dragged note into that section;
      context menu (or trailing "…" button) with rename/delete.
   3. composer: DSN.Editor + save button (t('composer.save')), placeholder
      t('composer.placeholder'); Ctrl+Enter saves; inserted notes are prepended to the active
      section; paste of images/tables allowed; drop target for external content;
      "drag a note here" hint is not needed but dropping a dragged note onto the composer is a
      no-op (it must not swallow the section-move drop).
   4. stream: when ui.view === 'board' render the active section's notes (pinned first, then
      by updatedAt desc, filtered by ui.search case-insensitively over title/text) as cards;
      when ui.view === 'trash' render deleted notes with restore/purge.
   5. footer: t('list.count', {n}) + t('shortcuts.hint').
DSN.NoteCard({ store, t, note, bridge, drag })  one card:
   - head: kind icon, age (DSN.formatAge(note.updatedAt, t)), pin/copy/insert/edit/delete icon
     buttons revealed on hover and always visible for the focused card;
   - body: DSN.Content({ html: DSN.sanitizeHtml(note.html), kind: note.kind }), clamped to
     8 lines with a "expand" affordance when taller (use a max-height + gradient mask);
     images and tables keep their rendered form;
   - footer when note.source: t('list.source', { name }) as a subtle chip;
   - editing mode: DSN.Editor with save/cancel;
   - "insert to composer" uses DSN.bridge.insert(note.html, note.text, t) and toasts
     status.inserted / status.noSession;
   - "copy" uses DSN.copyRich(note.html, note.text) and toasts status.copied;
   - delete moves the card out with no confirm (it is a soft delete; the trash has restore).
Drag & drop protocol (shared, do not invent another one):
   - dragging a card sets dataTransfer 'application/x-dsn-note' = note.id and 'text/plain' = text;
   - section chips accept a drop of 'application/x-dsn-note' → store.actions.moveNote(id, sectionId, null);
   - a "trash" drop zone (only visible while dragging: a bar above the list that appears on
     drag start, or the trash tab chip) accepts it → store.actions.deleteNote(id);
   - reordering inside a section is optional; if implemented, insert before the hovered card
     using store.actions.moveNote(id, sectionId, hoveredNoteId);
   - external content dropped on the panel/composer goes through DSN.readDragContent.
`DSN.TrashView`, `DSN.SectionRail`, `DSN.Composer` may be internal helpers but must be
reachable from NotesApp. Empty states: t('list.empty'), t('list.emptySection'), t('list.trashEmpty').
```

The body must be keyboard reachable: cards are focusable buttons/divs with `role="button"`,
`tabIndex=0` and Enter/Space opens the editor; all icon buttons carry `aria-label` + `title`.

### `src/60-capture.js` — capture from the conversation → `DSN.installCapture`, `DSN.bridge`
Exports:

```
DSN.installCapture({ ctx, store, t, getSession }) -> disposer
    - installs document listeners ('selectionchange' debounced, 'pointerup', 'scroll' capture,
      'keydown') and renders a floating chip ("存便签", t('capture.chip')) near the current
      selection with a portal into document.body.
    - the chip appears only when (a) the selection is non-collapsed, (b) its text or html is
      non-empty, (c) the selection is NOT inside our own panel/PiP (.dsn-root), and (d) it is
      not inside an editable element. Hiding the chip when the selection collapses.
    - clicking the chip: capture the selection as rich HTML (use the selection range's cloned
      contents: build html with a wrapper cloning `Range.cloneContents()`, and read text via
      `window.getSelection().toString()`), call
      store.actions.addNote({ html, text, source: getSession() }), toast t('note.saved'), then
      collapse the selection and hide the chip. Also copy? No.
    - Alt+Shift+S does the same for the current selection anywhere in the document.
    - Alt+Shift+N calls store.actions.toggleOpen() (unless the event target is editable).
    - installs the 'contextmenu' text-interaction definition:
        ctx.uiConversation.interactions.register({ id: 'dsh-sticky-board', onInteraction(request) {
          if (request.trigger !== 'contextmenu') return;      // never steal the selection trigger
          ... request.open() when there is a selection ...
        }})
      and the matching surface component registered in the slot
      'conversation.chat.text-interaction' with key 'dsh-sticky-board' (it renders the "存便签" button,
      reading the same capture path). Never call request.open() for trigger 'selection' — the
      built-in "引用文本" owns that and only the first definition that calls open() wins.
DSN.bridge
    { get() -> { sessionId, sessionTitle } | null,
      insert(html, text, t) -> Promise<boolean>,   // insert into the active session composer
      subscribe(fn) -> disposer }
    DSN.installComposerBridge({ ctx }) -> disposer
      registers an invisible component into the slot 'conversation.input.dock'
      (kind 'list', scope 'session', owner props include useSession + inputActions):
      it publishes { sessionId, sessionTitle, insertText } into DSN.bridge on mount/update and
      clears it on unmount. insert(html,text) prefers the rich path when the composer supports
      HTML, otherwise inserts plain text:
         const actions = activeInputActions
         const span = actions.captureInsertion()
         actions.insertText(text, span)   // plain text fallback, always available
      Wrap in try/catch; on failure fall back to DSN.copyRich(html, text) + toast
      t('status.noSession'). Never submit the message.
```

Pitfalls: selection rect via `range.getBoundingClientRect()`; hide chip on wheel/scroll of the
conversation container; do not fight the native selection menu (the chip is offset 8px above
the selection start and pointer-events enabled only on the chip itself); keep every listener
passive where possible.

### `src/70-pip.js` — always-on-top window → `DSN.openPip`, `DSN.closePip`, `DSN.pipSupported`, `DSN.togglePip`
Exports:

```
DSN.pipSupported() -> boolean     'documentPictureInPicture' in window
DSN.isPipOpen() -> boolean
DSN.togglePip({ store, t, ctx })  open when closed, close when open
DSN.openPip({ store, t, ctx })    documentPictureInPicture.requestWindow({ width, height })
    -> copy <style> (DSN.cssText()), copy the theme tokens listed in DSN.TOKENS from
       getComputedStyle(document.documentElement) to the PiP documentElement inline style,
       copy data-theme attribute and background colour, set body.dsn-pip styles, create a root
       div, then ReactDOM.createRoot(div).render(h(DSN.Panel, { store, t, ctx, embedded: true }))
    -> keep a reference; on 'pagehide' of the PiP window dispose the root and mark closed;
       a second call must not open a second window.
DSN.closePip()
```

The PiP window uses the same `store` object, so notes stay in sync both ways without any
messaging. The PiP document must not load host CSS: rely on `DSN.cssText()` + copied tokens.

### `src/80-sidebar.js` — where the panel is opened from → `DSN.SidebarLauncher`, `DSN.registerBetterSidebarTab`
Exports:

```
DSN.SidebarLauncher({ store, t, wide })   icon button for the slot 'sidebar.footer.action'
    (owner props { wide: boolean }): icon DSN.Icon('note'), tooltip t('sidebar.launcher'),
    active state when store.ui.open, aria-pressed, onClick store.actions.toggleOpen().
DSN.registerBetterSidebarTab({ ctx, store, t }) -> disposer|null
    const better = ctx.get('betterSidebar'); if (!better || typeof better.registerTab !== 'function')
    return null; register a tab { id: 'dsh-sticky-board', title: t('sidebar.tabTitle'),
    description: t('sidebar.tabDescription'), icon: DSN.Icon({ name: 'note' }), order: 60,
    component: (props) => h(DSN.NotesApp, { store, t, bridge: DSN.bridge, ctx }) };
    guard every call in try/catch (the service is third-party and may change).
```

### `src/90-apply.js`, `src/95-tail.js` — written by the Lead (do not edit).

`apply(ctx)` will: register locale dicts, create the store, register the shell.overlay panel,
the sidebar footer launcher, the composer bridge, the capture layer, the PiP entry, and the
better-sidebar tab; then clean everything up on dispose.

## Definition of done

- `node --check src/<your files>.js` passes for each file you wrote.
- No string literal in UI code (only dictionary keys), no hardcoded colour values, no
  `innerHTML` without `DSN.sanitizeHtml`, no `require`, no JSX, no `ctx` leaking into
  components except through props.
- Every exported name from your fragment exists exactly as written in this document.
- Your final report lists: files written, exports provided, dictionary keys added, and any
  assumption you had to make about another fragment.
