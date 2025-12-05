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
 * Generate TypeScript type definitions from the tool definitions.
 * Creates proper interface definitions with JSDoc comments.
 */
export function generateTypeScript(): string {
  let availableTypes = "";
  let availableTools = "";

  for (const [toolName, toolDef] of Object.entries(toolDefinitions)) {
    const inputSchema = toolDef.schema as z.ZodObject<any>;
    const description = toolDef.description;
    const shape = inputSchema.shape;

    // Generate input interface
    const inputTypeName = `${toPascalCase(toolName)}Input`;
    const inputFields = Object.entries(shape)
      .map(([key, s]) => {
        const zodSchema = s as z.ZodTypeAny;
        const isOptional = zodSchema.isOptional?.() || zodSchema instanceof z.ZodOptional;
        const fieldType = getZodTypeString(zodSchema);
        const fieldDesc = zodSchema.description;
        let field = "";
        if (fieldDesc) {
          field += `  /** ${fieldDesc} */\n`;
        }
        field += `  ${key}${isOptional ? "?" : ""}: ${fieldType};`;
        return field;
      })
      .join("\n");

    availableTypes += `\ninterface ${inputTypeName} {\n${inputFields || "  [key: string]: unknown;"}\n}`;

    // Output type is generic since MCP returns dynamic data
    const outputTypeName = `${toPascalCase(toolName)}Output`;
    availableTypes += `\ninterface ${outputTypeName} { [key: string]: any; }`;

    // Add tool to the codemode interface with JSDoc
    availableTools += `\n  /**`;
    availableTools += `\n   * ${description}`;
    availableTools += `\n   */`;
    availableTools += `\n  ${toolName}: (input: ${inputTypeName}) => Promise<${outputTypeName}>;`;
    availableTools += "\n";
  }

  // Wrap tools in the codemode declaration
  availableTools = `\ndeclare const codemode: {${availableTools}};`;

  return `${availableTypes}\n${availableTools}`;
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
