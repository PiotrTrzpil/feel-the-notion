import { App, PluginSettingTab, Setting, setIcon } from 'obsidian';
import NotionBlock from './main';
import { t } from './locale/helpers';
import {
    BUILTIN_ITEMS,
    CustomInsertItem,
    InsertLayout,
    addCustomItem,
    applyOrder,
    removeCustomItem,
    reorderIds,
    resetItemLayout,
    resolveMenuItems,
    setItemHidden,
    updateCustomItem,
} from './insertRegistry';
import { InsertCommandModal } from './insertCommandModal';
import { resolveBulletMarkers } from './bulletDepth';
import { importIconizeIcons } from './iconizeImport';

/** Plugins whose job the "Pages" settings now do. */
const SUPERSEDED_PLUGINS = [
    { id: 'folder-notes', name: 'Folder notes' },
    { id: 'obsidian-icon-folder', name: 'Iconize' },
    { id: 'pexels-banner', name: 'Pixel Banner' },
];

export interface BlockPluginSettings {
    enabled: boolean;
    dragGranularity: 'line' | 'paragraph';
    hoverDelay: number;
    hideDelay: number;
    /** Which edge of the content the hover handle is drawn beside. */
    handleSide: 'left' | 'right';
    /** Pin the handle to the caret's block so it never hides on pointer-out. */
    handleAlwaysVisible: boolean;
    /** Show the fold chevron on the hover handle. */
    foldHandle: boolean;
    dateFormat: string;
    timeFormat: string;
    /** Hide markdown syntax markers on the active line too, killing reflow. */
    hideSyntaxMarkers: boolean;
    /** Expand a multi-block drag selection to whole blocks, as Notion does. */
    snapSelectionToBlocks: boolean;
    /** Cmd+A escalation and Backspace-at-block-start. */
    blockKeys: boolean;
    /** Show the "+" button on the hover handle. */
    plusHandle: boolean;
    /** Open the insert menu by typing a trigger character on an empty block. */
    slashMenu: boolean;
    /** The character that opens it. */
    slashTrigger: string;
    /** Also open it mid-line, after a space, rather than on empty blocks only. */
    slashInline: boolean;
    /** Insert-menu item ids in the order the user chose. Empty means the default order. */
    insertOrder: string[];
    /** Insert-menu item ids the user turned off. */
    insertHidden: string[];
    /** Insert-menu rows the user added, each bound to an Obsidian command. */
    insertCustom: CustomInsertItem[];
    /** Write inserted attachments as embeds (a leading "!") rather than links. */
    embedAttachments: boolean;
    /** A link to an attachment is one block, not editable text. */
    attachmentLinks: boolean;
    /** Rewrite bullet markers in the file to follow nesting depth. */
    bulletDepth: boolean;
    /** The three legal markers in the order the user chose. Empty means - * +. */
    bulletOrder: string[];
    /** Markers left out of the depth cycle. */
    bulletHidden: string[];
    /** Folders open their note on click; the note is hidden inside them. */
    folderNotes: boolean;
    /** A link to a sub-page or a nested page is one block, not editable text. */
    pageLinkBlocks: boolean;
    /** Icon and cover above a note's title, and icons in the file explorer. */
    pageHeader: boolean;
    /** Icons of folders that have no folder note to hold one, by folder path. */
    folderIcons: Record<string, string>;
    /** Typing @ suggests pages and dates to link. */
    mentions: boolean;
    /** Pasting a lone URL offers to keep it, title it or embed it. */
    linkPasteMenu: boolean;
    /** Folder whose notes are offered as templates on an empty page. Empty turns templates off. */
    templatesFolder: string;
    /** The release whose "What's new" card was last shown. */
    lastSeenVersion?: string;
}

export const DEFAULT_SETTINGS: BlockPluginSettings = {
    enabled: true,
    // Notion drags whole blocks, not single lines. A wrapped paragraph is one
    // block to the reader, so 'line' meant grabbing a paragraph moved a
    // fragment of it and left the rest behind.
    dragGranularity: 'paragraph',
    hoverDelay: 0,
    // Raised from 200ms. It has to cover the pointer's pause between leaving
    // a line and arriving at the handle, which is what made the handle feel
    // like it vanished the moment attention moved to it.
    hideDelay: 300,
    handleSide: 'left',
    // OFF by default: it changes the handle from a hover affordance into a
    // permanent one, which is a different editor to look at.
    handleAlwaysVisible: false,
    // OFF by default: it adds a third button to the hover handle, which is a
    // visible change to every line you point at rather than an opt-in feature.
    foldHandle: false,
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    // OFF by default: it changes editing behaviour, not just appearance.
    // With it on, `**` cannot be clicked between or hand-edited.
    hideSyntaxMarkers: false,
    // OFF by default: it changes what Backspace and typing replace, so it is
    // behaviour rather than appearance. The blue overlay is on regardless.
    snapSelectionToBlocks: false,
    blockKeys: true,
    plusHandle: true,
    slashMenu: true,
    slashTrigger: '/',
    slashInline: true,
    // Empty rather than the built-in order: resolveMenuItems appends anything
    // an order does not name, so an empty order IS the built-in order, and
    // storing it explicitly would freeze out rows added by later versions.
    insertOrder: [],
    insertHidden: [],
    insertCustom: [],
    // OFF by default, as asked: an attachment reads as a link unless it is
    // explicitly meant to render inline.
    embedAttachments: false,
    // ON by default: an attachment link is one block, the same way a sub-page
    // link is. The letters of the link are not something you edit.
    attachmentLinks: true,
    // OFF by default: it writes to the user's notes, changing characters they
    // typed, which nothing else in the plugin does without being asked.
    bulletDepth: false,
    // Empty for the same reason insertOrder is: resolveBulletMarkers fills in
    // whatever an order does not name.
    bulletOrder: [],
    bulletHidden: [],
    // ON by default: both only act on what a vault already has (a folder
    // note, an `icon` or `banner` field), apart from the "Add icon" and "Add
    // cover" buttons that appear while hovering a note's title.
    folderNotes: true,
    // ON by default: a sub-page link is a page block in Notion, and the
    // letters of the link are not something you edit.
    pageLinkBlocks: true,
    pageHeader: true,
    folderIcons: {},
    templatesFolder: 'Templates',
    mentions: true,
    linkPasteMenu: true,
};

export class BlockPluginSettingTab extends PluginSettingTab {
    plugin: NotionBlock;

    /** The insert-menu list, repainted on its own so display() is never needed. */
    private insertListEl: HTMLElement | null = null;
    /** The bullet marker list, repainted in place for the same reason. */
    private bulletListEl: HTMLElement | null = null;

    constructor(app: App, plugin: NotionBlock) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /** Stores one setting and persists it, refreshing everything that reads settings. */
    private store<K extends keyof BlockPluginSettings>(key: K, value: BlockPluginSettings[K]): Promise<void> {
        this.plugin.settings[key] = value;
        return this.plugin.saveSettings();
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl)
            .setName(t('settings.enablePlugin.name'))
            .setDesc(t('settings.enablePlugin.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enabled)
                .onChange((value) => this.store('enabled', value)));

        new Setting(containerEl)
            .setName(t('settings.dragGranularity.name'))
            .setDesc(t('settings.dragGranularity.desc'))
            .addDropdown((menu) => menu
                .addOption('line', t('settings.dragGranularity.line'))
                .addOption('paragraph', t('settings.dragGranularity.paragraph'))
                .setValue(this.plugin.settings.dragGranularity)
                .onChange((value: 'line' | 'paragraph') => this.store('dragGranularity', value)));

        new Setting(containerEl)
            .setName(t('settings.hoverDelay.name'))
            .setDesc(t('settings.hoverDelay.desc'))
            .addSlider(slider => slider
                .setLimits(0, 500, 50)
                .setValue(this.plugin.settings.hoverDelay)
                .onChange((value) => this.store('hoverDelay', value)));

        new Setting(containerEl)
            .setName(t('settings.hideDelay.name'))
            .setDesc(t('settings.hideDelay.desc'))
            .addSlider(slider => slider
                .setLimits(0, 1000, 50)
                .setValue(this.plugin.settings.hideDelay)
                .onChange((value) => this.store('hideDelay', value)));

        new Setting(containerEl)
            .setName(t('settings.handleSide.name'))
            .setDesc(t('settings.handleSide.desc'))
            .addDropdown((menu) => menu
                .addOption('left', t('settings.handleSide.left'))
                .addOption('right', t('settings.handleSide.right'))
                .setValue(this.plugin.settings.handleSide)
                .onChange((value: 'left' | 'right') => this.store('handleSide', value)));

        new Setting(containerEl)
            .setName(t('settings.handleAlwaysVisible.name'))
            .setDesc(t('settings.handleAlwaysVisible.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.handleAlwaysVisible)
                .onChange((value) => this.store('handleAlwaysVisible', value)));

        new Setting(containerEl)
            .setName(t('settings.foldHandle.name'))
            .setDesc(t('settings.foldHandle.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.foldHandle)
                .onChange((value) => this.store('foldHandle', value)));

        new Setting(containerEl)
            .setName(t('settings.dateFormat.name'))
            .setDesc(t('settings.dateFormat.desc'))
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.dateFormat)
                .onChange((value) => this.store('dateFormat', value)));

        new Setting(containerEl)
            .setName(t('settings.timeFormat.name'))
            .setDesc(t('settings.timeFormat.desc'))
            .addText(text => text
                .setPlaceholder('HH:mm')
                .setValue(this.plugin.settings.timeFormat)
                .onChange((value) => this.store('timeFormat', value)));

        new Setting(containerEl)
            .setName('Hide syntax in source mode')
            .setDesc(
                'Live Preview always keeps **, _, ==, ` and heading #s hidden while you edit, '
                + 'so formatting does not turn back into syntax. '
                + 'On: source mode hides them too. Off: source mode shows the characters. '
                + 'In Live Preview they cannot be clicked between — use Cmd+B / Cmd+I.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideSyntaxMarkers)
                .onChange((value) => this.store('hideSyntaxMarkers', value)));

        new Setting(containerEl)
            .setName('Snap selection to whole blocks')
            .setDesc(
                'When a mouse drag crosses a block boundary, expand the selection to whole blocks. '
                + 'The blue block overlay is shown either way; this controls whether typing and '
                + 'Backspace act on whole blocks too. Shift+Arrow is never snapped.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.snapSelectionToBlocks)
                .onChange((value) => this.store('snapSelectionToBlocks', value)));

        new Setting(containerEl)
            .setName('Block keys')
            .setDesc(
                'Cmd+A selects the block you are in, and again selects the note. '
                + 'Backspace at the start of a block steps out one indent level, then drops the '
                + 'list marker or heading, then merges into the block above. '
                + 'Cmd+Shift+Up/Down moves blocks, Cmd+D duplicates them, and Esc selects the block: '
                + 'then arrows move between blocks, Shift extends, Backspace deletes, Cmd+C/X copies '
                + 'or cuts, Tab indents, and Enter or Esc goes back to editing.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.blockKeys)
                .onChange((value) => this.store('blockKeys', value)));

        this.renderBulletDepth(containerEl);
        this.renderPages(containerEl);

        new Setting(containerEl).setName('Insert menu').setHeading();

        new Setting(containerEl)
            .setName('@ mentions')
            .setDesc('Typing @ suggests pages to link, and Today, Tomorrow, Yesterday and Now.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.mentions)
                .onChange((value) => this.store('mentions', value)));

        new Setting(containerEl)
            .setName('Link paste menu')
            .setDesc(
                'Pasting a lone URL offers to keep it, turn it into a link titled with the page\'s title '
                + '(fetched once), or embed it. Pasted over selected text, it links that text.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.linkPasteMenu)
                .onChange((value) => this.store('linkPasteMenu', value)));

        new Setting(containerEl)
            .setName('Show the "+" handle')
            .setDesc('The button beside the drag handle that opens the insert menu.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.plusHandle)
                .onChange((value) => this.store('plusHandle', value)));

        new Setting(containerEl)
            .setName('Open the insert menu by typing')
            .setDesc(
                'Type the trigger character to open the same menu the "+" handle opens, '
                + 'then keep typing to filter it.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.slashMenu)
                .onChange((value) => this.store('slashMenu', value)));

        new Setting(containerEl)
            .setName('Trigger character')
            .setDesc('A single character. For a key combination instead, bind "Open block insert menu" under Hotkeys.')
            .addText(text => text
                .setPlaceholder('/')
                .setValue(this.plugin.settings.slashTrigger)
                .onChange((value) => this.store('slashTrigger', value)));

        new Setting(containerEl)
            .setName('Open it mid-line too')
            .setDesc(
                'Off: the trigger only works on an otherwise empty block. '
                + 'On: it also works in the middle of a line, as long as it follows a space \u2014 '
                + 'so "and/or", a URL and a date are still left alone.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.slashInline)
                .onChange((value) => this.store('slashInline', value)));

        new Setting(containerEl)
            .setName('Embed inserted attachments')
            .setDesc(
                'Off: an attachment is inserted as a link, [name](path). '
                + 'On: it gets a leading "!" so Obsidian renders it inline. '
                + 'Either way the file is saved wherever Files & Links says attachments go.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.embedAttachments)
                .onChange((value) => this.store('embedAttachments', value)));

        new Setting(containerEl)
            .setName('Attachment links are blocks')
            .setDesc(
                'A link to an attachment is drawn as a single block: a paperclip and the file name. '
                + 'The caret cannot sit inside the link, and Backspace beside it removes the whole link. '
                + 'Embeds are left alone, so an image still shows as an image.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.attachmentLinks)
                .onChange((value) => this.store('attachmentLinks', value)));

        new Setting(containerEl)
            .setName(t('settings.insertItems.name'))
            .setDesc(t('settings.insertItems.desc'))
            .setHeading();

        this.renderInsertItemList(containerEl);
    }

    private renderPages(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Pages').setHeading();

        new Setting(containerEl)
            .setName('Folder notes')
            .setDesc(
                'A folder whose note sits inside it under the same name (Travel/Travel.md) opens that '
                + 'note when clicked, and the note is hidden from the folder\'s contents. Renaming one '
                + 'renames the other. The file explorer lists that folder\'s pages in the order the note '
                + 'links them, and pages it never links by name. The "Page" insert item makes the new page '
                + 'a sub-page. Dropping a markdown file on a note copies it into that folder and links it '
                + 'where it was dropped.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.folderNotes)
                .onChange((value) => this.store('folderNotes', value)));

        new Setting(containerEl)
            .setName('Sub-page links are blocks')
            .setDesc(
                'A link to a sub-page, or to a page nested under one, is drawn as a single block: '
                + 'its icon and its title. The caret cannot sit inside the link, and Backspace beside '
                + 'it removes the whole link. The link text stays in the note.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.pageLinkBlocks)
                .onChange((value) => this.store('pageLinkBlocks', value)));

        new Setting(containerEl)
            .setName('Page icons and covers')
            .setDesc(
                'An icon and a cover image above the title, read from the "icon" and "banner" '
                + 'properties, as Iconize and Pixel Banner wrote them. A page with no icon shows a generic page icon, '
                + 'and a folder that is not a page shows a directory icon. '
                + 'Icons also show in the file explorer.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.pageHeader)
                .onChange((value) => this.store('pageHeader', value)));

        new Setting(containerEl)
            .setName('Page templates folder')
            .setDesc(
                'Notes in this folder are offered under "Templates" on an empty page. '
                + '{{title}}, {{date}} and {{time}} are filled in, {{date:FORMAT}} with a moment format. '
                + 'Leave empty to turn templates off.'
            )
            .addText(text => text
                .setPlaceholder('Templates')
                .setValue(this.plugin.settings.templatesFolder)
                .onChange((value) => this.store('templatesFolder', value.trim())));

        new Setting(containerEl)
            .setName('Import icons from Iconize')
            .setDesc(
                'Copies the icons Iconize kept in its own settings: a note\'s into its "icon" property, '
                + 'a folder\'s into its folder note, or into this plugin when the folder has none. '
                + 'Icons already set are kept.'
            )
            .addButton(button => button
                .setButtonText('Import')
                .onClick(() => void importIconizeIcons(this.plugin)));

        const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
        const superseded = SUPERSEDED_PLUGINS.filter(p => plugins?.[p.id]).map(p => p.name);
        if (superseded.length > 0) {
            containerEl.createDiv({
                cls: 'ftn-setting-warning',
                text: `Also enabled: ${superseded.join(', ')}. Disable them, or both will draw `
                    + 'icons, covers and folder clicks.',
            });
        }
    }

    private renderBulletDepth(containerEl: HTMLElement): void {
        new Setting(containerEl).setName('Bullet depth markers').setHeading();

        new Setting(containerEl)
            .setName('Match bullet markers to nesting depth')
            .setDesc(
                'Rewrites the marker in the file as you indent: the first level uses the first '
                + 'marker below, the next level the second, and the cycle repeats. Bullets show as '
                + '● ○ ▪ by depth. Only lists you edit are changed. Numbered lists, code blocks '
                + 'and frontmatter are left alone.'
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.bulletDepth)
                .onChange((value) => this.store('bulletDepth', value)));

        // Two transaction filters with different sequences would each rewrite
        // the other's markers on every edit, the last one registered winning.
        // Nothing breaks, but the result looks like this setting is ignored.
        //
        // The loaded instance, not enabledPlugins: that set is the saved
        // config, which enablePlugin does not update and which still lists a
        // plugin that failed to load. What conflicts is the filter running.
        const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins;
        if (plugins?.plugins?.['bullet-depth-markers']) {
            containerEl.createDiv({
                cls: 'ftn-setting-warning',
                text: 'The standalone Bullet Depth Markers plugin is also enabled. Disable one of them, '
                    + 'or their marker sequences will overwrite each other.',
            });
        }

        this.bulletListEl = containerEl.createDiv({ cls: 'ftn-insert-item-list' });
        this.refreshBulletList();
    }

    /**
     * The three markers as reorderable rows, each with its own switch.
     *
     * Same shape as the insert-menu list, and for the same reason: the order
     * is a permutation, and which rows are on is separate from where they sit,
     * so switching one off and on again puts it back where it was.
     */
    private refreshBulletList(): void {
        const listEl = this.bulletListEl;
        if (!listEl) return;
        listEl.empty();

        const settings = this.plugin.settings;
        const order = resolveBulletMarkers(settings.bulletOrder, []);
        const enabled = resolveBulletMarkers(settings.bulletOrder, settings.bulletHidden);
        const names: Record<string, string> = { '-': 'Dash', '*': 'Asterisk', '+': 'Plus' };

        order.forEach((marker, index) => {
            const isOn = enabled.includes(marker);
            const row = listEl.createDiv({ cls: 'ftn-insert-item-row', attr: { draggable: 'true' } });

            setIcon(row.createSpan({ cls: 'ftn-insert-item-grip' }), 'grip-vertical');
            row.createEl('code', { cls: 'ftn-bullet-marker', text: marker });

            const textEl = row.createDiv({ cls: 'ftn-insert-item-text' });
            textEl.createDiv({ cls: 'ftn-insert-item-label', text: names[marker] });
            textEl.createDiv({
                cls: 'ftn-insert-item-source',
                text: isOn ? `Level ${enabled.indexOf(marker) + 1}` : 'Not used',
            });

            const toggle = row.createDiv({ cls: 'ftn-insert-item-controls' })
                .createEl('input', { attr: { type: 'checkbox' } });
            toggle.checked = isOn;
            // The last marker in use cannot be switched off: an empty sequence
            // has nothing to write, which would leave the feature on in name only.
            toggle.disabled = isOn && enabled.length === 1;
            toggle.addEventListener('change', () => {
                const hidden = settings.bulletHidden.filter((m) => m !== marker);
                void this.store('bulletHidden', toggle.checked ? hidden : [...hidden, marker]);
                // Repaint: every row's level number shifts when one goes on or off.
                this.refreshBulletList();
            });

            row.addEventListener('dragstart', (event) => {
                event.dataTransfer?.setData('text/plain', String(index));
                row.addClass('is-dragging');
            });
            row.addEventListener('dragend', () => row.removeClass('is-dragging'));
            row.addEventListener('dragover', (event) => {
                event.preventDefault();
                row.addClass('is-drop-target');
            });
            row.addEventListener('dragleave', () => row.removeClass('is-drop-target'));
            row.addEventListener('drop', (event) => {
                event.preventDefault();
                row.removeClass('is-drop-target');
                const from = Number(event.dataTransfer?.getData('text/plain'));
                if (from === index) return;
                void this.store('bulletOrder', reorderIds(order, from, index));
                this.refreshBulletList();
            });
        });
    }

    /**
     * The insert menu's rows, reorderable and individually switchable.
     *
     * Order is stored as a full id list rather than as a sparse set of moves:
     * resolveMenuItems appends anything the list does not name, so a partial
     * list still works, but writing the whole list keeps what is stored and
     * what is shown identical.
     */
    private renderInsertItemList(containerEl: HTMLElement): void {
        this.insertListEl = containerEl.createDiv({ cls: 'ftn-insert-item-list' });
        this.refreshInsertList();

        new Setting(containerEl)
            .addButton((button) => button
                .setButtonText(t('settings.addCommand'))
                .onClick(() => {
                    new InsertCommandModal(this.app, null, (item: CustomInsertItem) => {
                        void this.applyLayout(addCustomItem(this.plugin.settings, item));
                    }).open();
                }))
            .addButton((button) => button
                .setButtonText(t('settings.resetOrder'))
                .onClick(() => {
                    void this.applyLayout(resetItemLayout(this.plugin.settings));
                }));
    }

    /**
     * Writes a layout back and repaints the list.
     *
     * Never calls display(). PluginSettingTab.display() begins by emptying the
     * whole tab, so using it to reflect a one-row change threw away every other
     * setting on the page and scrolled the user back to the top — on every add,
     * edit, delete, reorder and reset. Only the list needs to change, so only
     * the list is rebuilt.
     */
    private async applyLayout(next: InsertLayout): Promise<void> {
        this.plugin.settings.insertOrder = next.insertOrder;
        this.plugin.settings.insertHidden = next.insertHidden;
        this.plugin.settings.insertCustom = next.insertCustom;
        return this.plugin.saveSettings();
        this.refreshInsertList();
    }

    /** Every Obsidian command by id, for naming a custom row's binding. */
    private commandsById(): Record<string, { name?: string }> {
        return (this.app as unknown as {
            commands?: { commands?: Record<string, { name?: string }> };
        }).commands?.commands ?? {};
    }

    private refreshInsertList(): void {
        const listEl = this.insertListEl;
        if (!listEl) return;

        const settings = this.plugin.settings;
        // The list has its own max-height and scrolls independently, so a
        // repaint has to put it back where the user left it.
        const scrollTop = listEl.scrollTop;
        listEl.empty();

        // Hidden items must appear in this list or they could never be turned
        // back on, so it is resolved with an empty hidden set.
        const items = resolveMenuItems(BUILTIN_ITEMS, settings.insertCustom, settings.insertOrder, [], (key) => t(key));
        const order = items.map((item) => item.id);
        const commands = this.commandsById();

        items.forEach((item, index) => {
            const row = listEl.createDiv({ cls: 'ftn-insert-item-row', attr: { draggable: 'true' } });
            row.dataset.index = String(index);

            setIcon(row.createSpan({ cls: 'ftn-insert-item-grip' }), 'grip-vertical');
            setIcon(row.createSpan({ cls: 'ftn-insert-item-icon' }), item.icon);

            const custom = settings.insertCustom.find((entry) => entry.id === item.id);
            const textEl = row.createDiv({ cls: 'ftn-insert-item-text' });
            textEl.createDiv({ cls: 'ftn-insert-item-label', text: item.label });

            if (custom) {
                // Naming the bound command under the label is what makes a list
                // of custom rows readable: the label is the user's own wording,
                // so without this there is nothing on screen saying what the row
                // actually runs.
                const bound = commands[custom.commandId];
                if (bound) {
                    textEl.createDiv({
                        cls: 'ftn-insert-item-source',
                        text: t('settings.customCommand.boundTo').replace('{name}', bound.name ?? custom.commandId),
                    });
                } else {
                    // A binding whose command has gone (plugin disabled or
                    // removed) stays in the list and says so, rather than
                    // disappearing and taking the user's configuration with it.
                    textEl.createDiv({ cls: 'ftn-insert-item-source is-missing', text: t('settings.commandMissing') });
                }
            }

            const controls = row.createDiv({ cls: 'ftn-insert-item-controls' });

            const toggle = controls.createEl('input', { attr: { type: 'checkbox' } });
            toggle.checked = !settings.insertHidden.includes(item.id);
            // No repaint: the row's own shape does not change, and rebuilding
            // the list under the pointer would fight the click that got here.
            toggle.addEventListener('change', () => {
                const next = setItemHidden(this.plugin.settings, item.id, !toggle.checked);
                void this.store('insertHidden', next.insertHidden);
            });

            if (custom) {
                const editBtn = controls.createDiv({ cls: 'ftn-insert-item-button', attr: { 'aria-label': t('settings.customCommand.edit') } });
                setIcon(editBtn, 'pencil');
                editBtn.addEventListener('click', () => {
                    new InsertCommandModal(this.app, custom, (updated) => {
                        void this.applyLayout(updateCustomItem(this.plugin.settings, updated));
                    }).open();
                });

                const deleteBtn = controls.createDiv({ cls: 'ftn-insert-item-button is-danger', attr: { 'aria-label': t('settings.customCommand.delete') } });
                setIcon(deleteBtn, 'trash-2');
                deleteBtn.addEventListener('click', () => {
                    void this.applyLayout(removeCustomItem(this.plugin.settings, custom.id));
                });
            }

            row.addEventListener('dragstart', (event) => {
                event.dataTransfer?.setData('text/plain', String(index));
                row.addClass('is-dragging');
            });
            row.addEventListener('dragend', () => row.removeClass('is-dragging'));
            row.addEventListener('dragover', (event) => {
                event.preventDefault();
                row.addClass('is-drop-target');
            });
            row.addEventListener('dragleave', () => row.removeClass('is-drop-target'));
            row.addEventListener('drop', (event) => {
                event.preventDefault();
                row.removeClass('is-drop-target');
                const from = Number(event.dataTransfer?.getData('text/plain'));
                if (from === index) return;
                // applyOrder drops ids the layout no longer has: `order` was
                // captured when this row was drawn, and the list no longer
                // re-renders the whole tab, so a row deleted since would
                // otherwise be written back as a phantom entry.
                void this.applyLayout(applyOrder(this.plugin.settings, reorderIds(order, from, index)));
            });
        });

        listEl.scrollTop = scrollTop;
    }
}

