# Feel the Notion

> Recommended setting: Obsidian Settings → Files and Links → under Links, toggle on **Automatically update internal links**.

Notion-like block editing for Obsidian's Live Preview.

## Features

- **Hover handles** — a `+` and a drag handle follow the pointer down the gutter.
- **Drag whole blocks** — grabbing any line takes the block, children included, and drops it at a depth you choose with horizontal position.
- **Multi-block selection** — a drag across blocks paints whole blocks rather than a ragged text range.
- **Block-aware keys** — `Cmd+A` selects the block, then the note. `Backspace` at a block's start outdents, then drops the marker, then merges.
- **Insert menu** — type `/` on an empty block or mid-line, or click the `+`.
- **Hide syntax markers** — optional: stops text shifting sideways as the caret enters `**bold**`.
- **Handle side** — the handle can sit on the left or the right of the text, and can be pinned so it never hides when the pointer moves away.
- **Fold blocks** — a chevron on the handle folds a block to its first line, leaving an ellipsis you click to expand it again.
- **Move blocks together** — selecting several blocks and dragging any one of their handles moves all of them together.
- **Custom insert menu** — insert-menu rows can be reordered, hidden, and extended with custom rows that run any Obsidian command. A custom row runs its command on a single click with no confirmation, so binding a destructive one — "Delete current file", say — gives you a one-click delete.
- **Bullet depth markers** — optional, off by default: child bullets get their own marker in the file, `-` then `*` then `+`, and a matching ● ○ ▪ on screen. Markers can be reordered or switched off. Only lists you edit are changed. Built in from the standalone [Bullet Depth Markers](https://github.com/MichaelNguyen5653/Bullet-Depth-Markers) plugin; disable that one before turning this on.

- **Folder notes** — a folder with a note of its own name inside (`Travel/Travel.md`) opens that note when clicked, the way a Notion page holds sub-pages; the note is hidden inside the folder, and renaming either renames both. The **Page** insert item creates a sub-page, first turning the current note into a folder note when it is not one. A block dropped on such a folder goes to its note.
- **Page icons and covers** — an icon and a cover image above the title, as in Notion, stored in the note's `icon` and `banner` / `banner-y` properties, so notes that already have them keep theirs. Hover the title for **Add icon** and **Add cover**; a cover can be changed, repositioned by dragging, or removed. Icons also show in the file explorer, and existing folder icons can be imported from settings.

- **Page header extras** — covers span the pane like Notion's, and can be a built-in gradient or an image uploaded from your computer as well as a vault image or URL. On an empty page, **Templates** fills it from a note in the templates folder (`{{title}}`, `{{date}}`, `{{time}}`, `{{date:FORMAT}}`).
- **Page options** — **Full width** and **Small text** per page, from the note's menu or the command palette, stored as `cssclasses`.
- **Icons where pages are mentioned** — before links to a page in Live Preview and Reading view, and on tabs.
- **Breadcrumbs** — the folders in a note's header open their folder notes, with their icons; a folder note's own folder is left out of its trail.
- **"+" in the explorer** — hovering a folder or note shows a "+" that adds a page inside it. New pages open with the title selected for renaming.
- **Sub-pages, database and toggle blocks** — insert-menu items for a live list of the page's sub-pages, an inline database (an Obsidian Base over the page's folder), and a toggle (a folded callout drawn without its box; also under Turn into).
- **Go to page** — a page switcher with icons, where a folder note is listed once as its folder's page, and no match offers to create the page. Bind it to Cmd+O under Hotkeys to use it in place of the quick switcher.
- **Block keys** — `Cmd+Shift+↑/↓` moves blocks with their children, `Cmd+D` duplicates them, and `Esc` selects the current block: then `↑/↓` moves between blocks, `Shift` extends, `Backspace` deletes, `Cmd+C/X` copies or cuts whole blocks, `Tab` indents, and `Enter` or `Esc` returns to editing.
- **@ mentions** — `@` suggests pages to link, and Today, Tomorrow, Yesterday and Now.
- **Link paste menu** — pasting a lone URL offers to keep it, title it from the page, or embed it; pasted over selected text it links that text.

Everything behavioural has a toggle in settings.

<details>
<summary><b>Change logs</b></summary>

### 0.10.0

New features:

- Block keys: move, duplicate, and Esc to select blocks
- @ mentions and a link paste menu
- Icons on links and tabs, breadcrumbs that open folder notes, a "+" in the explorer
- Full-width covers, gradient covers, cover upload, page templates, Full width and Small text
- Sub-pages, database and toggle blocks; Go to page

### 0.9.0

New features:

- Folder notes, and sub-pages from the "Page" insert item
- Page icons and covers, stored as `icon` and `banner` properties
- Icons in the file explorer, and an import of existing folder icons

### 0.8.0

- Optimize block dragging mechanics and functionalities

### 0.7.0

New features:

- Bullet depth markers, built in and off by default
- Reorder or switch off bullet markers in settings
- A "What's new" card after each update

### 0.6.3

Bug fixes and improvements:

- The block handle now lines up with your text on themes that center the editor.
- The handle no longer sits on top of Obsidian's own fold arrow on headings and lists.
- Thanks to @alwinlin23 for reporting and fixing the alignment problem.

### 0.6.2

Bug fixes and improvements.

New features:

- Insert a new line, for getting a paragraph under a table or code block that ends a note

### 0.6.1

Bug fixes and improvements.

### 0.6.0

Bug fixes and improvements:

- The drag handle no longer disappears while you reach for it.
- The settings page no longer jumps back to the top when you add, edit, reorder or delete an insert menu row.
- Custom insert menu rows can now bind any Obsidian or plugin command, not just the handful that were listed.

### 0.5.0

Bug fixes and improvements.

New features:

- Handle position and always-on pinning
- Block folding from the handle
- Multi-block drag
- Insert menu reordering, hiding and custom commands

### 0.4.0

Bug fixes and improvements:

- Dragging blocks is smoother. Pointer movement is now handled once per frame rather than once per mouse event, so a fast drag no longer does the same measuring several times between two redraws.
- Hovering the gutter costs less. The handle measures the line only when the pointer actually crosses into a different one, instead of re-checking on every movement.
- Measuring and repositioning were interleaved, which forced the browser to recalculate layout repeatedly within a single mouse event. Everything is now measured first and drawn afterwards.
- Editor geometry that cannot change mid-drag is read once instead of on every movement, and the list of legal drop depths is recalculated only when the drop point moves to a different line.
- Releasing the mouse at the end of a fast drag drops the block where the pointer actually was, not where it had been a moment earlier.
- The hover handle no longer occasionally stays on screen after the pointer has left the editor.

### 0.3.0

**Mobile support coming!**

New:

- `/check list` — inserts a `- [ ]` checkbox.
- `/yesterday` and `/tomorrow` — insert the neighbouring day's date.

Bug fixes and improvements:

- Hide syntax markers now leaves code alone. `_VARIABLE_A_` inside a fenced block or an inline code span keeps its underscores.
- Typing `/table` now offers Table before Table of contents.
- A table inserted directly under text gets the blank line Markdown needs, so it renders as a table instead of literal pipes.
- The caret now lands in the new table's first cell.

</details>

![The insert menu, opened by typing a slash](docs/insert-menu.png)

## Installation

### Community plugins

1. Settings → Community plugins → **Browse**.
2. Search for **Feel the Notion**, then **Install**.
3. **Enable** it.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/MichaelNguyen5653/feel-the-notion/releases).
2. Put them in `<vault>/.obsidian/plugins/feel-the-notion/`.
3. Enable the plugin in Settings → Community plugins.

## Credits

Forked from [BCS1037/notion-block](https://github.com/BCS1037/notion-block) v1.4.0 (MIT).

Built with the help of [Claude Code](https://claude.com/claude-code).

## License

MIT. See [LICENSE](LICENSE).
