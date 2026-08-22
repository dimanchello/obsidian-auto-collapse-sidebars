import { App, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';

interface AutoCollapseSettings {
	triggerTag: string;
	collapseLeft: boolean;
	collapseRight: boolean;
}

const DEFAULT_SETTINGS: AutoCollapseSettings = {
	triggerTag: 'zen',
	collapseLeft: true,
	collapseRight: true,
};

interface CollapseState {
	autoCollapsedLeft: boolean;
	autoCollapsedRight: boolean;
	activeFileWithTag: string | null;
}

export default class AutoCollapseSidebarsPlugin extends Plugin {
	settings: AutoCollapseSettings;
	private state: CollapseState = {
		autoCollapsedLeft: false,
		autoCollapsedRight: false,
		activeFileWithTag: null,
	};

	async onload() {
		await this.loadSettings();

		// Add settings tab in Obsidian settings
		this.addSettingTab(new AutoCollapseSettingTab(this.app, this));

		// Listen to active leaf/tab changes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.handleLeafOrFileChange();
			})
		);

		// Listen to metadata changes (e.g. user adds/removes tag while editing)
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.path === file.path) {
					this.handleLeafOrFileChange();
				}
			})
		);

		// Initial check when Obsidian layout is ready
		this.app.workspace.onLayoutReady(() => {
			this.handleLeafOrFileChange();
		});
	}

	onunload() {
		// Restore sidebars if they were auto-collapsed by the plugin upon unloading
		this.restoreSidebarsIfAutoCollapsed();
	}

	private handleLeafOrFileChange() {
		const activeFile = this.app.workspace.getActiveFile();
		const isTagged = activeFile ? this.hasTargetTag(activeFile, this.settings.triggerTag) : false;

		if (isTagged && activeFile) {
			// If we just entered a tagged note (and were not in a tagged note previously)
			if (!this.state.activeFileWithTag) {
				// Collapse left sidebar if configured and currently open
				if (this.settings.collapseLeft) {
					const leftSplit = this.app.workspace.leftSplit;
					if (leftSplit && !leftSplit.collapsed) {
						leftSplit.collapse();
						this.state.autoCollapsedLeft = true;
					} else {
						this.state.autoCollapsedLeft = false;
					}
				}

				// Collapse right sidebar if configured and currently open
				if (this.settings.collapseRight) {
					const rightSplit = this.app.workspace.rightSplit;
					if (rightSplit && !rightSplit.collapsed) {
						rightSplit.collapse();
						this.state.autoCollapsedRight = true;
					} else {
						this.state.autoCollapsedRight = false;
					}
				}
			}
			this.state.activeFileWithTag = activeFile.path;
		} else {
			// We moved to an untagged note, empty tab, or no file
			if (this.state.activeFileWithTag) {
				this.restoreSidebarsIfAutoCollapsed();
				this.state.activeFileWithTag = null;
			}
		}
	}

	private restoreSidebarsIfAutoCollapsed() {
		if (this.state.autoCollapsedLeft) {
			const leftSplit = this.app.workspace.leftSplit;
			if (leftSplit && leftSplit.collapsed) {
				leftSplit.expand();
			}
			this.state.autoCollapsedLeft = false;
		}

		if (this.state.autoCollapsedRight) {
			const rightSplit = this.app.workspace.rightSplit;
			if (rightSplit && rightSplit.collapsed) {
				rightSplit.expand();
			}
			this.state.autoCollapsedRight = false;
		}
	}

	private hasTargetTag(file: TFile, targetTag: string): boolean {
		if (!targetTag) return false;
		const normalizedTarget = targetTag.trim().replace(/^#/, '').toLowerCase();
		if (!normalizedTarget) return false;

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return false;

		// 1. Check inline tags in note body
		if (cache.tags) {
			for (const t of cache.tags) {
				const tagClean = t.tag.replace(/^#/, '').toLowerCase();
				if (tagClean === normalizedTarget || tagClean.startsWith(normalizedTarget + '/')) {
					return true;
				}
			}
		}

		// 2. Check frontmatter tags
		if (cache.frontmatter) {
			const fmTags = cache.frontmatter.tags ?? cache.frontmatter.tag;
			if (fmTags) {
				const list = Array.isArray(fmTags) ? fmTags : [fmTags];
				for (const item of list) {
					if (typeof item === 'string') {
						const tagClean = item.trim().replace(/^#/, '').toLowerCase();
						if (tagClean === normalizedTarget || tagClean.startsWith(normalizedTarget + '/')) {
							return true;
						}
					}
				}
			}
		}

		return false;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.handleLeafOrFileChange();
	}
}

class AutoCollapseSettingTab extends PluginSettingTab {
	plugin: AutoCollapseSidebarsPlugin;

	constructor(app: App, plugin: AutoCollapseSidebarsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Auto Collapse Sidebars Settings' });

		new Setting(containerEl)
			.setName('Trigger Tag')
			.setDesc('Tag that triggers collapsing sidebars (with or without #, e.g. zen or #zen)')
			.addText((text) =>
				text
					.setPlaceholder('zen')
					.setValue(this.plugin.settings.triggerTag)
					.onChange(async (value) => {
						this.plugin.settings.triggerTag = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Collapse Left Sidebar')
			.setDesc('Automatically collapse file explorer and left sidebar')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.collapseLeft)
					.onChange(async (value) => {
						this.plugin.settings.collapseLeft = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Collapse Right Sidebar')
			.setDesc('Automatically collapse right sidebar (properties, backlinks, outline)')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.collapseRight)
					.onChange(async (value) => {
						this.plugin.settings.collapseRight = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
