import { Editor, Plugin } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { BlockPluginSettings, DEFAULT_SETTINGS, BlockPluginSettingTab } from './settings';
import { blockHandlesExtension } from './blockHandles';
import { handleLineField } from './handleGutter';
import { hideSyntaxExtension } from './hideSyntax';
import { blockSelectionExtension } from './blockSelection';
import { blockKeymapExtension } from './blockKeymap';
import { slashMenuExtension } from './slashMenu';
import { blockFoldExtension } from './blockFold';
import { dropParentTintField } from './dropParentTint';
import { showNotionBlockInsertMenu } from './notionInsertMenu';
import { t } from './locale/helpers';
import { bulletDepthExtension, resolveBulletMarkers } from './bulletDepth';
import { RELEASE_NOTES, shouldShowWhatsNew } from './whatsNew';
import { WhatsNewModal } from './whatsNewModal';
import { ExplorerDecor } from './explorerDecor';
import { ExplorerSort } from './explorerSort';
import { FolderNoteFooter, FolderNotes } from './folderNoteView';
import { PageHeaders } from './pageHeader';
import { importIconizeIcons } from './iconizeImport';
import { LinkIcons } from './linkIcons';
import { PageLinks } from './pageLinkView';
import { Breadcrumbs } from './breadcrumbs';
import { ExplorerAdd } from './explorerAdd';
import { registerPageOptions } from './pageOptions';
import { registerPageSwitcher } from './pageSwitcher';
import { registerSubpages } from './subpages';
import { pickTemplate } from './templates';
import { registerMentionSuggest } from './mentionSuggest';
import { registerLinkPaste } from './linkPaste';
import { registerNoteDrop } from './noteDropView';

export default class NotionBlock extends Plugin {
    settings: BlockPluginSettings;
    private explorerDecor: ExplorerDecor | null = null;
    private explorerSort: ExplorerSort | null = null;
    private folderNoteFooter: FolderNoteFooter | null = null;
    private pageHeaders: PageHeaders | null = null;
    private linkIcons: LinkIcons | null = null;
    private pageLinks: PageLinks | null = null;
    private breadcrumbs: Breadcrumbs | null = null;

    async onload() {
        const hadSavedData = await this.loadSettings();

        // CodeMirror 6 extensions: handles, selection, keys, menus, folding
        const editorExtensions = [
            blockHandlesExtension(this),
            hideSyntaxExtension(this),
            blockSelectionExtension(this),
            blockKeymapExtension(this),
            slashMenuExtension(this),
            blockFoldExtension(),
            bulletDepthExtension(() => this.bulletMarkers()),
            dropParentTintField,
            handleLineField,
        ];
        this.registerEditorExtension(editorExtensions);
        this.syncBulletClass();

        // Pages: folder notes, icons and covers. Each registers its own
        // events and checks its setting when they fire, so turning one off
        // takes effect without a reload.
        new FolderNotes(this);
        this.folderNoteFooter = new FolderNoteFooter(this);
        this.explorerDecor = new ExplorerDecor(this);
        this.explorerSort = new ExplorerSort(this);
        this.pageHeaders = new PageHeaders(this);
        this.linkIcons = new LinkIcons(this);
        this.pageLinks = new PageLinks(this);
        this.breadcrumbs = new Breadcrumbs(this);
        new ExplorerAdd(this);
        registerPageOptions(this);
        registerPageSwitcher(this);
        registerSubpages(this);
        registerMentionSuggest(this);
        registerLinkPaste(this);
        registerNoteDrop(this);
        this.addCommand({
            id: 'apply-page-template',
            name: 'Apply page template',
            checkCallback: (dryRun: boolean) => {
                const note = this.app.workspace.getActiveFile();
                if (!note || note.extension !== 'md' || !this.settings.enabled) return false;
                if (!dryRun) pickTemplate(this, note);
                return true;
            },
        });
        this.addCommand({
            id: 'import-iconize-icons',
            name: 'Import icons from Iconize',
            callback: () => void importIconizeIcons(this),
        });

        // The same menu the "+" handle and the trigger character open, exposed
        // as a command so it can be given a real hotkey under Settings →
        // Hotkeys rather than only a typed character.
        this.addCommand({
            id: 'open-insert-menu',
            name: t('command.openInsertMenu'),
            editorCallback: (editor: Editor) => this.openInsertMenuAtCursor(editor),
        });

        this.addCommand({
            id: 'show-whats-new',
            name: "Show what's new",
            callback: () => this.openWhatsNew(),
        });

        // Add settings tab
        this.addSettingTab(new BlockPluginSettingTab(this.app, this));

        // After layout, so the card opens over a ready workspace rather than
        // racing the editor being restored underneath it.
        this.app.workspace.onLayoutReady(() => this.maybeShowWhatsNew(hadSavedData));
    }

    onunload() {
        document.body.removeClass('ftn-bullet-depth');
    }

    /** The marker sequence while bullet depth markers are on, null while off. */
    bulletMarkers(): readonly string[] | null {
        const s = this.settings;
        if (!s.enabled || !s.bulletDepth) return null;
        return resolveBulletMarkers(s.bulletOrder, s.bulletHidden);
    }

    /**
     * The ● ○ ▪ styling is plain CSS, so it is switched by a body class rather
     * than by registering anything: off, the stylesheet matches nothing.
     */
    private syncBulletClass(): void {
        // chisle: main window only. A popout window keeps Obsidian's own
        // bullets, though its file markers are still rewritten.
        document.body.toggleClass('ftn-bullet-depth', this.bulletMarkers() !== null);
    }

    private maybeShowWhatsNew(hadSavedData: boolean): void {
        const current = this.manifest.version;
        if (shouldShowWhatsNew(hadSavedData, this.settings.lastSeenVersion, current, RELEASE_NOTES.version)) {
            this.openWhatsNew();
            return;
        }
        // A fresh install, or a release without notes of its own: record it,
        // so the next update is measured from here and the card shows then.
        if (this.settings.lastSeenVersion !== current) void this.markWhatsNewSeen();
    }

    private openWhatsNew(): void {
        new WhatsNewModal(this.app, RELEASE_NOTES, () => void this.markWhatsNewSeen()).open();
    }

    private async markWhatsNewSeen(): Promise<void> {
        this.settings.lastSeenVersion = this.manifest.version;
        await this.writeSettings();
    }

    private openInsertMenuAtCursor(editor: Editor): void {
        const view = (editor as unknown as { cm?: EditorView }).cm;
        if (!view) return;

        const head = view.state.selection.main.head;
        const coords = view.coordsAtPos(head);
        if (!coords) return;

        showNotionBlockInsertMenu(
            this,
            view,
            view.state.doc.lineAt(head).number,
            { x: coords.left, y: coords.bottom + 6 },
            { avoid: { top: coords.top, bottom: coords.bottom }, keepEditorFocus: true }
        );
    }

    /** Returns whether saved settings existed, which is how an update is told from a fresh install. */
    async loadSettings(): Promise<boolean> {
        const data = await this.loadData() as Partial<BlockPluginSettings> | null;
        this.settings = { ...DEFAULT_SETTINGS, ...data };
        return data !== null;
    }

    /** Writes settings to disk without the refresh saveSettings does. */
    private writeSettings(): Promise<void> {
        return this.saveData(this.settings);
    }

    async saveSettings() {
        await this.writeSettings();
        this.syncBulletClass();
        this.explorerDecor?.refresh();
        this.explorerSort?.refresh();
        this.folderNoteFooter?.update();
        this.pageHeaders?.update();
        this.linkIcons?.update();
        this.pageLinks?.update();
        this.breadcrumbs?.update();
        // Notify editor extensions that settings have changed
        this.app.workspace.updateOptions();
    }
}
