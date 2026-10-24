/** Public page-bootstrap options shared by the Host and Client halves. */

import z from '@deepseek-ai/schemastery'

/** One configured provider icon. */
export interface ProviderIconConfig {
  /** Image URL the row and editor title render. */
  src: string
  /** Paint the image as a mask filled with the current text color. */
  monochrome?: boolean
  /** Uniform scale applied to the icon. */
  scale?: number
}

/** Onboarding options after schema defaults are applied. */
export interface Config {
  /** Offer the browser API-key step when no native shell owns credential onboarding. */
  credentialOnboarding: boolean
  /** Whether to register the preview welcome notice among the `settings.onboarding` steps (the entry whose id is `welcome-notice`). */
  welcomeNotice: boolean
  /**
   * Provider routes whose model catalog the deployment manages: their card
   * edits credentials only and shows no custom-provider tag.
   */
  credentialOnlyProviders: string[]
  /** Provider routes omitted from the settings cards and add-provider catalog; model availability is unchanged. */
  hiddenProviders: string[]
  /** Provider icon per provider route id. */
  providerIcons: Record<string, ProviderIconConfig>
  /** Explicit editor family per adapter settings namespace; unlisted namespaces keep the built-in mapping. */
  providerEditorLayouts: Record<string, 'deepseek' | 'pi-ai'>
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config: z<Partial<Config>, Config> = z.object({
  credentialOnboarding: z.boolean().default(true),
  welcomeNotice: z.boolean().default(true),
  credentialOnlyProviders: z.array(z.string()).default([]),
  hiddenProviders: z.array(z.string()).default([]),
  // `monochrome` and `scale` stay optional so a deployment states only what it
  // changes; the schema's own default fills them once the value is parsed.
  providerIcons: z.dict(z.object({
    src: z.string(),
    monochrome: z.boolean(),
    scale: z.number(),
  })).default({}),
  providerEditorLayouts: z.dict(z.union(['deepseek', 'pi-ai'])).default({}),
})

/** Page-global key carrying only the public onboarding options. */
export const ONBOARDING_CONFIG_GLOBAL = '__DSH_MODELS_ONBOARDING__'
