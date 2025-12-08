import { z } from "zod";
import { toolDefinitions, type ToolName } from "./schemas";

/**
 * Convert a tool name to PascalCase for TypeScript interface naming
 */
function toPascalCase(str: string): string {
  return str
    .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

/**
 * Get the TypeScript type string for a Zod schema
 */
function getZodTypeString(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodString) return "string";
  if (schema instanceof z.ZodNumber) return "number";
  if (schema instanceof z.ZodBoolean) return "boolean";
  if (schema instanceof z.ZodEnum) {
    const opts = (schema as z.ZodEnum<any>).options;
    return opts.map((o: string) => `'${o}'`).join(" | ");
  }
  if (schema instanceof z.ZodOptional) return getZodTypeString(schema.unwrap());
  if (schema instanceof z.ZodArray) return `${getZodTypeString(schema.element)}[]`;
  if (schema instanceof z.ZodObject) return "object";
  return "any";
}

/**
 * Generate compact TypeScript type definitions from the tool definitions.
 * Optimized for minimal token usage in LLM prompts.
 */
export function generateTypeScript(): string {
  const tools: string[] = [];

  for (const [toolName, toolDef] of Object.entries(toolDefinitions)) {
    const inputSchema = toolDef.schema as z.ZodObject<any>;
    const shape = inputSchema.shape;

    // Generate inline type for parameters
    const params = Object.entries(shape)
      .map(([key, s]) => {
        const zodSchema = s as z.ZodTypeAny;
        const isOptional = zodSchema.isOptional?.() || zodSchema instanceof z.ZodOptional;
        const fieldType = getZodTypeString(zodSchema);
        return `${key}${isOptional ? "?" : ""}: ${fieldType}`;
      })
      .join(", ");

    // Compact single-line format: toolName(params) - description
    tools.push(`${toolName}({${params}}): Promise<any> // ${toolDef.description}`);
  }

  return `declare const codemode: {\n  ${tools.join(";\n  ")};\n};`;
}

/**
 * Generate a simple list of tool descriptions.
 * Used for system prompts.
 */
export function generateToolDescriptions(): string {
  return Object.entries(toolDefinitions)
    .map(([name, def]) => `- ${name}: ${def.description}`)
    .join("\n");
}

// Pre-generate and cache the outputs
// These are computed once when the module is loaded
export const cachedTypeScript = generateTypeScript();
export const cachedToolDescriptions = generateToolDescriptions();
