import { App, PluginSettingTab, Setting, ButtonComponent, TextComponent, setIcon, Menu, TFile, Modal } from "obsidian";
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
	conditions: []
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
	private draggedElement: HTMLElement | null = null;
	private draggedIndex: number | null = null;

	constructor(app: App, plugin: CustomViewsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
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




		// Add New View
		new Setting(containerEl)
			.setHeading()
			.setName("Views Configuration")
			.setDesc("Views are checked in order from top to bottom. Drag to reorder.")
			.addButton(btn => btn
				.setButtonText("Add New View")
				.setCta()
				.onClick(async () => {
					const newView: ViewConfig = {
						id: `${Date.now()}`,
						name: "New View",
						rules: JSON.parse(JSON.stringify(DEFAULT_RULES)),
						template: "<h1>{{file.basename}}</h1>"
					};
					this.plugin.settings.views.push(newView);
					await this.plugin.saveSettings();
					this.display();
					// Open the edit modal for the new view
					const newIndex = this.plugin.settings.views.length - 1;
					new EditViewModal(this.app, this.plugin, newView, newIndex, () => {
						this.display();
					}).open();
				}));

		// Views List Container
		const viewsListContainer = containerEl.createDiv({ cls: "cv-views-list-container" });

		this.plugin.settings.views.forEach((view, index) => {
			this.renderViewListItem(viewsListContainer, view, index);
		});
	}

	renderViewListItem(container: HTMLElement, view: ViewConfig, index: number) {
		const listItem = container.createDiv({ cls: "cv-view-list-item" });
		listItem.setAttribute("data-view-id", view.id);
		listItem.setAttribute("data-view-index", index.toString());
		listItem.draggable = true;

		// Drag handle icon
		const dragHandle = listItem.createDiv({ cls: "cv-view-drag-handle" });
		setIcon(dragHandle, "grip-vertical");

		// View name
		const nameSpan = listItem.createSpan({ cls: "cv-view-name", text: view.name });

		// Actions container
		const actionsContainer = listItem.createDiv({ cls: "cv-view-actions" });

		// Gear icon (edit)
		const gearBtn = actionsContainer.createDiv({ cls: "cv-clickable-icon" });
		setIcon(gearBtn, "settings");
		gearBtn.setAttribute("aria-label", "Edit view");
		gearBtn.onclick = (e) => {
			e.stopPropagation();
			new EditViewModal(this.app, this.plugin, view, index, () => {
				this.display();
			}).open();
		};

		// Delete icon
		const deleteBtn = actionsContainer.createDiv({ cls: "cv-clickable-icon" });
		setIcon(deleteBtn, "trash-2");
		deleteBtn.setAttribute("aria-label", "Delete view");
		deleteBtn.onclick = async (e) => {
			e.stopPropagation();
			this.plugin.settings.views.splice(index, 1);
			await this.plugin.saveSettings();
			this.display();
		};

		// Drag and drop handlers
		listItem.addEventListener("dragstart", (e) => {
			if (!e.dataTransfer) return;
			e.dataTransfer.effectAllowed = "move";
			this.draggedElement = listItem;
			this.draggedIndex = index;
			listItem.addClass("cv-dragging");
			// Clear any existing drop indicators
			container.querySelectorAll(".cv-view-list-item").forEach((el) => {
				el.removeClass("cv-drag-over");
			});
		});

		listItem.addEventListener("dragend", () => {
			listItem.removeClass("cv-dragging");
			container.querySelectorAll(".cv-view-list-item").forEach((el) => {
				el.removeClass("cv-drag-over");
			});
			this.draggedElement = null;
			this.draggedIndex = null;
		});

		listItem.addEventListener("dragover", (e) => {
			e.preventDefault();
			if (!e.dataTransfer || !this.draggedElement || this.draggedIndex === null) return;
			e.dataTransfer.dropEffect = "move";

			// Don't highlight the dragged element itself
			if (listItem === this.draggedElement) return;

			// Add visual feedback
			listItem.addClass("cv-drag-over");
		});

		listItem.addEventListener("dragleave", () => {
			listItem.removeClass("cv-drag-over");
		});

		listItem.addEventListener("drop", async (e) => {
			e.preventDefault();
			if (!e.dataTransfer || !this.draggedElement || this.draggedIndex === null) return;

			// Don't do anything if dropping on itself
			if (listItem === this.draggedElement) {
				listItem.removeClass("cv-drag-over");
				return;
			}

			const draggedView = this.plugin.settings.views[this.draggedIndex];

			// Find the target index in the DOM (this matches the array index before any changes)
			const allItems = Array.from(container.querySelectorAll(".cv-view-list-item")) as HTMLElement[];
			const targetIndex = allItems.indexOf(listItem);

			if (targetIndex === -1) return;

			// Calculate the insertion index:
			// When dragging down (draggedIndex < targetIndex): we want to insert AFTER the target
			//   - After removal, target shifts down by 1, so insert at targetIndex (original target position)
			// When dragging up (draggedIndex > targetIndex): we want to insert BEFORE the target
			//   - After removal, target stays at same position, so insert at targetIndex
			let newIndex: number;
			if (this.draggedIndex < targetIndex) {
				// Dragging down: remove first, then target is at targetIndex - 1, insert after it (at targetIndex)
				newIndex = targetIndex;
			} else {
				// Dragging up: remove first, target stays at targetIndex, insert before it (at targetIndex)
				newIndex = targetIndex;
			}

			// Ensure newIndex is valid (not negative)
			if (newIndex < 0) newIndex = 0;

			// Remove from old position first
			this.plugin.settings.views.splice(this.draggedIndex, 1);

			// Insert at new position (after removal, indices have shifted)
			this.plugin.settings.views.splice(newIndex, 0, draggedView);

			await this.plugin.saveSettings();
			this.display();
		});
	}
}

// ==========================================================
// EDIT VIEW MODAL
// ==========================================================

class EditViewModal extends Modal {
	plugin: CustomViewsPlugin;
	view: ViewConfig;
	viewIndex: number;
	onSave: () => void;
	private nameTextComponent: TextComponent | null = null;

	constructor(app: App, plugin: CustomViewsPlugin, view: ViewConfig, viewIndex: number, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.view = JSON.parse(JSON.stringify(view)); // Deep copy
		this.viewIndex = viewIndex;
		this.onSave = onSave;
		this.setTitle('Edit View');
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("cv-edit-view-modal");


		// View Name Input
		const nameSetting = new Setting(contentEl)
			.setName("View Name")
			.setDesc("The name of the view will be displayed in the view selector.")
			.addText(text => {
				this.nameTextComponent = text;
				text.setValue(this.view.name)
					.onChange(async (value) => {
						this.view.name = value;
					});
				// Select all text when modal opens
				requestAnimationFrame(() => {
					text.inputEl.select();
				});
			});

		// Rules Section
		contentEl.createEl("h3", { text: "Rules" });
		const rulesContainer = contentEl.createDiv({ cls: "cv-bases-query-container" });

		const builder = new FilterBuilder(
			this.plugin,
			this.view.rules,
			async () => { await this.plugin.saveSettings(); },
			() => { rulesContainer.empty(); builder.render(rulesContainer); }
		);
		builder.render(rulesContainer);

		// Template Section
		contentEl.createEl("h3", { text: "HTML Template" });
		const templateContainer = contentEl.createDiv({ cls: "cv-bases-template-container" });
		const textarea = templateContainer.createEl("textarea", {
			cls: "cv-textarea",
			text: this.view.template
		});
		textarea.addEventListener("input", async (e: any) => {
			this.view.template = e.target.value;
		});

		// Buttons
		const buttonContainer = contentEl.createDiv('modal-button-container');



		const saveBtn = new ButtonComponent(buttonContainer)
			.setButtonText("Save")
			.setCta()
			.onClick(async () => {
				// Update the original view
				this.plugin.settings.views[this.viewIndex] = this.view;
				await this.plugin.saveSettings();
				this.onSave();
				this.close();
			});

		const cancelBtn = new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => {
				this.close();
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
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
		// 1. Clean up existing dropdowns
		document.querySelectorAll('.cv-suggestion-container').forEach(el => el.remove());

		// 2. Create main container attached to body (to escape overflow issues)
		const container = document.body.createDiv({ cls: "cv-suggestion-container cv-combobox" });
		const rect = anchorEl.getBoundingClientRect();

		// Position logic
		container.style.left = `${rect.left}px`;
		container.style.top = `${rect.bottom + 5}px`; // Add a little gap

		// 3. Prevent the container itself from triggering the close handler
		container.addEventListener("mousedown", (e) => {
			e.stopPropagation();
		});

		// 4. Create search input
		const searchInputContainer = container.createDiv({ cls: "cv-search-input-container" });
		const searchInput = searchInputContainer.createEl("input", {
			type: "search",
			placeholder: "Search...",
			attr: { spellcheck: "false" }
		});
		const clearButton = searchInputContainer.createDiv({ cls: "cv-search-input-clear-button" });

		// 5. Create suggestions list container
		const suggestionsContainer = container.createDiv({ cls: "cv-suggestion" });

		// Renderer function
		const render = (list: typeof items) => {
			suggestionsContainer.empty();

			// Helper to manage selection state
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

				// Check icon
				if (item.value === selectedValue) {
					const checkIcon = suggestionItem.createDiv({ cls: "cv-suggestion-icon cv-mod-checked" });
					setIcon(checkIcon, "check");
				}

				// Item Icon (if exists)
				const iconDiv = suggestionItem.createDiv({ cls: "cv-suggestion-icon" });
				const flair = iconDiv.createSpan({ cls: "cv-suggestion-flair" });
				if (item.icon) {
					setIcon(flair, item.icon);
				}

				// Label
				const content = suggestionItem.createDiv({ cls: "cv-suggestion-content" });
				content.createDiv({ cls: "cv-suggestion-title", text: item.label });

				// Mouse interactions
				suggestionItem.onmouseenter = () => {
					clearSelected();
					suggestionItem.addClass('cv-is-selected');
				};

				suggestionItem.onclick = (evt) => {
					evt.stopPropagation(); // Stop click from bubbling
					onSelect(item.value);
					container.remove();
					// Cleanup listener
					document.removeEventListener("mousedown", closeHandler);
				};
			});
		};

		// 6. Input Event Handlers

		// Search Filtering
		searchInput.addEventListener("input", (e: any) => {
			const val = e.target.value.toLowerCase();
			const filtered = items.filter(i => i.label.toLowerCase().includes(val) || i.value.toLowerCase().includes(val));
			render(filtered);
		});

		// Visual focus state for styling
		searchInput.addEventListener("focus", () => container.addClass("cv-has-input-focus"));
		searchInput.addEventListener("blur", () => container.removeClass("cv-has-input-focus"));

		// Stop propagation on input interactions to prevent closing
		searchInput.addEventListener("click", (e) => e.stopPropagation());
		searchInput.addEventListener("mousedown", (e) => e.stopPropagation());

		// Clear button logic
		clearButton.onclick = (e) => {
			e.stopPropagation();
			searchInput.value = "";
			searchInput.focus();
			render(items);
		};

		// 7. Render initial list
		render(items);

		// 8. Focus management (Use requestAnimationFrame for reliability)
		requestAnimationFrame(() => {
			searchInput.focus();
		});

		// 9. Close Handler (The critical fix)
		// We use 'mousedown' instead of 'click' because focus changes on mousedown.
		const closeHandler = (evt: MouseEvent) => {
			const target = evt.target as Node;
			// If click is outside container AND outside the button that opened it
			if (!container.contains(target) && anchorEl !== target && !anchorEl.contains(target)) {
				container.remove();
				document.removeEventListener("mousedown", closeHandler);
			}
		};

		// Attach with a tiny delay to ensure the opening click doesn't trigger it immediately
		setTimeout(() => {
			document.addEventListener("mousedown", closeHandler);
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
