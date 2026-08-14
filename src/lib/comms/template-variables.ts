export interface TemplateVariable {
  key: string
  label: string
  description: string
  tier: 'campaign' | 'recipient'
}

export const CAMPAIGN_CONTEXT_VARIABLES: TemplateVariable[] = [
  { key: 'employer_name', label: 'Employer Name', description: 'Primary employer on the campaign agreement', tier: 'campaign' },
  { key: 'agreement_name', label: 'Agreement Name', description: 'Enterprise agreement name', tier: 'campaign' },
  { key: 'worksite_name', label: 'Worksite Name', description: 'Primary worksite name', tier: 'campaign' },
  { key: 'campaign_name', label: 'Campaign Name', description: 'Campaign name / identifier', tier: 'campaign' },
  { key: 'organiser_name', label: 'Organiser Name', description: 'Lead organiser for the campaign', tier: 'campaign' },
  { key: 'organiser_phone', label: 'Organiser Phone', description: 'Lead organiser phone number', tier: 'campaign' },
  { key: 'staff_name', label: 'Staff Name', description: 'Logged-in organiser name', tier: 'campaign' },
  { key: 'staff_email', label: 'Staff Email', description: 'Logged-in organiser email', tier: 'campaign' },
  { key: 'staff_phone', label: 'Staff Phone', description: 'Logged-in organiser phone', tier: 'campaign' },
  { key: 'staff_role', label: 'Staff Role', description: 'Logged-in organiser role title', tier: 'campaign' },
  { key: 'date', label: 'Date', description: 'Current date (formatted)', tier: 'campaign' },
]

export const RECIPIENT_VARIABLES: TemplateVariable[] = [
  { key: 'first_name', label: 'First Name', description: 'Recipient first name (resolved by Action Network at send time)', tier: 'recipient' },
  { key: 'last_name', label: 'Last Name', description: 'Recipient last name (resolved by Action Network at send time)', tier: 'recipient' },
  { key: 'occupation', label: 'Occupation', description: 'Recipient occupation/trade (resolved by Action Network at send time)', tier: 'recipient' },
]

export const ALL_TEMPLATE_VARIABLES: TemplateVariable[] = [
  ...RECIPIENT_VARIABLES,
  ...CAMPAIGN_CONTEXT_VARIABLES,
]

export const ALL_VARIABLE_KEYS = ALL_TEMPLATE_VARIABLES.map((v) => v.key)

export const INSERT_VARIABLES = ALL_TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`)

export const AN_VARIABLE_MAP: Record<string, string> = {
  first_name: '[contact.first_name]',
  last_name: '[contact.last_name]',
  occupation: '[contact.custom_fields.occupation]',
}

/** Matches `{{key}}` or `{{ key }}` for template substitution. */
export const TEMPLATE_TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g

/**
 * Matches chip-span wrappers — `<span ... data-merge-field="key" ...>...</span>` —
 * regardless of attribute order. The non-greedy inner match handles the
 * span's content (typically `{{key}}` but may legally contain a label in
 * older drafts).
 */
export const CHIP_SPAN_RE =
  /<span\b[^>]*?\bdata-merge-field=["']([^"']+)["'][^>]*>[\s\S]*?<\/span>/gi

/**
 * Merge campaign template context with per-worker fields for live phone script display.
 * Worker wins for contact fields when non-empty; employer/worksite fall back to campaign.
 */
export function mergePhoneScriptVariableContext(
  campaign: Record<string, string | undefined>,
  worker: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...campaign }
  for (const k of ['first_name', 'last_name', 'occupation', 'phone', 'email'] as const) {
    const v = worker[k]
    if (v != null && v !== '') out[k] = v
  }
  out.employer_name =
    worker.employer_name != null && worker.employer_name !== ''
      ? worker.employer_name
      : campaign.employer_name
  out.worksite_name =
    worker.worksite_name != null && worker.worksite_name !== ''
      ? worker.worksite_name
      : campaign.worksite_name
  return out
}

export const SAMPLE_DATA: Record<string, string> = {
  first_name: 'Alex',
  last_name: 'Mitchell',
  occupation: 'Boilermaker',
  agreement_name: 'Woodside FPSO EA 2026',
  employer_name: 'Woodside Energy',
  worksite_name: 'North West Shelf',
  organiser_name: 'Sarah Chen',
  organiser_phone: '0412 345 678',
  date: '15 April 2026',
  campaign_name: 'NWS Bargaining 2026',
  staff_name: 'Sarah Chen',
  staff_email: 'sarah.chen@example.com',
  staff_phone: '0412 345 678',
  staff_role: 'Lead Organiser',
}

export function resolveTemplateVariables(
  text: string,
  campaignContext: Record<string, string | undefined>,
): string {
  return text.replace(TEMPLATE_TOKEN_RE, (match, key) => {
    if (key in AN_VARIABLE_MAP) return match
    const value = campaignContext[key]
    return value || match
  })
}

/**
 * Resolves ALL template variables including recipient variables (first_name, last_name, etc.).
 * Use this for phone scripts where the caller sees the resolved text directly,
 * as opposed to emails where Action Network resolves recipient variables at send time.
 */
export function resolveScriptVariables(
  text: string,
  context: Record<string, string | undefined>,
): string {
  return text.replace(TEMPLATE_TOKEN_RE, (match, key) => {
    const value = context[key]
    return value ?? match
  })
}

export function translateToActionNetwork(text: string): string {
  return text.replace(TEMPLATE_TOKEN_RE, (match, key) => {
    return AN_VARIABLE_MAP[key] || match
  })
}

/**
 * Like `resolveScriptVariables` but ALSO matches chip-span wrappers
 * (`<span data-merge-field="key">...</span>`) and replaces them with the
 * resolved value. Use for server-side resolution where the stored
 * `body_html` may have escaped the client-side strip step on some flows
 * (e.g. legacy drafts predating the chip system, or programmatic
 * `setContent` paths that didn't route through `onChange`).
 *
 * When the context value is `undefined`, the original chip-span / token
 * is left intact so downstream `translateToActionNetwork` or another
 * resolver can have a crack at it.
 */
export function resolveScriptVariablesIncludingChips(
  text: string,
  context: Record<string, string | undefined>,
): string {
  if (!text) return text
  // Replace chip spans first so the inner `{{key}}` literal doesn't get
  // matched twice by the bare-token pass below.
  let out = text.replace(CHIP_SPAN_RE, (match, key) => {
    const value = context[key]
    return value ?? match
  })
  out = out.replace(TEMPLATE_TOKEN_RE, (match, key) => {
    const value = context[key]
    return value ?? match
  })
  return out
}

export function applyVariableReplacements(
  text: string,
  replacements: Array<{ original_text: string; variable: string; accepted: boolean; replacement_text?: string }>,
): string {
  let result = text
  for (const r of replacements) {
    if (!r.accepted) continue
    const replacement = r.replacement_text != null ? r.replacement_text : `{{${r.variable}}}`
    result = result.split(r.original_text).join(replacement)
  }
  return result
}
