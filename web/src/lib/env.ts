/**
 * Build-time configuration.
 *
 * There is no `.env.example`: the project is tested on preview deploys, not
 * laptops, so a plain build with no env vars set is already production —
 * the values below are the production ones.
 */
export const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? 'pk_live_Y2xlcmsubHl6bi5haSQ'
export const API_URL = (import.meta.env.VITE_API_URL ?? 'https://api.lyzn.ai').replace(/\/$/, '')
export const POSTHOG_KEY =
  import.meta.env.VITE_POSTHOG_KEY ?? 'phc_WCIguKwxzqlJYYaH9Ts0dLNJNDOitqNDO3u4la1cyUt'
export const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST ?? 'https://us.i.posthog.com'
