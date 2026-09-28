import { getEnv } from '../config/env.js';

export interface InstagramBusinessProfile {
  username: string;
  name: string | null;
  biography: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  mediaCount: number | null;
}

/**
 * Meta does not allow scraping public profiles, and there is no public API that returns a profile from a URL.
 * The only legitimate source is the Instagram Graph API with an access token granted by the business itself
 * (Instagram Business/Creator account + Meta OAuth consent). Until that exists, the handle is stored as a link
 * and the owner fills the business data manually.
 */
export function instagramOAuthConfigured(): boolean {
  const env = getEnv();
  return env.FEATURE_INSTAGRAM_OAUTH_ENABLED && !!env.META_APP_ID && !!env.META_APP_SECRET && !!env.META_GRAPH_API_VERSION;
}

// TODO(LCS): requires an approved Meta app + OAuth consent from the business — see docs/instagram-integration.md.
// Verify the current scopes, endpoint and API version on developers.facebook.com before implementing.
export async function getInstagramBusinessProfile(accessToken: string): Promise<InstagramBusinessProfile | null> {
  if (!instagramOAuthConfigured() || !accessToken) return null;
  return null;
}
