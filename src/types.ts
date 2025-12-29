export type FilterOperator =
	| "contains" | "does not contain"
	| "is" | "is not"
	| "starts with" | "ends with"
	| "is empty" | "is not empty";

export type FilterConjunction = "AND" | "OR" | "NOR";
export interface Filter {
	type: "filter";
	field: string;
	operator: FilterOperator;
	value?: string;
}

export interface FilterGroup {
	type: "group";
	operator: FilterConjunction;
	conditions: (Filter | FilterGroup)[];
}

export interface ViewConfig {
	id: string;
	name: string;
	rules: FilterGroup;
	template: string;
}
