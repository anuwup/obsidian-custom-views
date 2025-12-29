import { Plugin, TFile, MarkdownView, Keymap, Notice } from "obsidian";
import { CustomViewsSettings, DEFAULT_SETTINGS, CustomViewsSettingTab } from "./settings";
import { checkRules } from "./matcher";
import { renderTemplate } from "./renderer";

const CUSTOM_VIEW_CLASS = "obsidian-custom-view-render";
const HIDE_MARKDOWN_CLASS = "obsidian-custom-view-hidden";

export default class CustomViewsPlugin extends Plugin {
	settings: CustomViewsSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CustomViewsSettingTab(this.app, this));

		this.addCommand({
			id: "enable-custom-views",
			name: "Enable Custom Views",
			checkCallback: (checking) => {
				if (checking) {
					return !this.settings.enabled;
				}

				this.setPluginState(true);
				return true;
			},
		});

		this.addCommand({
			id: "disable-custom-views",
			name: "Disable Custom Views",
			checkCallback: (checking) => {
				if (checking) {
					return this.settings.enabled;
				}

				this.setPluginState(false);
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => this.processActiveView(file))
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				const file = this.app.workspace.getActiveFile();
				this.processActiveView(file);
			})
		);

		this.addStyle();
	}

	async setPluginState(enabled: boolean) {
		this.settings.enabled = enabled;
		await this.saveSettings();

		new Notice(enabled ? "Custom Views Enabled" : "Custom Views Disabled");

		const file = this.app.workspace.getActiveFile();
		if (file) {
			this.processActiveView(file);
		}
	}

	addStyle() {
		const css = `
            .${HIDE_MARKDOWN_CLASS} .markdown-source-view,
            .${HIDE_MARKDOWN_CLASS} .markdown-preview-view {
                display: none !important;
            }

            .${CUSTOM_VIEW_CLASS} {
                padding: 30px;
                height: 100%;
                overflow-y: auto;
                width: 100%;
                position: absolute;
                top: 0;
                left: 0;
                background-color: var(--background-primary);
                z-index: 10;
            }

            .${HIDE_MARKDOWN_CLASS} {
                position: relative;
            }

            .${CUSTOM_VIEW_CLASS} .markdown-rendered-content {
                margin-top: 20px;
            }

            .${CUSTOM_VIEW_CLASS} .markdown-preview-section {
                padding: 0;
            }

            .${CUSTOM_VIEW_CLASS} .markdown-preview-section ul,
            .${CUSTOM_VIEW_CLASS} .markdown-preview-section ol {
                padding-left: 1.625em;
                margin-block-start: 1em;
                margin-block-end: 1em;
            }

            .${CUSTOM_VIEW_CLASS} .markdown-preview-section li {
                margin-block-start: 0.3em;
                margin-block-end: 0.3em;
            }

            .${CUSTOM_VIEW_CLASS} .markdown-preview-section li > ul,
            .${CUSTOM_VIEW_CLASS} .markdown-preview-section li > ol {
                margin-block-start: 0.3em;
                margin-block-end: 0.3em;
            }

            .${CUSTOM_VIEW_CLASS} .markdown-preview-section p {
                margin-block-start: 1em;
                margin-block-end: 1em;
            }

            .${CUSTOM_VIEW_CLASS} .markdown-preview-section p:first-child {
                margin-block-start: 0;
            }

            .${CUSTOM_VIEW_CLASS} .markdown-preview-section p:last-child {
                margin-block-end: 0;
            }
        `;
		const styleEl = document.createElement("style");
		styleEl.id = "custom-views-css";
		styleEl.textContent = css;
		document.head.appendChild(styleEl);
	}

	onunload() {
		const styleEl = document.getElementById("custom-views-css");
		if (styleEl) styleEl.remove();

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				this.restoreDefaultView(leaf.view);
			}
		});
	}

	async processActiveView(file: TFile | null) {
		if (!file) return;

		const leaf = this.app.workspace.getLeaf(false);
		if (!(leaf.view instanceof MarkdownView)) return;

		const view = leaf.view;

		if (!this.settings.enabled) {
			this.restoreDefaultView(view);
			return;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		let matchedTemplate = "";

		for (const viewConfig of this.settings.views) {
			const isMatch = checkRules(viewConfig.rules, file, cache?.frontmatter);
			if (isMatch) {
				matchedTemplate = viewConfig.template;
				break;
			}
		}

		if (!matchedTemplate) {
			this.restoreDefaultView(view);
			return;
		}

		const state = view.getState();
		const isTrueSourceMode = state.mode === 'source' && state.source === true;
		const isReadingMode = state.mode === 'preview';
		const isLivePreviewMode = state.mode === 'source' && state.source === false;

		if (isTrueSourceMode) {
			this.restoreDefaultView(view);
			return;
		}

		if (!this.settings.workInLivePreview) {
			if (!isReadingMode) {
				this.restoreDefaultView(view);
				return;
			}
		} else {
			if (!isReadingMode && !isLivePreviewMode) {
				this.restoreDefaultView(view);
				return;
			}
		}

		await this.injectCustomView(view, file, matchedTemplate);
	}

	async injectCustomView(view: MarkdownView, file: TFile, template: string) {
		const container = view.contentEl;
		let customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`) as HTMLElement;

		if (!customEl) {
			customEl = document.createElement("div");
			customEl.addClass(CUSTOM_VIEW_CLASS);
			container.appendChild(customEl);

			this.registerDomEvent(customEl, "click", (evt: MouseEvent) => {
				const target = evt.target as HTMLElement;
				const link = target.closest(".internal-link");

				if (link && link instanceof HTMLAnchorElement) {
					evt.preventDefault();
					const href = link.getAttribute("data-href") || link.getAttribute("href");

					if (href) {
						const newLeaf = Keymap.isModEvent(evt);
						this.app.workspace.openLinkText(href, file.path, newLeaf);
					}
				}
			});
		}

		await renderTemplate(this.app, template, file, customEl, this);
		container.addClass(HIDE_MARKDOWN_CLASS);
	}

	restoreDefaultView(view: MarkdownView) {
		const container = view.contentEl;
		container.removeClass(HIDE_MARKDOWN_CLASS);
		const customEl = container.querySelector(`.${CUSTOM_VIEW_CLASS}`);
		if (customEl) customEl.remove();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
