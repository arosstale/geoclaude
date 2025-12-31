/**
 * Class 3.20: Structured Output Validator
 *
 * Ensures LLM outputs conform to expected schemas.
 * Based on AgentJo's StrictJSON/parse_yaml patterns.
 *
 * Benefits over free text:
 * - Type checking with error correction
 * - Guaranteed field presence
 * - 30% shorter than JSON (YAML mode)
 * - Fewer format errors
 *
 * @module structured-output
 */

import { EventEmitter } from "events";

// =============================================================================
// Types
// =============================================================================

export type FieldType = "string" | "number" | "boolean" | "array" | "object" | "enum" | "optional" | "any";

export interface FieldSchema {
	type: FieldType;
	description?: string;
	default?: unknown;
	enum?: string[];
	items?: FieldSchema;
	properties?: Record<string, FieldSchema>;
	required?: boolean;
	pattern?: string;
	minLength?: number;
	maxLength?: number;
	min?: number;
	max?: number;
}

export interface OutputSchema {
	name: string;
	description?: string;
	fields: Record<string, FieldSchema>;
	strict?: boolean;
}

export interface ValidationResult {
	valid: boolean;
	data: Record<string, unknown> | null;
	errors: ValidationError[];
	corrections: Correction[];
}

export interface ValidationError {
	field: string;
	expected: string;
	received: string;
	message: string;
}

export interface Correction {
	field: string;
	original: unknown;
	corrected: unknown;
	reason: string;
}

export interface ParseOptions {
	format: "json" | "yaml" | "auto";
	strict: boolean;
	maxRetries: number;
	autoCorrect: boolean;
}

// =============================================================================
// Schema Helpers
// =============================================================================

export const Schema = {
	string: (description?: string, options?: Partial<FieldSchema>): FieldSchema => ({
		type: "string",
		description,
		required: true,
		...options,
	}),

	number: (description?: string, options?: Partial<FieldSchema>): FieldSchema => ({
		type: "number",
		description,
		required: true,
		...options,
	}),

	boolean: (description?: string): FieldSchema => ({
		type: "boolean",
		description,
		required: true,
	}),

	array: (items: FieldSchema, description?: string): FieldSchema => ({
		type: "array",
		items,
		description,
		required: true,
	}),

	object: (properties: Record<string, FieldSchema>, description?: string): FieldSchema => ({
		type: "object",
		properties,
		description,
		required: true,
	}),

	enum: (values: string[], description?: string): FieldSchema => ({
		type: "enum",
		enum: values,
		description,
		required: true,
	}),

	optional: (schema: FieldSchema): FieldSchema => ({
		...schema,
		required: false,
	}),

	// Common patterns
	confidence: (): FieldSchema => ({
		type: "number",
		description: "Confidence score from 0 to 1",
		min: 0,
		max: 1,
		required: true,
	}),

	list: (itemType: string, description?: string): FieldSchema => ({
		type: "array",
		items: { type: "string", description: itemType },
		description,
		required: true,
	}),
};

// =============================================================================
// Structured Output Validator
// =============================================================================

export class StructuredOutputValidator extends EventEmitter {
	private schemas: Map<string, OutputSchema> = new Map();
	private options: ParseOptions;

	constructor(options: Partial<ParseOptions> = {}) {
		super();
		this.options = {
			format: "auto",
			strict: true,
			maxRetries: 3,
			autoCorrect: true,
			...options,
		};
	}

	// ---------------------------------------------------------------------------
	// Schema Registration
	// ---------------------------------------------------------------------------

	registerSchema(schema: OutputSchema): void {
		this.schemas.set(schema.name, schema);
		this.emit("schema:registered", { name: schema.name });
	}

	getSchema(name: string): OutputSchema | undefined {
		return this.schemas.get(name);
	}

	listSchemas(): string[] {
		return Array.from(this.schemas.keys());
	}

	// ---------------------------------------------------------------------------
	// Parsing
	// ---------------------------------------------------------------------------

	parse(input: string, schema: OutputSchema, options?: Partial<ParseOptions>): ValidationResult {
		const opts = { ...this.options, ...options };
		const errors: ValidationError[] = [];
		const corrections: Correction[] = [];

		// Detect format
		const format = opts.format === "auto" ? this.detectFormat(input) : opts.format;

		// Parse raw data
		let rawData: Record<string, unknown>;
		try {
			rawData = format === "yaml" ? this.parseYaml(input) : this.parseJson(input);
		} catch (e) {
			// Try to extract structured content
			rawData = this.extractStructured(input, schema);
			if (Object.keys(rawData).length === 0) {
				return {
					valid: false,
					data: null,
					errors: [
						{
							field: "_root",
							expected: format,
							received: "unparseable",
							message: `Failed to parse ${format}: ${e}`,
						},
					],
					corrections: [],
				};
			}
			corrections.push({
				field: "_root",
				original: input.slice(0, 100),
				corrected: rawData,
				reason: "Extracted structured content from mixed text",
			});
		}

		// Validate and correct fields
		const validatedData = this.validateFields(rawData, schema, errors, corrections, opts);

		return {
			valid: errors.length === 0,
			data: validatedData,
			errors,
			corrections,
		};
	}

	// ---------------------------------------------------------------------------
	// Format Detection
	// ---------------------------------------------------------------------------

	private detectFormat(input: string): "json" | "yaml" {
		const trimmed = input.trim();

		// JSON starts with { or [
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
			return "json";
		}

		// YAML typically has key: value on first line
		if (/^[\w_-]+:\s*.+/m.test(trimmed)) {
			return "yaml";
		}

		// Default to JSON
		return "json";
	}

	// ---------------------------------------------------------------------------
	// JSON Parsing
	// ---------------------------------------------------------------------------

	private parseJson(input: string): Record<string, unknown> {
		// Extract JSON from markdown code blocks
		const jsonMatch = input.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (jsonMatch) {
			return JSON.parse(jsonMatch[1].trim());
		}

		// Try direct parse
		const trimmed = input.trim();
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");

		if (start !== -1 && end !== -1) {
			return JSON.parse(trimmed.slice(start, end + 1));
		}

		return JSON.parse(trimmed);
	}

	// ---------------------------------------------------------------------------
	// YAML Parsing (simplified)
	// ---------------------------------------------------------------------------

	private parseYaml(input: string): Record<string, unknown> {
		// Extract YAML from markdown code blocks
		const yamlMatch = input.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/);
		const content = yamlMatch ? yamlMatch[1].trim() : input.trim();

		const result: Record<string, unknown> = {};
		const lines = content.split("\n");

		let currentKey = "";
		let currentIndent = 0;
		let arrayItems: unknown[] = [];
		let inArray = false;

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;

			const indent = line.search(/\S/);

			// Array item
			if (trimmed.startsWith("- ")) {
				const value = trimmed.slice(2).trim();
				if (inArray) {
					arrayItems.push(this.parseYamlValue(value));
				} else {
					inArray = true;
					arrayItems = [this.parseYamlValue(value)];
				}
				continue;
			}

			// End of array
			if (inArray && indent <= currentIndent) {
				result[currentKey] = arrayItems;
				inArray = false;
				arrayItems = [];
			}

			// Key-value pair
			const colonIndex = trimmed.indexOf(":");
			if (colonIndex !== -1) {
				const key = trimmed.slice(0, colonIndex).trim();
				const value = trimmed.slice(colonIndex + 1).trim();

				if (value) {
					result[key] = this.parseYamlValue(value);
				} else {
					currentKey = key;
					currentIndent = indent;
				}
			}
		}

		// Final array
		if (inArray) {
			result[currentKey] = arrayItems;
		}

		return result;
	}

	private parseYamlValue(value: string): unknown {
		// Remove quotes
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			return value.slice(1, -1);
		}

		// Boolean
		if (value.toLowerCase() === "true") return true;
		if (value.toLowerCase() === "false") return false;

		// Null
		if (value.toLowerCase() === "null" || value === "~") return null;

		// Number
		const num = Number(value);
		if (!Number.isNaN(num)) return num;

		// String
		return value;
	}

	// ---------------------------------------------------------------------------
	// Extraction from mixed content
	// ---------------------------------------------------------------------------

	private extractStructured(input: string, schema: OutputSchema): Record<string, unknown> {
		const result: Record<string, unknown> = {};

		for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
			// Try to find field in text
			const patterns = [
				new RegExp(`${fieldName}[:\\s]+["']?([^"'\\n]+)["']?`, "i"),
				new RegExp(`\\*\\*${fieldName}\\*\\*[:\\s]+([^\\n]+)`, "i"),
				new RegExp(`- ${fieldName}[:\\s]+([^\\n]+)`, "i"),
			];

			for (const pattern of patterns) {
				const match = input.match(pattern);
				if (match) {
					result[fieldName] = this.coerceValue(match[1].trim(), fieldSchema);
					break;
				}
			}
		}

		return result;
	}

	// ---------------------------------------------------------------------------
	// Validation
	// ---------------------------------------------------------------------------

	private validateFields(
		data: Record<string, unknown>,
		schema: OutputSchema,
		errors: ValidationError[],
		corrections: Correction[],
		options: ParseOptions,
	): Record<string, unknown> {
		const result: Record<string, unknown> = {};

		for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
			const value = data[fieldName];

			// Check required
			if (value === undefined || value === null) {
				if (fieldSchema.required !== false) {
					if (fieldSchema.default !== undefined) {
						result[fieldName] = fieldSchema.default;
						corrections.push({
							field: fieldName,
							original: undefined,
							corrected: fieldSchema.default,
							reason: "Missing required field, using default",
						});
					} else {
						errors.push({
							field: fieldName,
							expected: "value",
							received: "undefined",
							message: `Required field "${fieldName}" is missing`,
						});
					}
				}
				continue;
			}

			// Validate type
			const validated = this.validateField(fieldName, value, fieldSchema, errors, corrections, options);
			if (validated !== undefined) {
				result[fieldName] = validated;
			}
		}

		return result;
	}

	private validateField(
		fieldName: string,
		value: unknown,
		schema: FieldSchema,
		errors: ValidationError[],
		corrections: Correction[],
		options: ParseOptions,
	): unknown {
		switch (schema.type) {
			case "string":
				return this.validateString(fieldName, value, schema, errors, corrections, options);

			case "number":
				return this.validateNumber(fieldName, value, schema, errors, corrections, options);

			case "boolean":
				return this.validateBoolean(fieldName, value, errors, corrections, options);

			case "array":
				return this.validateArray(fieldName, value, schema, errors, corrections, options);

			case "object":
				return this.validateObject(fieldName, value, schema, errors, corrections, options);

			case "enum":
				return this.validateEnum(fieldName, value, schema, errors, corrections, options);

			case "any":
				return value;

			default:
				return value;
		}
	}

	private validateString(
		fieldName: string,
		value: unknown,
		schema: FieldSchema,
		errors: ValidationError[],
		corrections: Correction[],
		options: ParseOptions,
	): string | undefined {
		if (typeof value === "string") {
			// Check constraints
			if (schema.minLength && value.length < schema.minLength) {
				errors.push({
					field: fieldName,
					expected: `min length ${schema.minLength}`,
					received: `length ${value.length}`,
					message: `String too short`,
				});
			}
			if (schema.maxLength && value.length > schema.maxLength) {
				if (options.autoCorrect) {
					const corrected = value.slice(0, schema.maxLength);
					corrections.push({
						field: fieldName,
						original: value,
						corrected,
						reason: "Truncated to max length",
					});
					return corrected;
				}
			}
			if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
				errors.push({
					field: fieldName,
					expected: `pattern ${schema.pattern}`,
					received: value,
					message: `String doesn't match pattern`,
				});
			}
			return value;
		}

		// Try to coerce
		if (options.autoCorrect) {
			const corrected = String(value);
			corrections.push({
				field: fieldName,
				original: value,
				corrected,
				reason: "Coerced to string",
			});
			return corrected;
		}

		errors.push({
			field: fieldName,
			expected: "string",
			received: typeof value,
			message: `Expected string, got ${typeof value}`,
		});
		return undefined;
	}

	private validateNumber(
		fieldName: string,
		value: unknown,
		schema: FieldSchema,
		errors: ValidationError[],
		corrections: Correction[],
		options: ParseOptions,
	): number | undefined {
		let num: number;

		if (typeof value === "number") {
			num = value;
		} else if (typeof value === "string" && !Number.isNaN(Number(value))) {
			num = Number(value);
			if (options.autoCorrect) {
				corrections.push({
					field: fieldName,
					original: value,
					corrected: num,
					reason: "Parsed string to number",
				});
			}
		} else {
			errors.push({
				field: fieldName,
				expected: "number",
				received: typeof value,
				message: `Expected number, got ${typeof value}`,
			});
			return undefined;
		}

		// Check constraints
		if (schema.min !== undefined && num < schema.min) {
			if (options.autoCorrect) {
				corrections.push({
					field: fieldName,
					original: num,
					corrected: schema.min,
					reason: `Clamped to minimum ${schema.min}`,
				});
				return schema.min;
			}
			errors.push({
				field: fieldName,
				expected: `>= ${schema.min}`,
				received: String(num),
				message: `Number below minimum`,
			});
		}

		if (schema.max !== undefined && num > schema.max) {
			if (options.autoCorrect) {
				corrections.push({
					field: fieldName,
					original: num,
					corrected: schema.max,
					reason: `Clamped to maximum ${schema.max}`,
				});
				return schema.max;
			}
			errors.push({
				field: fieldName,
				expected: `<= ${schema.max}`,
				received: String(num),
				message: `Number above maximum`,
			});
		}

		return num;
	}

	private validateBoolean(
		fieldName: string,
		value: unknown,
		errors: ValidationError[],
		corrections: Correction[],
		options: ParseOptions,
	): boolean | undefined {
		if (typeof value === "boolean") {
			return value;
		}

		// Try to coerce
		if (options.autoCorrect) {
			if (value === "true" || value === 1 || value === "yes") {
				corrections.push({
					field: fieldName,
					original: value,
					corrected: true,
					reason: "Coerced to boolean true",
				});
				return true;
			}
			if (value === "false" || value === 0 || value === "no") {
				corrections.push({
					field: fieldName,
					original: value,
					corrected: false,
					reason: "Coerced to boolean false",
				});
				return false;
			}
		}

		errors.push({
			field: fieldName,
			expected: "boolean",
			received: typeof value,
			message: `Expected boolean, got ${typeof value}`,
		});
		return undefined;
	}

	private validateArray(
		fieldName: string,
		value: unknown,
		schema: FieldSchema,
		errors: ValidationError[],
		corrections: Correction[],
		options: ParseOptions,
	): unknown[] | undefined {
		if (!Array.isArray(value)) {
			// Try to coerce single value to array
			if (options.autoCorrect && value !== null && value !== undefined) {
				const corrected = [value];
				corrections.push({
					field: fieldName,
					original: value,
					corrected,
					reason: "Wrapped single value in array",
				});
				return corrected;
			}
			errors.push({
				field: fieldName,
				expected: "array",
				received: typeof value,
				message: `Expected array, got ${typeof value}`,
			});
			return undefined;
		}

		// Validate items if schema provided
		if (schema.items) {
			return value.map((item, index) =>
				this.validateField(`${fieldName}[${index}]`, item, schema.items!, errors, corrections, options),
			);
		}

		return value;
	}

	private validateObject(
		fieldName: string,
		value: unknown,
		schema: FieldSchema,
		errors: ValidationError[],
		corrections: Correction[],
		options: ParseOptions,
	): Record<string, unknown> | undefined {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			errors.push({
				field: fieldName,
				expected: "object",
				received: typeof value,
				message: `Expected object, got ${typeof value}`,
			});
			return undefined;
		}

		const result: Record<string, unknown> = {};
		const obj = value as Record<string, unknown>;

		if (schema.properties) {
			for (const [propName, propSchema] of Object.entries(schema.properties)) {
				const validated = this.validateField(
					`${fieldName}.${propName}`,
					obj[propName],
					propSchema,
					errors,
					corrections,
					options,
				);
				if (validated !== undefined) {
					result[propName] = validated;
				}
			}
		} else {
			return obj;
		}

		return result;
	}

	private validateEnum(
		fieldName: string,
		value: unknown,
		schema: FieldSchema,
		errors: ValidationError[],
		corrections: Correction[],
		options: ParseOptions,
	): string | undefined {
		const strValue = String(value).toLowerCase();
		const enumValues = schema.enum || [];
		const enumLower = enumValues.map((e) => e.toLowerCase());

		const index = enumLower.indexOf(strValue);
		if (index !== -1) {
			return enumValues[index];
		}

		// Try fuzzy match
		if (options.autoCorrect) {
			for (let i = 0; i < enumValues.length; i++) {
				if (enumLower[i].includes(strValue) || strValue.includes(enumLower[i])) {
					corrections.push({
						field: fieldName,
						original: value,
						corrected: enumValues[i],
						reason: `Fuzzy matched to enum value`,
					});
					return enumValues[i];
				}
			}
		}

		errors.push({
			field: fieldName,
			expected: `one of: ${enumValues.join(", ")}`,
			received: String(value),
			message: `Value not in enum`,
		});
		return undefined;
	}

	// ---------------------------------------------------------------------------
	// Coercion helper
	// ---------------------------------------------------------------------------

	private coerceValue(value: string, schema: FieldSchema): unknown {
		switch (schema.type) {
			case "number":
				return Number(value) || 0;
			case "boolean":
				return value.toLowerCase() === "true" || value === "1" || value.toLowerCase() === "yes";
			case "array":
				return value.split(",").map((v) => v.trim());
			default:
				return value;
		}
	}

	// ---------------------------------------------------------------------------
	// Prompt Generation
	// ---------------------------------------------------------------------------

	generatePrompt(schema: OutputSchema, format: "json" | "yaml" = "yaml"): string {
		const lines: string[] = [];

		lines.push(`Respond with structured ${format.toUpperCase()} output:`);
		lines.push("");

		if (format === "yaml") {
			lines.push("```yaml");
			for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
				const typeStr = this.formatTypeForPrompt(fieldSchema);
				const required = fieldSchema.required !== false ? " (required)" : " (optional)";
				lines.push(`${fieldName}: ${typeStr}${required}`);
				if (fieldSchema.description) {
					lines.push(`  # ${fieldSchema.description}`);
				}
			}
			lines.push("```");
		} else {
			lines.push("```json");
			lines.push("{");
			const entries = Object.entries(schema.fields);
			entries.forEach(([fieldName, fieldSchema], index) => {
				const typeStr = this.formatTypeForPrompt(fieldSchema);
				const comma = index < entries.length - 1 ? "," : "";
				lines.push(`  "${fieldName}": ${typeStr}${comma}`);
			});
			lines.push("}");
			lines.push("```");
		}

		return lines.join("\n");
	}

	private formatTypeForPrompt(schema: FieldSchema): string {
		switch (schema.type) {
			case "string":
				return '"<string>"';
			case "number":
				return "<number>";
			case "boolean":
				return "<true|false>";
			case "array":
				return "[...]";
			case "object":
				return "{...}";
			case "enum":
				return `"${(schema.enum || []).join('" | "')}"`;
			default:
				return "<value>";
		}
	}
}

// =============================================================================
// Predefined Schemas
// =============================================================================

export const CommonSchemas = {
	agentResponse: (): OutputSchema => ({
		name: "AgentResponse",
		description: "Standard agent response format",
		fields: {
			analysis: Schema.string("Analysis of the task"),
			actions: Schema.array(
				Schema.object({
					tool: Schema.string("Tool name"),
					params: Schema.object({}, "Tool parameters"),
					result: Schema.optional(Schema.string("Result")),
				}),
				"Actions taken",
			),
			conclusion: Schema.string("Final conclusion"),
			confidence: Schema.confidence(),
		},
	}),

	planOutput: (): OutputSchema => ({
		name: "PlanOutput",
		description: "Task decomposition plan",
		fields: {
			goal: Schema.string("Main goal"),
			steps: Schema.array(
				Schema.object({
					id: Schema.number("Step ID"),
					task: Schema.string("Task description"),
					dependencies: Schema.array(Schema.number("Dependency ID"), "Dependencies"),
				}),
				"Ordered steps",
			),
			estimatedComplexity: Schema.enum(["simple", "medium", "hard", "complex"]),
		},
	}),

	reflectionOutput: (): OutputSchema => ({
		name: "ReflectionOutput",
		description: "Self-critique output",
		fields: {
			strengths: Schema.list("string", "What was done well"),
			weaknesses: Schema.list("string", "Areas for improvement"),
			suggestions: Schema.list("string", "Specific improvements"),
			overallQuality: Schema.enum(["poor", "fair", "good", "excellent"]),
		},
	}),

	orientationOutput: (): OutputSchema => ({
		name: "OrientationOutput",
		description: "OODA Orient phase output",
		fields: {
			situation: Schema.string("Current situation assessment"),
			threats: Schema.list("string", "Identified threats"),
			opportunities: Schema.list("string", "Identified opportunities"),
			constraints: Schema.list("string", "Known constraints"),
			recommendation: Schema.string("Recommended approach"),
		},
	}),
};

// =============================================================================
// Factory
// =============================================================================

let validatorInstance: StructuredOutputValidator | null = null;

export function getStructuredValidator(options?: Partial<ParseOptions>): StructuredOutputValidator {
	if (!validatorInstance) {
		validatorInstance = new StructuredOutputValidator(options);
		// Register common schemas
		for (const [_name, schemaFn] of Object.entries(CommonSchemas)) {
			validatorInstance.registerSchema(schemaFn());
		}
	}
	return validatorInstance;
}

export function resetStructuredValidator(): void {
	validatorInstance = null;
}
