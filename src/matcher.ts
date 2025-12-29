// src/matcher.ts
import { TFile, FrontMatterCache } from "obsidian";
import { FilterGroup, Filter } from "./types";

/**
 * Evaluates the rules for a given filter group, file, and frontmatter
 * @param group - The filter group to evaluate
 * @param file - The file to evaluate the rules for
 * @param frontmatter - The frontmatter of the file
 * @returns True if all conditions in the group are met, false otherwise
 */
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

/**
 * Evaluates a single filter for a given file and frontmatter
 * @param filter - The filter to evaluate
 * @param file - The file to evaluate the filter for
 * @param frontmatter - The frontmatter of the file
 * @returns True if the condition is met, false otherwise
 */
function evaluateFilter(filter: Filter, file: TFile, frontmatter?: FrontMatterCache): boolean {
	let targetValue: any = null;

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
		targetValue = frontmatter[filter.field];
	}

	if (targetValue === undefined || targetValue === null) targetValue = "";

	const normalize = (val: any) => String(val).toLowerCase();
	const filterValue = normalize(filter.value || "");

	const isArray = Array.isArray(targetValue);

	switch (filter.operator) {
		case "is empty":
			return isArray ? targetValue.length === 0 : !targetValue;
		case "is not empty":
			return isArray ? targetValue.length > 0 : !!targetValue;

		case "is":
		case "is not": {
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
			if (isArray) return false;
			return normalize(targetValue).startsWith(filterValue);

		case "ends with":
			if (isArray) return false;
			return normalize(targetValue).endsWith(filterValue);

		default:
			return false;
	}
}
