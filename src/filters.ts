import { moment } from "obsidian";

/**
 * Parse arguments like: "YYYY-MM-DD" or ("a", "b")
 * @param argString - The string to parse
 * @returns The parsed arguments
 */
function parseArgs(argString: string): any[] {
	if (!argString) return [];
	const content = argString.trim().replace(/^\((.*)\)$/, '$1');
	const args: any[] = [];
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

/**
 * Clean the string by removing the outer quotes if they exist.
 * Also converts numeric strings to numbers.
 * @param str - The string to clean
 * @returns The cleaned string or number if the string represents a number
 */
function cleanQuote(str: string): string | number {
	str = str.trim();
	if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
		return str.slice(1, -1);
	}

	if (!isNaN(Number(str))) return Number(str);
	return str;
}

/**
 * Registry of filter functions available for template value transformation.
 * Each filter takes a value and optional arguments, returning a transformed value.
 */
const filters: Record<string, (value: any, ...args: any[]) => any> = {
	date: (val: string | number, format?: string, inputFormat?: string) => {
		const m = inputFormat ? moment(val, inputFormat) : moment(val);
		return m.isValid() ? m.format(format || "YYYY-MM-DD") : val;
	},
	date_modify: (val: string, modification: string) => {
		const parts = modification.trim().split(" ");
		const amount = parseInt(parts[0]);
		const unit = parts[1] as moment.unitOfTime.DurationConstructor;
		const m = moment(val);
		return m.isValid() ? m.add(amount, unit).format("YYYY-MM-DD") : val;
	},

	capitalize: (val: string) => String(val).charAt(0).toUpperCase() + String(val).slice(1).toLowerCase(),
	upper: (val: string) => String(val).toUpperCase(),
	lower: (val: string) => String(val).toLowerCase(),
	title: (val: string) => String(val).replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()),
	camel: (val: string) => String(val).toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase()),
	kebab: (val: string) => String(val).match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)?.map(x => x.toLowerCase()).join('-') || val,
	snake: (val: string) => String(val).match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)?.map(x => x.toLowerCase()).join('_') || val,
	trim: (val: string) => String(val).trim(),

	replace: (val: string, search: string, replaceWith: string = "") => {
		if (search.startsWith("/")) {
			const lastSlash = search.lastIndexOf("/");
			const pattern = search.substring(1, lastSlash);
			const flags = search.substring(lastSlash + 1);
			return String(val).replace(new RegExp(pattern, flags), replaceWith);
		}
		return String(val).replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceWith);
	},

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

	strip_tags: (val: string, keep?: string) => {
		const doc = new DOMParser().parseFromString(val, 'text/html');
		return doc.body.textContent || "";
	},

	split: (val: string, separator: string = ",") => String(val).split(separator),
	join: (val: any[], separator: string = ",") => Array.isArray(val) ? val.join(separator) : val,
	first: (val: any[]) => Array.isArray(val) ? val[0] : val,
	last: (val: any[]) => Array.isArray(val) ? val[val.length - 1] : val,
	slice: (val: any[] | string, start: number, end?: number) => val.slice(start, end),
	count: (val: any) => Array.isArray(val) ? val.length : String(val).length,

	calc: (val: number, opString: string) => {
		const trimmed = opString.trim();
		const base = parseFloat(String(val));
		if (isNaN(base)) return val;

		if (trimmed.startsWith("**")) {
			const num = parseFloat(trimmed.substring(2));
			return isNaN(num) ? val : Math.pow(base, num);
		}

		const op = trimmed.charAt(0);
		const num = parseFloat(trimmed.substring(1));
		if (isNaN(num)) return val;

		switch (op) {
			case '+': return base + num;
			case '-': return base - num;
			case '*': return base * num;
			case '/': return base / num;
			case '^': return Math.pow(base, num);
			default: return val;
		}
	}
};

/**
 * Applies a chain of filters to a value.
 * Filters are separated by pipes (|) and can include arguments after a colon.
 *
 * @param value - The value to transform
 * @param filterChain - Pipe-separated filter chain (e.g., "upper | replace:\"old\",\"new\"")
 * @returns The transformed value after applying all filters in sequence
 *
 * @example
 * applyFilterChain("hello", "upper") // Returns: "HELLO"
 * applyFilterChain("  test  ", "trim | upper") // Returns: "TEST"
 * applyFilterChain(1234567890, "date:\"YYYY-MM-DD\"") // Returns formatted date
 */
export function applyFilterChain(value: any, filterChain: string): any {
	if (!filterChain) return value;

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

	let result = value;

	for (const step of steps) {
		if (!step) continue;

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
