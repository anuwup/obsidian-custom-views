import { moment } from "obsidian";

// Helper: Parse arguments like: "YYYY-MM-DD" or ("a", "b")
function parseArgs(argString: string): any[] {
	if (!argString) return [];

	// Remove outer parenthesis if they exist: ("a", "b") -> "a", "b"
	const content = argString.trim().replace(/^\((.*)\)$/, '$1');

	// Split by comma, respecting quotes
	const args: string[] = [];
	let current = '';
	let inQuote = false;

	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		if (char === '"' || char === "'") {
			inQuote = !inQuote;
		} else if (char === ',' && !inQuote) {
			args.push(cleanQuote(current));
			current = '';
			continue;
		}
		current += char;
	}
	if (current) args.push(cleanQuote(current));

	return args;
}

function cleanQuote(str: string): any {
	str = str.trim();
	if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
		return str.slice(1, -1);
	}
	// Check for numbers
	if (!isNaN(Number(str))) return Number(str);
	return str;
}

// =============================================================================
// FILTER IMPLEMENTATIONS
// =============================================================================

const filters: Record<string, (value: any, ...args: any[]) => any> = {
	// --- Dates ---
	date: (val: string | number, format?: string, inputFormat?: string) => {
		const m = inputFormat ? moment(val, inputFormat) : moment(val);
		return m.isValid() ? m.format(format || "YYYY-MM-DD") : val;
	},
	date_modify: (val: string, modification: string) => {
		// Simple parser for "+1 year", "-2 months"
		const parts = modification.trim().split(" ");
		const amount = parseInt(parts[0]);
		const unit = parts[1] as moment.unitOfTime.DurationConstructor;
		const m = moment(val);
		return m.isValid() ? m.add(amount, unit).format("YYYY-MM-DD") : val;
	},

	// --- Text Conversion ---
	capitalize: (val: string) => String(val).charAt(0).toUpperCase() + String(val).slice(1).toLowerCase(),
	upper: (val: string) => String(val).toUpperCase(),
	lower: (val: string) => String(val).toLowerCase(),
	title: (val: string) => String(val).replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()),
	camel: (val: string) => String(val).toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase()),
	kebab: (val: string) => String(val).match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)?.map(x => x.toLowerCase()).join('-') || val,
	snake: (val: string) => String(val).match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)?.map(x => x.toLowerCase()).join('_') || val,
	trim: (val: string) => String(val).trim(),

	replace: (val: string, search: string, replaceWith: string = "") => {
		// Handle Regex if string starts with /
		if (search.startsWith("/")) {
			const lastSlash = search.lastIndexOf("/");
			const pattern = search.substring(1, lastSlash);
			const flags = search.substring(lastSlash + 1);
			return String(val).replace(new RegExp(pattern, flags), replaceWith);
		}
		// Use global regex replace instead of replaceAll for ES6 compatibility
		return String(val).replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceWith);
	},

	// --- Formatting (Markdown) ---
	wikilink: (val: any, alias?: string) => {
		if (Array.isArray(val)) return val.map(v => `[[${v}${alias ? '|' + alias : ''}]]`).join(", ");
		return `[[${val}${alias ? '|' + alias : ''}]]`;
	},
	link: (val: any, text?: string) => {
		const label = text || "link";
		if (Array.isArray(val)) return val.map(v => `[${label}](${v})`).join(", ");
		return `[${label}](${val})`;
	},
	image: (val: any, alt?: string) => {
		const txt = alt || "";
		if (Array.isArray(val)) return val.map(v => `![${txt}](${v})`).join("\n");
		return `![${txt}](${val})`;
	},
	blockquote: (val: string) => val.split('\n').map(line => `> ${line}`).join('\n'),

	// --- HTML Processing ---
	strip_tags: (val: string, keep?: string) => {
		const doc = new DOMParser().parseFromString(val, 'text/html');
		// A full implementation would need a complex sanitizer,
		// simplistic text extraction:
		return doc.body.textContent || "";
	},

	// --- Arrays ---
	split: (val: string, separator: string = ",") => String(val).split(separator),
	join: (val: any[], separator: string = ",") => Array.isArray(val) ? val.join(separator) : val,
	first: (val: any[]) => Array.isArray(val) ? val[0] : val,
	last: (val: any[]) => Array.isArray(val) ? val[val.length - 1] : val,
	slice: (val: any[] | string, start: number, end?: number) => val.slice(start, end),
	count: (val: any) => Array.isArray(val) ? val.length : String(val).length,

	// Basic Arithmetic
	calc: (val: number, opString: string) => {
		// CAUTION: Simple eval-like safety check needed
		// Format: "+10", "*2", "**3"
		const op = opString.trim().charAt(0);
		const num = parseFloat(opString.substring(1));
		const base = parseFloat(String(val));
		if (isNaN(base) || isNaN(num)) return val;

		switch (op) {
			case '+': return base + num;
			case '-': return base - num;
			case '*': return base * num;
			case '/': return base / num;
			case '^': case '*': return Math.pow(base, num); // Handles ** or ^
			default: return val;
		}
	}
};

// =============================================================================
// MAIN EXECUTION
// =============================================================================

export function applyFilterChain(value: any, filterChain: string): any {
	if (!filterChain) return value;

	// Split by pipe '|', ignoring pipes inside quotes
	const steps: string[] = [];
	let current = '';
	let inQuote = false;

	for (let i = 0; i < filterChain.length; i++) {
		const char = filterChain[i];
		if (char === '"' || char === "'") inQuote = !inQuote;

		if (char === '|' && !inQuote) {
			steps.push(current.trim());
			current = '';
		} else {
			current += char;
		}
	}
	if (current) steps.push(current.trim());

	// Process each filter
	let result = value;

	for (const step of steps) {
		if (!step) continue;

		// Separate filter name and args: name:arg1,arg2
		const colonIndex = step.indexOf(':');
		let name = step;
		let args: any[] = [];

		if (colonIndex > -1) {
			name = step.substring(0, colonIndex);
			const argString = step.substring(colonIndex + 1);
			args = parseArgs(argString);
		}

		const fn = filters[name];
		if (fn) {
			try {
				result = fn(result, ...args);
			} catch (e) {
				console.error(`[Custom Views] Filter error '${name}':`, e);
			}
		}
	}

	return result;
}
