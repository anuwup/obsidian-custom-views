import { App, PluginSettingTab, Setting, ButtonComponent, TextComponent, setIcon, Menu, TFile } from "obsidian";
import CustomViewsPlugin from "./main";
import { ViewConfig, FilterGroup, Filter, FilterOperator, FilterConjunction } from "./types";

// --- CONSTANTS & ICONS ---

type PropertyType = "text" | "number" | "date" | "datetime" | "list" | "checkbox" | "unknown";

const TYPE_ICONS: Record<PropertyType, string> = {
	text: "text",           // Text
	number: "binary",            // Number
	date: "calendar",          // Date
	datetime: "clock",         // Datetime
	list: "list",              // List/Tags
	checkbox: "check-square",  // Boolean
	unknown: "help-circle"
};

// Operators specific to types
const OPERATORS: Record<string, string[]> = {
	text: ["contains", "does not contain", "is", "is not", "starts with", "ends with", "is empty", "is not empty"],
	list: ["contains", "does not contain", "is empty", "is not empty"],
	number: ["=", "≠", "<", "≤", ">", "≥", "is empty", "is not empty"],
	date: ["on", "not on", "before", "on or before", "after", "on or after", "is empty", "is not empty"],
	checkbox: ["is"] // true/false
};

const DEFAULT_RULES: FilterGroup = {
	type: "group",
	operator: "AND",
	conditions: [
		{ type: "filter", field: "file.name", operator: "contains", value: "" }
	]
};

// --- SETTINGS TAB ---

export interface CustomViewsSettings {
	enabled: boolean;
	workInLivePreview: boolean;
	views: ViewConfig[];
}

export const DEFAULT_SETTINGS: CustomViewsSettings = {
	enabled: true,
	workInLivePreview: true,
	views: [
		{
			id: 'default-1',
			name: 'Movie Card',
			rules: JSON.parse(JSON.stringify(DEFAULT_RULES)),
			template: "<h1>{{file.basename}}</h1>"
		}
	]
};

export class CustomViewsSettingTab extends PluginSettingTab {
	plugin: CustomViewsPlugin;

	constructor(app: App, plugin: CustomViewsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Inject CSS for the custom popovers
		containerEl.createEl("style", {
			text: `

                .cv-popover-search {
                    padding: 8px;
                    border-bottom: 1px solid var(--background-modifier-border);
                }
                .cv-popover-search input {
                    width: 100%;
                }

                .cv-popover-item:hover, .cv-popover-item.is-selected {
                    background-color: var(--background-modifier-hover);
                }
                .cv-popover-content {
                    display: flex;
                    align-items: center;
                    flex: 1;
                    overflow: hidden;
                }

                .cv-popover-label {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .cv-popover-check {
                    margin-left: 8px;
                    opacity: 0.5;
                    flex-shrink: 0;
                }





            `
		});

		containerEl.createEl("h2", { text: "Settings" });

		// Work in Live Preview Toggle
		new Setting(containerEl)
			.setName("Work in Live Preview")
			.setDesc("If off: custom views only work in reading view. If on: custom views work in both live preview and reading view.")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.workInLivePreview)
				.onChange(async (value) => {
					this.plugin.settings.workInLivePreview = value;
					await this.plugin.saveSettings();
					// Refresh the current view to apply the change
					const file = this.app.workspace.getActiveFile();
					if (file) {
						this.plugin.processActiveView(file);
					}
				}));

		containerEl.createEl("h2", { text: "Views Configuration" });

		// Add New View
		new Setting(containerEl)
			.addButton(btn => btn
				.setButtonText("Add New View")
				.setCta()
				.onClick(async () => {
					this.plugin.settings.views.push({
						id: `${Date.now()}`,
						name: "New View",
						rules: JSON.parse(JSON.stringify(DEFAULT_RULES)),
						template: "<h1>{{file.basename}}</h1>"
					});
					await this.plugin.saveSettings();
					this.display();
				}));

		this.plugin.settings.views.forEach((view, index) => {
			this.renderViewConfig(containerEl, view, index);
		});
	}

	renderViewConfig(container: HTMLElement, view: ViewConfig, index: number) {
		const wrapper = container.createDiv({ cls: "cv-custom-view-box" });

		// --- 1. Filter Builder (Pass Delete Callback) ---
		const rulesContainer = wrapper.createDiv({ cls: "cv-bases-query-container" });

		const builder = new FilterBuilder(this.plugin, view.rules,
			async () => { await this.plugin.saveSettings(); },
			() => { rulesContainer.empty(); builder.render(rulesContainer); },
			// OnDeleteView Callback
			async () => {
				this.plugin.settings.views.splice(index, 1);
				await this.plugin.saveSettings();
				this.display();
			}
		);
		builder.render(rulesContainer);

		// --- 2. Template Editor ---
		const htmlTemplateContainer = wrapper.createDiv({ cls: "cv-bases-template-container" });
		htmlTemplateContainer.createEl("div", { cls: "cv-bases-section-header", text: "HTML Template" });
		const ta = new TextComponent(htmlTemplateContainer);
		const textarea = htmlTemplateContainer.createEl("textarea", {
			cls: "cv-textarea",
			text: view.template
		});

		ta.inputEl.replaceWith(textarea);
		wrapper.querySelector("textarea")?.addEventListener("input", async (e: any) => {
			view.template = e.target.value;
			await this.plugin.saveSettings();
		});
	}
}

// ==========================================================
// FILTER BUILDER (Enhanced)
// ==========================================================

interface PropertyDef {
	key: string;
	type: PropertyType;
}

class FilterBuilder {
	plugin: CustomViewsPlugin;
	root: FilterGroup;
	onSave: () => void;
	onRefresh: () => void;
	onDeleteView?: () => void; // New optional callback
	availableProperties: PropertyDef[];

	constructor(plugin: CustomViewsPlugin, root: FilterGroup, onSave: () => void, onRefresh: () => void, onDeleteView?: () => void) {
		this.plugin = plugin;
		this.root = root;
		this.onSave = onSave;
		this.onRefresh = onRefresh;
		this.onDeleteView = onDeleteView;
		this.availableProperties = this.scanVaultProperties();
	}

	/**
	 * Scans the vault to find properties and INFER their types.
	 */
	scanVaultProperties(): PropertyDef[] {
		const app = this.plugin.app;
		const propMap = new Map<string, PropertyType>();

		// 1. System Properties
		propMap.set("file.name", "text");
		propMap.set("file.path", "text");
		propMap.set("file.folder", "text");
		propMap.set("file.size", "number");
		propMap.set("file.ctime", "datetime");
		propMap.set("file.mtime", "datetime");
		propMap.set("tags", "list");

		// 2. Scan Frontmatter
		const files = app.vault.getMarkdownFiles();
		for (const file of files) {
			const cache = app.metadataCache.getFileCache(file);
			if (cache?.frontmatter) {
				for (const key of Object.keys(cache.frontmatter)) {
					if (key === "position") continue;
					if (propMap.has(key) && propMap.get(key) !== "unknown") continue;
					const val = cache.frontmatter[key];
					const type = this.inferType(val);
					propMap.set(key, type);
				}
			}
		}

		return Array.from(propMap.entries())
			.map(([key, type]) => ({ key, type }))
			.sort((a, b) => a.key.localeCompare(b.key));
	}

	inferType(val: any): PropertyType {
		if (val === null || val === undefined) return "unknown";
		if (Array.isArray(val)) return "list";
		if (typeof val === "number") return "number";
		if (typeof val === "boolean") return "checkbox";
		if (typeof val === "string") {
			if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return "date";
			if (/^\d{4}-\d{2}-\d{2}T/.test(val)) return "datetime";
		}
		return "text";
	}

	getPropertyType(key: string): PropertyType {
		const def = this.availableProperties.find(p => p.key === key);
		return def ? def.type : "text";
	}

	render(container: HTMLElement) {
		this.renderGroup(container, this.root, true);
	}

	renderGroup(container: HTMLElement, group: FilterGroup, isRoot: boolean = false) {
		const groupDiv = container.createDiv({ cls: "cv-filter-group" });
		const header = groupDiv.createDiv({ cls: "cv-filter-group-header" });

		// --- CONJUNCTION DROPDOWN (Native Select) ---
		const labelMap: Record<string, string> = {
			"AND": "All the following are true",
			"OR": "Any of the following are true",
			"NOR": "None of the following are true"
		};

		// Map internal values to select values
		const valueMap: Record<string, string> = {
			"AND": "and",
			"OR": "or",
			"NOR": "not"
		};
		const reverseValueMap: Record<string, FilterConjunction> = {
			"and": "AND",
			"or": "OR",
			"not": "NOR"
		};

		const select = header.createEl("select", {
			cls: "conjunction dropdown",
			attr: { value: valueMap[group.operator] || "and" }
		});

		// Add options
		select.createEl("option", {
			attr: { value: "and" },
			text: labelMap["AND"]
		});
		select.createEl("option", {
			attr: { value: "or" },
			text: labelMap["OR"]
		});
		select.createEl("option", {
			attr: { value: "not" },
			text: labelMap["NOR"]
		});

		// Set initial value
		select.value = valueMap[group.operator] || "and";

		// Handle change
		select.onchange = () => {
			group.operator = reverseValueMap[select.value];
			this.onSave();
			this.onRefresh();
		};

		// --- FILTER GROUP HEADER ACTIONS ---
		const headerActionsDiv = header.createDiv({ cls: "cv-filter-group-header-actions" });

		// --- INSERT VIEW HEADER HERE (If Root) ---
		if (isRoot && this.onDeleteView) {
			const viewHeader = headerActionsDiv.createDiv({ cls: "cv-custom-view-box-header" });
			viewHeader.style.marginLeft = "auto"; // Push to right

			const delBtn = new ButtonComponent(viewHeader)
				.setIcon("trash")
				.setTooltip("Delete View")
				.onClick(() => {
					if (this.onDeleteView) this.onDeleteView();
				});
		}
		// ----------------------------------------

		// Statements
		const statementsContainer = groupDiv.createDiv({ cls: "cv-filter-group-statements" });
		group.conditions.forEach((condition, index) => {
			const rowWrapper = statementsContainer.createDiv({ cls: "cv-filter-row" });
			const conjLabel = rowWrapper.createSpan({ cls: "cv-conjunction-text" });
			if (index === 0) {
				conjLabel.innerText = "where";
			} else {
				// Use "or" for OR and NOR, "and" for AND
				conjLabel.innerText = (group.operator === "OR" || group.operator === "NOR") ? "or" : "and";
			}

			if (condition.type === "group") {
				rowWrapper.addClass("mod-group");
				this.renderGroup(rowWrapper, condition as FilterGroup);

				// Group Delete Btn (Only for subgroups)
				const h = rowWrapper.querySelector(".cv-filter-group-header");
				if (h) {
					// Subgroups don't have the main view delete button, so we add the group trash icon
					const d = h.createDiv({ cls: "cv-clickable-icon" });
					// Push to right if header is flex
					d.style.marginLeft = "auto";
					setIcon(d, "trash-2");
					d.onclick = (e) => { e.stopPropagation(); group.conditions.splice(index, 1); this.onSave(); this.onRefresh(); };
				}
			} else {
				this.renderFilterRow(rowWrapper, condition as Filter, group, index);
			}
		});

		// Add Actions
		const actionsDiv = groupDiv.createDiv({ cls: "cv-filter-group-actions" });
		this.createSimpleBtn(actionsDiv, "plus", "Add filter", () => {
			group.conditions.push({ type: "filter", field: "file.name", operator: "contains", value: "" });
			this.onSave(); this.onRefresh();
		});
		this.createSimpleBtn(actionsDiv, "plus", "Add group", () => {
			group.conditions.push({ type: "group", operator: "AND", conditions: [] });
			this.onSave(); this.onRefresh();
		});
	}

	renderFilterRow(row: HTMLElement, filter: Filter, parentGroup: FilterGroup, index: number) {
		const statement = row.createDiv({ cls: "cv-filter-statement" });

		// --- 1. PROPERTY SELECTOR ---
		const currentType = this.getPropertyType(filter.field);

		const propertyBtn = statement.createDiv({ cls: "cv-combobox-button", attr: { tabindex: "-1" } });

		// Add icon
		if (TYPE_ICONS[currentType]) {
			const icon = propertyBtn.createDiv({ cls: "cv-combobox-button-icon" });
			setIcon(icon, TYPE_ICONS[currentType] || "pilcrow");
		}

		// Add label
		const lbl = propertyBtn.createDiv({ cls: "cv-combobox-button-label" });
		lbl.innerText = filter.field;
		setIcon(propertyBtn.createDiv({ cls: "cv-combobox-button-chevron" }), "chevrons-up-down");

		propertyBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			// Prevent the button from stealing focus after dropdown opens
			propertyBtn.blur();
			// Make button unfocusable
			propertyBtn.setAttribute("tabindex", "-1");
			this.createSearchableDropdown(
				propertyBtn,
				this.availableProperties.map(p => ({
					label: p.key,
					value: p.key,
					icon: TYPE_ICONS[p.type] || "pilcrow"
				})),
				filter.field,
				(newVal) => {
					filter.field = newVal;
					const newType = this.getPropertyType(newVal);
					const validOps = OPERATORS[newType === "datetime" ? "date" : newType] || OPERATORS["text"];
					filter.operator = validOps[0] as FilterOperator;
					filter.value = "";
					this.onSave();
					this.onRefresh();
				}
			);
		};

		// --- 2. OPERATOR SELECTOR ---
		let opsKey = currentType;
		if (currentType === "datetime") opsKey = "date";
		if (currentType === "unknown") opsKey = "text";
		if (!OPERATORS[opsKey]) opsKey = "text";

		const validOps = OPERATORS[opsKey];

		const operatorBtn = statement.createDiv({ cls: "cv-combobox-button", attr: { tabindex: "-1" } });

		// Add label
		const opLbl = operatorBtn.createDiv({ cls: "cv-combobox-button-label" });
		opLbl.innerText = filter.operator;
		setIcon(operatorBtn.createDiv({ cls: "cv-combobox-button-chevron" }), "chevrons-up-down");

		operatorBtn.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			// Prevent the button from stealing focus after dropdown opens
			operatorBtn.blur();
			// Make button unfocusable
			operatorBtn.setAttribute("tabindex", "-1");
			this.createSearchableDropdown(
				operatorBtn,
				validOps.map(op => ({ label: op, value: op })),
				filter.operator,
				(newVal) => {
					filter.operator = newVal as FilterOperator;
					this.onSave();
					this.onRefresh();
				}
			);
		};

		// --- 3. VALUE INPUT ---
		if (!["is empty", "is not empty"].includes(filter.operator)) {
			const rhs = statement.createDiv({ cls: "cv-filter-rhs-container" });

			if (currentType === "date" || currentType === "datetime") {
				const input = rhs.createEl("input", {
					type: currentType === "datetime" ? "datetime-local" : "date",
					value: filter.value,
					attr: {
						max: currentType === "datetime" ? "9999-12-31T23:59" : "9999-12-31"
					}
				});
				input.addClass("cv-multi-select-input");
				input.oninput = () => { filter.value = input.value; this.onSave(); };
			} else if (currentType === "number") {
				const input = rhs.createEl("input", { type: "number", value: filter.value });
				input.addClass("cv-multi-select-input");
				input.oninput = () => { filter.value = input.value; this.onSave(); };
			} else {
				const input = rhs.createEl("input", { type: "text", value: filter.value });
				input.addClass("cv-multi-select-input");
				input.placeholder = "Value...";
				input.oninput = () => { filter.value = input.value; this.onSave(); };
			}

			// --- DELETE BUTTON (inside the value input container) ---
			const delBtn = rhs.createDiv({ cls: "cv-clickable-icon cv-filter-delete-inside" });
			setIcon(delBtn, "trash-2");
			delBtn.onclick = (e) => {
				e.stopPropagation();
				parentGroup.conditions.splice(index, 1);
				this.onSave();
				this.onRefresh();
			};
		} else {
			// For "is empty" / "is not empty", delete button goes in actions
			const actions = row.createDiv({ cls: "cv-filter-row-actions" });
			const delBtn = actions.createDiv({ cls: "cv-clickable-icon" });
			setIcon(delBtn, "trash-2");
			delBtn.onclick = (e) => {
				e.stopPropagation();
				parentGroup.conditions.splice(index, 1);
				this.onSave();
				this.onRefresh();
			};
		}
	}


	/**
	 * Creates a searchable dropdown container below the anchor element
	 */
	createSearchableDropdown(
		anchorEl: HTMLElement,
		items: { label: string, value: string, icon?: string }[],
		selectedValue: string,
		onSelect: (val: string) => void
	) {
		// Remove any existing dropdowns
		document.querySelectorAll('.cv-suggestion-container').forEach(el => el.remove());

		// Create main container
		const container = document.body.createDiv({ cls: "cv-suggestion-container cv-combobox" });
		const rect = anchorEl.getBoundingClientRect();
		container.style.left = `${rect.left}px`;
		container.style.top = `${rect.bottom + 5}px`;

		// Create search input container
		const searchInputContainer = container.createDiv({ cls: "cv-search-input-container" });
		const searchInput = searchInputContainer.createEl("input", {
			type: "search",
			placeholder: "Search...",
			attr: { enterkeyhint: "search", spellcheck: "false" }
		});
		const clearButton = searchInputContainer.createDiv({ cls: "cv-search-input-clear-button" });

		// Create suggestions container
		const suggestionsContainer = container.createDiv({ cls: "cv-suggestion" });

		const render = (list: typeof items) => {
			suggestionsContainer.empty();

			// Helper to remove cv-is-selected from all items
			const clearSelected = () => {
				suggestionsContainer.querySelectorAll('.cv-suggestion-item').forEach(el => {
					el.removeClass('cv-is-selected');
				});
			};

			list.forEach(item => {
				const suggestionItem = suggestionsContainer.createDiv({ cls: "cv-suggestion-item cv-mod-complex cv-mod-toggle" });
				if (item.value === selectedValue) {
					suggestionItem.addClass("cv-is-selected");
				}

				// Check icon (for selected item)
				if (item.value === selectedValue) {
					const checkIcon = suggestionItem.createDiv({ cls: "cv-suggestion-icon cv-mod-checked" });
					setIcon(checkIcon, "check");
				}

				// Main icon
				const iconDiv = suggestionItem.createDiv({ cls: "cv-suggestion-icon" });
				const flair = iconDiv.createSpan({ cls: "cv-suggestion-flair" });
				if (item.icon) {
					setIcon(flair, item.icon);
				}

				// Content
				const content = suggestionItem.createDiv({ cls: "cv-suggestion-content" });
				content.createDiv({ cls: "cv-suggestion-title", text: item.label });

				// Aux (for additional info if needed)
				const aux = suggestionItem.createDiv({ cls: "cv-suggestion-aux" });

				// Hover handlers
				suggestionItem.onmouseenter = () => {
					clearSelected();
					suggestionItem.addClass('cv-is-selected');
				};

				suggestionItem.onclick = (evt) => {
					evt.stopPropagation();
					onSelect(item.value);
					container.remove();
				};
			});
		};

		// Search functionality
		// Blur the anchor button and make it unfocusable to prevent it from stealing focus
		if (anchorEl instanceof HTMLElement) {
			anchorEl.blur();
			anchorEl.setAttribute("tabindex", "-1");
			// Prevent focus events on the button
			anchorEl.addEventListener("focus", (e) => {
				// #region agent log
				fetch('http://127.0.0.1:7242/ingest/449950d1-16ff-4fc2-beef-90db3e564ad1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'settings.ts:515', message: 'Preventing button focus', data: { target: (e.target as HTMLElement)?.tagName }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'post-fix', hypothesisId: 'E' }) }).catch(() => { });
				// #endregion
				e.preventDefault();
				e.stopPropagation();
				anchorEl.blur();
				searchInput.focus();
			}, { capture: true });
		}
		// Use setTimeout to ensure the button has lost focus before focusing the input
		setTimeout(() => {
			// #region agent log
			fetch('http://127.0.0.1:7242/ingest/449950d1-16ff-4fc2-beef-90db3e564ad1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'settings.ts:525', message: 'Focusing input after delay', data: { documentActiveElement: document.activeElement?.tagName, containerInDOM: container.isConnected }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'post-fix', hypothesisId: 'E' }) }).catch(() => { });
			// #endregion
			searchInput.focus();
			// #region agent log
			fetch('http://127.0.0.1:7242/ingest/449950d1-16ff-4fc2-beef-90db3e564ad1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'settings.ts:527', message: 'After focus call', data: { documentActiveElement: document.activeElement?.tagName, isInput: document.activeElement === searchInput }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'post-fix', hypothesisId: 'E' }) }).catch(() => { });
			// #endregion
		}, 10);
		container.addClass("cv-has-input-focus");
		searchInput.addEventListener("input", (e: any) => {
			const val = e.target.value.toLowerCase();
			const filtered = items.filter(i => i.label.toLowerCase().includes(val) || i.value.toLowerCase().includes(val));
			render(filtered);
		});
		searchInput.addEventListener("focus", (e) => {
			// #region agent log
			const relatedTarget = (e as FocusEvent).relatedTarget;
			const relatedTargetTagName = relatedTarget instanceof HTMLElement ? relatedTarget.tagName : null;
			fetch('http://127.0.0.1:7242/ingest/449950d1-16ff-4fc2-beef-90db3e564ad1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'settings.ts:513', message: 'Input focus event', data: { target: document.activeElement?.tagName, relatedTarget: relatedTargetTagName }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }) }).catch(() => { });
			// #endregion
			container.addClass("cv-has-input-focus");
		});
		searchInput.addEventListener("blur", (e) => {
			// #region agent log
			const relatedTarget = (e as FocusEvent).relatedTarget;
			const relatedTargetTagName = relatedTarget instanceof HTMLElement ? relatedTarget.tagName : null;
			fetch('http://127.0.0.1:7242/ingest/449950d1-16ff-4fc2-beef-90db3e564ad1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'settings.ts:516', message: 'Input blur event', data: { target: document.activeElement?.tagName, relatedTarget: relatedTargetTagName, containerStillExists: container.isConnected }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'E' }) }).catch(() => { });
			// #endregion
			container.removeClass("cv-has-input-focus");
		});
		searchInput.addEventListener("click", (e) => {
			// #region agent log
			fetch('http://127.0.0.1:7242/ingest/449950d1-16ff-4fc2-beef-90db3e564ad1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'settings.ts:520', message: 'Input click event', data: { target: (e.target as HTMLElement)?.tagName, containerContainsTarget: container.contains(e.target as Node) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
			// #endregion
			e.stopPropagation();
		});
		searchInput.addEventListener("mousedown", (e) => {
			// #region agent log
			fetch('http://127.0.0.1:7242/ingest/449950d1-16ff-4fc2-beef-90db3e564ad1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'settings.ts:524', message: 'Input mousedown event', data: { target: (e.target as HTMLElement)?.tagName }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'C' }) }).catch(() => { });
			// #endregion
			e.stopPropagation();
		});

		// Clear button functionality
		clearButton.onclick = () => {
			searchInput.value = "";
			searchInput.focus();
			render(items);
		};

		// Initial render
		render(items);
		// #region agent log
		fetch('http://127.0.0.1:7242/ingest/449950d1-16ff-4fc2-beef-90db3e564ad1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'settings.ts:527', message: 'After render', data: { documentActiveElement: document.activeElement?.tagName, isInput: document.activeElement === searchInput }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'B' }) }).catch(() => { });
		// #endregion

		// Close handler
		const closeHandler = (evt: MouseEvent) => {
			// #region agent log
			fetch('http://127.0.0.1:7242/ingest/449950d1-16ff-4fc2-beef-90db3e564ad1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'settings.ts:531', message: 'closeHandler triggered', data: { targetTag: (evt.target as HTMLElement)?.tagName, targetClass: (evt.target as HTMLElement)?.className, isSearchInput: evt.target === searchInput, containerContains: container.contains(evt.target as Node), willClose: !container.contains(evt.target as Node) && evt.target !== anchorEl && !anchorEl.contains(evt.target as Node) }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
			// #endregion
			if (!container.contains(evt.target as Node) && evt.target !== anchorEl && !anchorEl.contains(evt.target as Node)) {
				container.remove();
				document.removeEventListener("click", closeHandler);
			}
		};
		setTimeout(() => {
			// #region agent log
			fetch('http://127.0.0.1:7242/ingest/449950d1-16ff-4fc2-beef-90db3e564ad1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'settings.ts:537', message: 'Registering closeHandler', data: { documentActiveElement: document.activeElement?.tagName }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run1', hypothesisId: 'A' }) }).catch(() => { });
			// #endregion
			document.addEventListener("click", closeHandler);
		}, 0);
	}

	/**
	 * Core method to spawn the floating menu (Shared by Conjunction and Dropdowns)
	 */
	createPopover(
		anchorEl: HTMLElement,
		items: { label: string, value: string, icon?: string }[],
		onSelect: (val: string) => void,
		selectedValue?: string,
		enableSearch: boolean = false
	) {
		document.querySelectorAll('.cv-popover').forEach(el => el.remove());

		const popover = document.body.createDiv({ cls: "cv-popover" });
		const rect = anchorEl.getBoundingClientRect();
		popover.style.top = `${rect.bottom + 5}px`;
		popover.style.left = `${rect.left}px`;

		const listContainer = popover.createDiv({ cls: "cv-popover-list" });

		const render = (list: typeof items) => {
			listContainer.empty();
			list.forEach(opt => {
				const item = listContainer.createDiv({ cls: "cv-popover-item" });
				if (opt.value === selectedValue) item.addClass("is-selected");

				// [FIXED] Created wrapper 'cv-popover-content' to hold Icon + Text
				const contentWrapper = item.createDiv({ cls: "cv-popover-content" });

				if (opt.icon) {
					const iconDiv = contentWrapper.createDiv({ cls: "cv-popover-icon" });
					setIcon(iconDiv, opt.icon);
				}
				contentWrapper.createDiv({ cls: "cv-popover-label", text: opt.label });

				if (opt.value === selectedValue) {
					const check = item.createDiv({ cls: "cv-popover-check" });
					setIcon(check, "check");
				}

				item.onclick = (evt) => {
					evt.stopPropagation();
					onSelect(opt.value);
					popover.remove();
				};
			});
		};

		if (enableSearch) {
			const searchContainer = popover.createDiv({ cls: "cv-popover-search" });
			const searchInput = searchContainer.createEl("input", { type: "text", placeholder: "Search..." });
			searchContainer.prepend(searchInput);
			searchInput.focus();
			searchInput.addEventListener("input", (e: any) => {
				const val = e.target.value.toLowerCase();
				render(items.filter(i => i.label.toLowerCase().includes(val)));
			});
		}

		render(items);

		const closeHandler = (evt: MouseEvent) => {
			if (!popover.contains(evt.target as Node) && evt.target !== anchorEl && !anchorEl.contains(evt.target as Node)) {
				popover.remove();
				document.removeEventListener("click", closeHandler);
			}
		};
		setTimeout(() => document.addEventListener("click", closeHandler), 0);
	}

	createSimpleBtn(container: HTMLElement, icon: string, text: string, onClick: () => void) {
		const btn = container.createDiv({ cls: "cv-text-icon-button", attr: { tabindex: "0" } });
		setIcon(btn.createSpan({ cls: "cv-text-button-icon" }), icon);
		btn.createSpan({ cls: "cv-text-button-label", text: text });
		btn.onclick = (e) => { e.stopPropagation(); onClick(); };
	}
}
