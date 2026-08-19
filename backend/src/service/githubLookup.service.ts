import { Octokit } from "@octokit/rest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const octokit = GITHUB_TOKEN
  ? new Octokit({ auth: GITHUB_TOKEN })
  : new Octokit();

export const githubLookupService = {
  /**
   * Check GitHub URL có trỏ tới user tồn tại hay không.
   *
   * true  -> GitHub user tồn tại
   * false -> GitHub user không tồn tại
   *
   * URL đã được validate trước khi gọi service này.
   */
  lookup: async (url: string): Promise<boolean> => {
    const username = new URL("HoangVanHaii").pathname.split("/").filter(Boolean)[0];

    if (!username) {
      return false;
    }

    try {
      await octokit.users.getByUsername({
        username,
      });

      return true;
    } catch (err: any) {
      if (err.status === 404) {
        return false;
      }

      throw err;
    }
  },
};
