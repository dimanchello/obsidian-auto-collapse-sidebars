import { App, Plugin, PluginSettingTab, Setting, TFile, getAllTags } from 'obsidian';

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

const DEFAULT_STATE: CollapseState = {
	autoCollapsedLeft: false,
	autoCollapsedRight: false,
	activeFileWithTag: null,
};

interface StoredPluginData extends AutoCollapseSettings, CollapseState {}

export default class AutoCollapseSidebarsPlugin extends Plugin {
	settings: AutoCollapseSettings;
	private state: CollapseState = { ...DEFAULT_STATE };

	async onload() {
		await this.loadPluginData();

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

		// Listen to metadata resolve (ensures tag detection when cache is ready on cold start)
		this.registerEvent(
			this.app.metadataCache.on('resolve', (file) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.path === file.path) {
					this.handleLeafOrFileChange();
				}
			})
		);

		// Listen to file rename
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (this.state.activeFileWithTag === oldPath) {
					this.state.activeFileWithTag = file.path;
					this.savePluginData();
				}
			})
		);

		// Listen to file deletion
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (this.state.activeFileWithTag === file.path) {
					this.handleLeafOrFileChange();
				}
			})
		);

		// Initial check when Obsidian layout is ready
		this.app.workspace.onLayoutReady(() => {
			this.handleLeafOrFileChange(true);
		});
	}

	onunload() {
		// Restore sidebars if they were auto-collapsed by the plugin upon unloading
		this.restoreSidebarsIfAutoCollapsed();
	}

	private async handleLeafOrFileChange(isInitialLayoutCheck = false) {
		const activeFile = this.app.workspace.getActiveFile();
		const isTagged = activeFile ? this.hasTargetTag(activeFile, this.settings.triggerTag) : false;

		if (isTagged && activeFile) {
			const isAlreadyInTaggedSession = this.state.activeFileWithTag !== null;

			if (!isAlreadyInTaggedSession) {
				// We just entered a tagged note
				if (this.settings.collapseLeft) {
					const leftSplit = this.app.workspace.leftSplit;
					if (leftSplit) {
						if (!leftSplit.collapsed) {
							leftSplit.collapse();
							this.state.autoCollapsedLeft = true;
						} else if (isInitialLayoutCheck) {
							// Obsidian remembered a tagged note from previous session and opened it collapsed
							this.state.autoCollapsedLeft = true;
						} else {
							this.state.autoCollapsedLeft = false;
						}
					}
				}

				if (this.settings.collapseRight) {
					const rightSplit = this.app.workspace.rightSplit;
					if (rightSplit) {
						if (!rightSplit.collapsed) {
							rightSplit.collapse();
							this.state.autoCollapsedRight = true;
						} else if (isInitialLayoutCheck) {
							this.state.autoCollapsedRight = true;
						} else {
							this.state.autoCollapsedRight = false;
						}
					}
				}
			} else {
				// We were already in a tagged session (e.g. switched to another tagged note or resumed)
				if (this.settings.collapseLeft && this.state.autoCollapsedLeft) {
					const leftSplit = this.app.workspace.leftSplit;
					if (leftSplit && !leftSplit.collapsed) {
						leftSplit.collapse();
					}
				}
				if (this.settings.collapseRight && this.state.autoCollapsedRight) {
					const rightSplit = this.app.workspace.rightSplit;
					if (rightSplit && !rightSplit.collapsed) {
						rightSplit.collapse();
					}
				}
			}

			this.state.activeFileWithTag = activeFile.path;
			await this.savePluginData();
		} else {
			// We moved to an untagged note, empty tab, or no file
			if (this.state.activeFileWithTag !== null || this.state.autoCollapsedLeft || this.state.autoCollapsedRight) {
				this.restoreSidebarsIfAutoCollapsed();
				this.state.activeFileWithTag = null;
				await this.savePluginData();
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

	private hasTargetTag(file: TFile, targetTagSetting: string): boolean {
		if (!targetTagSetting) return false;

		// Support multiple comma/space separated tags in settings (e.g. "zen, focus, #deep-work")
		const rawTargets = targetTagSetting
			.split(/[, ]+/)
			.map((t) => t.trim().replace(/^#/, '').toLowerCase())
			.filter(Boolean);

		if (rawTargets.length === 0) return false;

		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return false;

		const checkTagMatch = (tagString: string): boolean => {
			const clean = tagString.trim().replace(/^#/, '').toLowerCase();
			if (!clean) return false;
			return rawTargets.some((target) => clean === target || clean.startsWith(target + '/'));
		};

		// 1. Check using Obsidian's official getAllTags API
		const allTags = getAllTags(cache);
		if (allTags) {
			for (const tag of allTags) {
				if (checkTagMatch(tag)) {
					return true;
				}
			}
		}

		// 2. Fallback check for inline tags
		if (cache.tags) {
			for (const t of cache.tags) {
				if (checkTagMatch(t.tag)) {
					return true;
				}
			}
		}

		// 3. Fallback check for frontmatter tags
		if (cache.frontmatter) {
			const fmTags = cache.frontmatter.tags ?? cache.frontmatter.tag;
			if (fmTags) {
				const list = Array.isArray(fmTags) ? fmTags : [fmTags];
				for (const item of list) {
					if (typeof item === 'string') {
						const subItems = item.split(/[, ]+/);
						for (const sub of subItems) {
							if (checkTagMatch(sub)) {
								return true;
							}
						}
					}
				}
			}
		}

		return false;
	}

	async loadPluginData() {
		const data: Partial<StoredPluginData> = (await this.loadData()) || {};

		this.settings = {
			triggerTag: data.triggerTag ?? DEFAULT_SETTINGS.triggerTag,
			collapseLeft: data.collapseLeft ?? DEFAULT_SETTINGS.collapseLeft,
			collapseRight: data.collapseRight ?? DEFAULT_SETTINGS.collapseRight,
		};

		this.state = {
			autoCollapsedLeft: data.autoCollapsedLeft ?? DEFAULT_STATE.autoCollapsedLeft,
			autoCollapsedRight: data.autoCollapsedRight ?? DEFAULT_STATE.autoCollapsedRight,
			activeFileWithTag: data.activeFileWithTag ?? DEFAULT_STATE.activeFileWithTag,
		};
	}

	async savePluginData() {
		const data: StoredPluginData = {
			...this.settings,
			...this.state,
		};
		await this.saveData(data);
	}

	async applySettingsUpdate() {
		await this.savePluginData();

		const activeFile = this.app.workspace.getActiveFile();
		const isTagged = activeFile ? this.hasTargetTag(activeFile, this.settings.triggerTag) : false;

		if (isTagged && activeFile) {
			const leftSplit = this.app.workspace.leftSplit;
			if (leftSplit) {
				if (!this.settings.collapseLeft && this.state.autoCollapsedLeft) {
					if (leftSplit.collapsed) leftSplit.expand();
					this.state.autoCollapsedLeft = false;
				} else if (this.settings.collapseLeft && !this.state.autoCollapsedLeft && !leftSplit.collapsed) {
					leftSplit.collapse();
					this.state.autoCollapsedLeft = true;
				}
			}

			const rightSplit = this.app.workspace.rightSplit;
			if (rightSplit) {
				if (!this.settings.collapseRight && this.state.autoCollapsedRight) {
					if (rightSplit.collapsed) rightSplit.expand();
					this.state.autoCollapsedRight = false;
				} else if (this.settings.collapseRight && !this.state.autoCollapsedRight && !rightSplit.collapsed) {
					rightSplit.collapse();
					this.state.autoCollapsedRight = true;
				}
			}

			this.state.activeFileWithTag = activeFile.path;
			await this.savePluginData();
		} else {
			if (this.state.activeFileWithTag !== null || this.state.autoCollapsedLeft || this.state.autoCollapsedRight) {
				this.restoreSidebarsIfAutoCollapsed();
				this.state.activeFileWithTag = null;
				await this.savePluginData();
			}
		}
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
			.setDesc('Tag that triggers collapsing sidebars (with or without #, e.g. zen or #zen). You can specify multiple tags separated by commas.')
			.addText((text) =>
				text
					.setPlaceholder('zen')
					.setValue(this.plugin.settings.triggerTag)
					.onChange(async (value) => {
						this.plugin.settings.triggerTag = value;
						await this.plugin.applySettingsUpdate();
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
						await this.plugin.applySettingsUpdate();
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
						await this.plugin.applySettingsUpdate();
					})
			);
	}
}
