# dsh-sticky-board · sticky notes for DSH

A sticky-note board for the DeepSeek Harness Web GUI: capture something from a conversation, keep it, and carry it into any other conversation later. Notes keep the rendered content — tables, images and code blocks look the same as they did in the chat — and a note can be dropped back into a composer, or pulled out into its own floating window.

[中文说明](./README.md)

## Features

- **Save from the conversation.** Selecting message text shows a two-action menu with **Quote text** and **Save to notes**. The built-in quote action is still there; saving is an addition. The same action is in the right-click menu, and `Alt+Shift+S` saves the current selection directly.
- **Save outside the chat flow too.** Where the chat flow does not own the selection (tool output, file previews), a small **Save to notes** pill appears at the bottom-right of the selection instead.
- **Rich content.** Notes store the rendered HTML: tables, images, code blocks, quotes and lists stay as they were. You can also paste images and drop tables straight into the composer.
- **Save a whole reply.** The icon row under a finished assistant reply (copy, 👍, 👎, …) gains a notes button that saves the entire reply body, tables and code included, rather than only the selected sentence.
- **Save a rendered image.** Right-clicking an image in the conversation offers **Save to notes** next to copy / download / show in folder. The bytes are stored as a data URL, so the image survives a reload.
- **The board itself.** The notes icon at the top-right of the session header (leftmost in that row) opens a floating panel you can type into directly; `Alt+Shift+N` toggles it.
- **Sections.** An inbox plus custom sections; drag notes between sections, drag to reorder, drag to the trash zone.
- **Trash.** Deleting is soft: restore, delete permanently, or empty the trash.
- **Priorities.** Every card carries a priority pill (urgent / high / normal / low, normal by default); clicking it opens a themed menu. Cards are colour-coded, the toolbar can filter by priority, and sorting can switch from time to priority while time stays the default.
- **Themed dropdowns.** Sorting, the priority filter and the per-card priority picker share the panel's own design tokens: a popover portalled to `body` (so the panel never clips it) with ↑ / ↓ / Enter / Esc and click-outside handling, instead of a native `select`.
- **To-do lists.** Any note can hold a checklist (Enter adds another item, ticking completes it, one click clears the finished ones). The **To-do** tab aggregates every open item across notes, grouped by note and sorted by priority — and it is fully operable there: tick, delete, or add to any group, and when nothing is pending yet the empty state takes a first item and files it into a new **To-dos** note. Search and a hide-finished switch are still there.
- **Comments on a note.** The comment chip at the foot of a card opens a detail sheet with the body, the checklist, the priority and a Feishu-style comment thread (Enter sends, Shift+Enter breaks the line); comments can be removed and the card shows their count.
- **Send back to a conversation.** "Insert into composer" puts the note into the current session's composer (plain text); without an active session it falls back to the clipboard.
- **Quote back into the composer.** The quote action on a note card inserts the note's text through the host's own quote path — the same one the built-in "Quote text" action uses — so it arrives as a real quote and is sent as a Markdown blockquote. Notes captured from a conversation also keep a hidden origin (session, turn and chat-node coordinates) that is never rendered; quoting one from another conversation adds a hint about where it came from.
- **Drag back into the composer.** Drag a note card onto the composer and release: a blue drop ring and a "release to insert" pill appear, and the note is inserted at the caret as Markdown (tables, code fences, lists and quotes are restored; images become `![alt](src)`).
- **Drag out into a window.** Release a note card anywhere outside the composer — the transcript, empty space — and the note becomes its own floating window. Move it by the title bar, resize from the corner, collapse or close it; window geometry is stored in the note document (`ui.floaters`) and survives a reload. The window renders the note body, its priority and its comment thread, and comments can be written right there (same data as the panel). Dropping on the panel still means reorder / move / trash, and dropping on the composer still means insert.
- **Picture-in-picture.** The PiP button in the panel header puts the board into an always-on-top system window (Chrome / Edge 116+) so notes can be read and copied from other applications.
- **Every tab in sync.** Multiple tabs of the same browser and the PiP window stay in sync over a BroadcastChannel.
- **Durable file.** The Host half writes the board to a real file (`notes.json`, atomic write, previous revision kept as `.bak`); the browser keeps a fast copy. Changing browsers, clearing site data or switching ports does not lose notes, and the status pill at the bottom of the panel reports 已保存 / browser only.
- **Works with better side bar.** When `dsh-better-sidebar` is installed, a notes tab is registered automatically.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+N` | Open / close the notes panel |
| `Alt+Shift+S` | Save the current selection as a note |
| `Ctrl/Cmd+Enter` | Save the note being edited |

## Install

Install from the DSH plugin market, or point the plugin manager at a checkout of this repository:

```text
plugin_manager action=install_bundle target=<absolute path to this repo>
```

Then reload the Web GUI page. No build step is required: `client.js` is committed.

## Data

Two copies of the board exist:

1. **The file** (authoritative): `<profile>/plugin-data/dsh-sticky-board/notes.json`, or `%USERPROFILE%\.dsh\plugin-data\dsh-sticky-board\notes.json` when the process has no `DSH_PROFILE_DIR`. Writes go through `.tmp` + atomic rename, the previous revision is kept as `notes.bak.json`, and a corrupt file is moved aside as `notes.json.corrupt-<timestamp>` before the board starts empty. A fresh directory adopts an earlier document it finds in a known candidate directory and records `adoptedFrom` in `host.json`.
2. **The browser copy** (fast reads): the `dsh-notes/v1` key in `localStorage`.

On page load the client GETs `/dsh-sticky-board/data` and merges the file with the browser copy (sections union by id, notes by id taking the newer revision, a delete counts as a newer edit). Every change is PUT back with a 700 ms debounce, plus one `keepalive` flush when the page hides. If the Host is unreachable the plugin degrades to browser-only storage and the status pill says so; clicking the pill re-probes the Host and retries.

## Development

`src/*.js` are fragments of one browser bundle, concatenated into `client.js` in the order listed in `build.mjs`; [CONTRACT.md](./CONTRACT.md) documents the rules.

```sh
node build.mjs          # concatenate src/*.js -> client.js
node tests/smoke.mjs    # jsdom integration smoke test (155 checks)
node tests/host.mjs     # Host half: route, file writes, corruption recovery, directory adoption (39 checks)
node tests/sync.mjs     # browser <-> file end-to-end sync (18 checks)
node tests/browser.mjs  # real Chrome end-to-end self-test (36 checks, light and dark)
node tests/browser.mjs --dark
```

`tests/visual/index.html` is the visual debugging harness (`?theme=dark`, `?chip=1`, `?surface=1`, `?drop=1`, `?float=1`, `?panel=520x800`, `?panel=0`, `?selftest=1`, `?diag=1`). Screenshots are taken with `tests/visual/cdp-shot.mjs`, which waits for a selector and drives Chrome over the DevTools protocol; `chrome --headless --screenshot` fires before floating layers commit and misses them.

## Compatibility and limits

- Requires the DSH Web GUI (`platform: web`) and a Chromium-based browser for the PiP window; the button hides itself where Document Picture-in-Picture is unavailable.
- Insertion into the composer goes through the composer insert API; very long rich content degrades to plain text.
- Dragging into the composer converts the note to Markdown. Inline base64 images become `*[image]*` placeholders instead of megabytes of base64 in the editor.
- The board keeps at most 800 notes, evicting the oldest trashed note.
- At most 8 detached windows; their geometry is per-browser view state and does not follow the user across machines. Deleting a note closes its window.
- Saving a reply captures the rendered body only: reasoning, tool cards and in-flight streaming are not included, and the button appears once the reply is finished.
- Saving an image stores the bytes as a data URL, up to 6 MB. Over the limit, or when the bytes cannot be read cross-origin, an `https` image falls back to its URL and other cases report an error in the menu.
- Upgrading `index.js` (the Host half) requires reloading the plugin or restarting `dsh web`; changing only `src/*.js` needs `node build.mjs` plus a page reload.
- The Host half writes `host.json` only after the data route is actually registered. A missing marker, or a 404 from `GET /dsh-sticky-board/data`, means the Host half is not loaded; reload the plugin and the browser copy merges back.

## License

MIT