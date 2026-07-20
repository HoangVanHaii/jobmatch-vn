/**
 * GitHub Lookup service — Phase 2
 * Tra cứu GitHub profile, cache 7 ngày
 */
import { Octokit } from '@octokit/rest';
import { db } from '../config/database';
import { githubLookups } from '../db/schema';
import { eq, lt, sql } from 'drizzle-orm';
import { logger } from '../config/logger';

export interface GitHubProfile {
  username: string;
  exists: boolean;
  has_activity: boolean;
  public_repos: number;
  followers: number;
  following: number;
  top_repos: Array<{ name: string; stars: number; language: string; url: string }>;
  languages: Record<string, number>;
  created_at: string;
  bio: string;
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const octokit = GITHUB_TOKEN ? new Octokit({ auth: GITHUB_TOKEN }) : new Octokit();

export const githubLookupService = {
  /** Extract username từ GitHub URL */
  extractUsername: (url: string): string | null => {
    const match = url.match(/github\.com\/([a-zA-Z0-9-]+)/);
    return match ? match[1] : null;
  },

  /** Tra cứu 1 username, cache 7 ngày */
  lookup: async (username: string): Promise<GitHubProfile> => {
    // Check cache
    const cached = await db.query.githubLookups.findFirst({
      where: eq(githubLookups.username, username),
    });
    if (cached && cached.expiresAt > new Date()) {
      return { username, ...cached.profileData } as any;
    }

    try {
      // Gọi GitHub API
      const { data: user } = await octokit.users.getByUsername({ username });
      const { data: repos } = await octokit.repos.listForAuthenticatedUser
        ? await octokit.repos.listForAuthenticatedUser({ username, per_page: 100, sort: 'stars' })
        : { data: [] };

      const top_repos = repos
        .sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
        .slice(0, 5)
        .map((r) => ({ name: r.name, stars: r.stargazers_count ?? 0, language: r.language ?? '', url: r.html_url }));

      const languages: Record<string, number> = {};
      repos.forEach((r) => { if (r.language) languages[r.language] = (languages[r.language] || 0) + 1; });

      const has_activity = repos.some((r) => {
        const updated = new Date(r.updated_at ?? '');
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        return updated > sixMonthsAgo;
      });

      const profile: GitHubProfile = {
        username,
        exists: true,
        has_activity,
        public_repos: user.public_repos,
        followers: user.followers,
        following: user.following,
        top_repos,
        languages,
        created_at: user.created_at,
        bio: user.bio ?? '',
      };

      // Cache 7 ngày
      await db.insert(githubLookups).values({
        username,
        exists: true,
        profileData: profile,
      }).onConflictDoUpdate({
        target: githubLookups.username,
        set: { profileData: profile, fetchedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
      });

      return profile;
    } catch (err: any) {
      if (err.status === 404) {
        // User không tồn tại — cache kết quả
        await db.insert(githubLookups).values({
          username,
          exists: false,
          profileData: { exists: false },
        }).onConflictDoUpdate({
          target: githubLookups.username,
          set: { exists: false, profileData: { exists: false }, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
        });
        return { username, exists: false, has_activity: false, public_repos: 0, followers: 0, following: 0, top_repos: [], languages: {}, created_at: '', bio: '' };
      }
      logger.error({ err, username }, 'GitHub lookup failed');
      throw err;
    }
  },

  /** Tra cứu từ GitHub URL */
  lookupFromUrl: async (url: string): Promise<GitHubProfile> => {
    const username = githubLookupService.extractUsername(url);
    if (!username) return { username: '', exists: false, has_activity: false, public_repos: 0, followers: 0, following: 0, top_repos: [], languages: {}, created_at: '', bio: '' };
    return githubLookupService.lookup(username);
  },
};