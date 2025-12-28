// src/matcher.ts
import { TFile, FrontMatterCache } from "obsidian";
import { FilterGroup, Filter, FilterOperator } from "./types";

export function checkRules(group: FilterGroup, file: TFile, frontmatter?: FrontMatterCache): boolean {
	if (!group || !group.conditions || group.conditions.length === 0) return true;

	// Evaluate all conditions in this group
	const results = group.conditions.map(condition => {
		if (condition.type === "group") {
			return checkRules(condition as FilterGroup, file, frontmatter);
		} else {
			return evaluateFilter(condition as Filter, file, frontmatter);
		}
	});

	// Combine results based on AND (every) / OR (some)
	if (group.operator === "AND") {
		return results.every(r => r === true);
	} else {
		return results.some(r => r === true);
	}
}

function evaluateFilter(filter: Filter, file: TFile, frontmatter?: FrontMatterCache): boolean {
	let targetValue: any = null;

	// 1. Resolve the value from File or Frontmatter
	// Determine field type by checking if field starts with "file."
	if (filter.field.startsWith("file.")) {
		if (filter.field === "file.name") targetValue = file.name;
		else if (filter.field === "file.basename") targetValue = file.basename;
		else if (filter.field === "file.path") targetValue = file.path;
		else if (filter.field === "file.folder") targetValue = file.parent?.path || "";
		else if (filter.field === "file.size") targetValue = file.stat.size;
		else if (filter.field === "file.ctime") targetValue = file.stat.ctime;
		else if (filter.field === "file.mtime") targetValue = file.stat.mtime;
		else if (filter.field === "file.extension") targetValue = file.extension;
	} else if (frontmatter) {
		// Frontmatter field
		targetValue = frontmatter[filter.field];
	}

	// Handle null/undefined
	if (targetValue === undefined || targetValue === null) targetValue = "";

	// Normalize to string for comparison (or array if checking includes)
	const normalize = (val: any) => String(val).toLowerCase();
	const filterValue = normalize(filter.value || "");

	// If target is an array (e.g. tags: [a, b]), we handle it differently
	const isArray = Array.isArray(targetValue);

	// 2. Perform the Check
	switch (filter.operator) {
		case "is empty":
			return isArray ? targetValue.length === 0 : !targetValue;
		case "is not empty":
			return isArray ? targetValue.length > 0 : !!targetValue;

		case "is":
		case "is not": {
			// Exact match
			let match = false;
			if (isArray) match = targetValue.some((v: any) => normalize(v) === filterValue);
			else match = normalize(targetValue) === filterValue;
			return filter.operator === "is" ? match : !match;
		}

		case "contains":
		case "does not contain": {
			let match = false;
			if (isArray) match = targetValue.some((v: any) => normalize(v).includes(filterValue));
			else match = normalize(targetValue).includes(filterValue);
			return filter.operator === "contains" ? match : !match;
		}

		case "starts with":
			if (isArray) return false; // Hard to strictly start with on an array
			return normalize(targetValue).startsWith(filterValue);

		case "ends with":
			if (isArray) return false;
			return normalize(targetValue).endsWith(filterValue);

		default:
			return false;
	}
}
