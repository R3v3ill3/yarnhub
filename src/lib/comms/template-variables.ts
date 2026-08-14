export interface TemplateVariable {
  key: string;
  label: string;
  description: string;
  tier: "contact" | "org";
}

export const CONTACT_VARIABLES: TemplateVariable[] = [
  {
    key: "first_name",
    label: "First Name",
    description: "Recipient first name",
    tier: "contact",
  },
  {
    key: "last_name",
    label: "Last Name",
    description: "Recipient last name",
    tier: "contact",
  },
];

export const ORG_VARIABLES: TemplateVariable[] = [
  {
    key: "org_name",
    label: "Organisation",
    description: "Sending organisation name",
    tier: "org",
  },
];

export const ALL_TEMPLATE_VARIABLES: TemplateVariable[] = [
  ...CONTACT_VARIABLES,
  ...ORG_VARIABLES,
];

export const ALL_VARIABLE_KEYS = ALL_TEMPLATE_VARIABLES.map((v) => v.key);

export const INSERT_VARIABLES = ALL_TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`);

/** Matches `{{key}}` or `{{ key }}` for template substitution. */
export const TEMPLATE_TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Matches chip-span wrappers — `<span ... data-merge-field="key" ...>...</span>`.
 */
export const CHIP_SPAN_RE =
  /<span\b[^>]*?\bdata-merge-field=["']([^"']+)["'][^>]*>[\s\S]*?<\/span>/gi;

export const SAMPLE_DATA: Record<string, string> = {
  first_name: "Alex",
  last_name: "Mitchell",
  org_name: "Example Org",
};

export function resolveScriptVariables(
  text: string,
  context: Record<string, string | undefined>,
): string {
  return text.replace(TEMPLATE_TOKEN_RE, (match, key) => {
    const value = context[key];
    return value ?? match;
  });
}

export function resolveScriptVariablesIncludingChips(
  text: string,
  context: Record<string, string | undefined>,
): string {
  if (!text) return text;
  let out = text.replace(CHIP_SPAN_RE, (match, key) => {
    const value = context[key];
    return value ?? match;
  });
  out = out.replace(TEMPLATE_TOKEN_RE, (match, key) => {
    const value = context[key];
    return value ?? match;
  });
  return out;
}
