import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoist mock variables so they're available in vi.mock factories
const { mockGetInstallationOctokit, mockAppOctokitRequest } = vi.hoisted(() => ({
  mockGetInstallationOctokit: vi.fn(),
  mockAppOctokitRequest: vi.fn(),
}));

vi.mock("@octokit/app", () => ({
  App: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.getInstallationOctokit = mockGetInstallationOctokit;
    this.octokit = { request: mockAppOctokitRequest };
  }),
}));
vi.mock("@/config/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { loadConfig } from "@/config/config.js";
import {
  getAuthenticatedCloneUrl,
  getInstallationToken,
  getOctokit,
  resetOctokit,
} from "@/core/github/auth.js";
import { createPullRequest, getPRStatus } from "@/core/github/pr.js";
import { App } from "@octokit/app";

const mockLoadConfig = loadConfig as unknown as ReturnType<typeof vi.fn>;
const MockAppConstructor = App as unknown as ReturnType<typeof vi.fn>;

function makeGithubConfig() {
  return {
    github: {
      appId: "12345",
      privateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
      installationId: "67890",
    },
  };
}

function makeMockOctokit() {
  return {
    request: vi.fn(),
  };
}

describe("github-service", () => {
  beforeEach(() => {
    mockGetInstallationOctokit.mockReset();
    mockAppOctokitRequest.mockReset();
    mockLoadConfig.mockReset();
    MockAppConstructor.mockClear();
    resetOctokit();
  });

  describe("parseRepo (tested via createPullRequest and getPRStatus)", () => {
    // parseRepo is a private function, so we test it through the public API.
    // We configure getOctokit to succeed and test various repo formats.

    it("should parse owner/repo format", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);
      mockOctokit.request.mockResolvedValue({
        data: { html_url: "https://github.com/owner/repo/pull/1", number: 1, state: "open" },
      });

      const result = await createPullRequest({
        repo: "myowner/myrepo",
        branch: "feature",
        title: "Test PR",
        body: "Body",
      });

      expect(mockOctokit.request).toHaveBeenCalledWith(
        "POST /repos/{owner}/{repo}/pulls",
        expect.objectContaining({ owner: "myowner", repo: "myrepo" })
      );
      expect(result.number).toBe(1);
    });

    it("should parse full HTTPS GitHub URL", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);
      mockOctokit.request.mockResolvedValue({
        data: { html_url: "https://github.com/org/project/pull/5", number: 5, state: "open" },
      });

      await createPullRequest({
        repo: "https://github.com/org/project",
        branch: "fix",
        title: "Fix PR",
        body: "Fix body",
      });

      expect(mockOctokit.request).toHaveBeenCalledWith(
        "POST /repos/{owner}/{repo}/pulls",
        expect.objectContaining({ owner: "org", repo: "project" })
      );
    });

    it("should parse GitHub URL with .git suffix", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);
      mockOctokit.request.mockResolvedValue({
        data: { html_url: "https://github.com/user/repo/pull/10", number: 10, state: "open" },
      });

      await createPullRequest({
        repo: "https://github.com/user/repo.git",
        branch: "branch",
        title: "PR",
        body: "Body",
      });

      expect(mockOctokit.request).toHaveBeenCalledWith(
        "POST /repos/{owner}/{repo}/pulls",
        expect.objectContaining({ owner: "user", repo: "repo" })
      );
    });

    it("should reject invalid GitHub URL (not github.com domain)", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      await expect(
        createPullRequest({
          repo: "https://gitlab.com/owner/repo",
          branch: "branch",
          title: "PR",
          body: "Body",
        })
      ).rejects.toThrow("Invalid GitHub URL");
    });

    it("should reject GitHub URL with no repo path", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      await expect(
        createPullRequest({
          repo: "https://github.com/onlyone",
          branch: "branch",
          title: "PR",
          body: "Body",
        })
      ).rejects.toThrow("Invalid GitHub URL");
    });

    it("should reject invalid owner/repo format (too many parts)", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      await expect(
        createPullRequest({
          repo: "a/b/c",
          branch: "branch",
          title: "PR",
          body: "Body",
        })
      ).rejects.toThrow("Invalid repo format");
    });

    it("should reject empty string", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      await expect(
        createPullRequest({
          repo: "",
          branch: "branch",
          title: "PR",
          body: "Body",
        })
      ).rejects.toThrow("Invalid repo format");
    });

    it("should reject single word (no slash)", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      await expect(
        createPullRequest({
          repo: "justrepo",
          branch: "branch",
          title: "PR",
          body: "Body",
        })
      ).rejects.toThrow("Invalid repo format");
    });

    it("should reject owner/ with empty repo name", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      await expect(
        createPullRequest({
          repo: "owner/",
          branch: "branch",
          title: "PR",
          body: "Body",
        })
      ).rejects.toThrow("Invalid repo format");
    });

    it("should reject /repo with empty owner", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      await expect(
        createPullRequest({
          repo: "/repo",
          branch: "branch",
          title: "PR",
          body: "Body",
        })
      ).rejects.toThrow("Invalid repo format");
    });
  });

  describe("getOctokit", () => {
    it("should create Octokit from GitHub App credentials", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      const result = await getOctokit();

      expect(App).toHaveBeenCalledWith({
        appId: "12345",
        privateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
      });
      expect(mockGetInstallationOctokit).toHaveBeenCalledWith(67890);
      expect(result).toBe(mockOctokit);
    });

    it("should cache Octokit instance across calls", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      const first = await getOctokit();
      const second = await getOctokit();

      expect(first).toBe(second);
      expect(App).toHaveBeenCalledTimes(1);
    });

    it("should throw when GitHub App credentials are missing", async () => {
      mockLoadConfig.mockReturnValue({});

      await expect(getOctokit()).rejects.toThrow("GitHub App credentials not configured");
    });

    it("should throw when only appId is provided", async () => {
      mockLoadConfig.mockReturnValue({
        github: { appId: "123" },
      });

      await expect(getOctokit()).rejects.toThrow("GitHub App credentials not configured");
    });

    it("should throw when privateKey is missing", async () => {
      mockLoadConfig.mockReturnValue({
        github: { appId: "123", installationId: "456" },
      });

      await expect(getOctokit()).rejects.toThrow("GitHub App credentials not configured");
    });
  });

  describe("createPullRequest", () => {
    it("should create PR with correct parameters", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);
      mockOctokit.request.mockResolvedValue({
        data: {
          html_url: "https://github.com/owner/repo/pull/42",
          number: 42,
          state: "open",
        },
      });

      const result = await createPullRequest({
        repo: "owner/repo",
        branch: "feature-branch",
        title: "Add new feature",
        body: "This adds a great feature",
      });

      expect(mockOctokit.request).toHaveBeenCalledWith("POST /repos/{owner}/{repo}/pulls", {
        owner: "owner",
        repo: "repo",
        title: "Add new feature",
        body: "This adds a great feature",
        head: "feature-branch",
        base: "main",
      });
      expect(result).toEqual({
        url: "https://github.com/owner/repo/pull/42",
        number: 42,
        state: "open",
      });
    });

    it("should use custom base branch when provided", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);
      mockOctokit.request.mockResolvedValue({
        data: {
          html_url: "https://github.com/owner/repo/pull/1",
          number: 1,
          state: "open",
        },
      });

      await createPullRequest({
        repo: "owner/repo",
        branch: "hotfix",
        title: "Hotfix",
        body: "Urgent fix",
        base: "release",
      });

      expect(mockOctokit.request).toHaveBeenCalledWith(
        "POST /repos/{owner}/{repo}/pulls",
        expect.objectContaining({ base: "release" })
      );
    });

    it("should throw on API error", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);
      mockOctokit.request.mockRejectedValue(new Error("Validation Failed"));

      await expect(
        createPullRequest({
          repo: "owner/repo",
          branch: "branch",
          title: "PR",
          body: "Body",
        })
      ).rejects.toThrow("Failed to create PR: Validation Failed");
    });

    it("should rethrow non-Error exceptions", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);
      mockOctokit.request.mockRejectedValue("raw error");

      await expect(
        createPullRequest({
          repo: "owner/repo",
          branch: "branch",
          title: "PR",
          body: "Body",
        })
      ).rejects.toBe("raw error");
    });
  });

  describe("getPRStatus", () => {
    it("should return full PR status with checks and reviews", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      // Three sequential API calls: PR details, check runs, reviews
      mockOctokit.request
        .mockResolvedValueOnce({
          data: {
            state: "open",
            mergeable: true,
            head: { sha: "abc123" },
          },
        })
        .mockResolvedValueOnce({
          data: {
            check_runs: [
              { name: "CI", status: "completed", conclusion: "success" },
              { name: "Lint", status: "completed", conclusion: "failure" },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: [
            {
              user: { login: "reviewer1" },
              state: "APPROVED",
              submitted_at: "2024-01-01T00:00:00Z",
            },
          ],
        });

      const status = await getPRStatus(42, "owner/repo");

      expect(status.state).toBe("open");
      expect(status.mergeable).toBe(true);
      expect(status.checks).toEqual([
        { name: "CI", status: "completed", conclusion: "success" },
        { name: "Lint", status: "completed", conclusion: "failure" },
      ]);
      expect(status.reviews).toEqual([
        { user: "reviewer1", state: "APPROVED", submittedAt: "2024-01-01T00:00:00Z" },
      ]);
    });

    it("should handle null mergeable state", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      mockOctokit.request
        .mockResolvedValueOnce({
          data: { state: "open", mergeable: null, head: { sha: "abc" } },
        })
        .mockResolvedValueOnce({ data: { check_runs: [] } })
        .mockResolvedValueOnce({ data: [] });

      const status = await getPRStatus(1, "owner/repo");

      expect(status.mergeable).toBeNull();
      expect(status.checks).toEqual([]);
      expect(status.reviews).toEqual([]);
    });

    it("should handle reviews with missing user", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      mockOctokit.request
        .mockResolvedValueOnce({
          data: { state: "open", mergeable: true, head: { sha: "abc" } },
        })
        .mockResolvedValueOnce({ data: { check_runs: [] } })
        .mockResolvedValueOnce({
          data: [{ user: null, state: "COMMENTED", submitted_at: null }],
        });

      const status = await getPRStatus(1, "owner/repo");

      expect(status.reviews[0]?.user).toBe("unknown");
      expect(status.reviews[0]?.submittedAt).toBe("");
    });

    it("should use the head sha from PR for check runs lookup", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      mockOctokit.request
        .mockResolvedValueOnce({
          data: { state: "open", mergeable: true, head: { sha: "specific-sha-999" } },
        })
        .mockResolvedValueOnce({ data: { check_runs: [] } })
        .mockResolvedValueOnce({ data: [] });

      await getPRStatus(5, "owner/repo");

      expect(mockOctokit.request).toHaveBeenCalledWith(
        "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
        expect.objectContaining({ ref: "specific-sha-999" })
      );
    });

    it("should throw on API error", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);
      mockOctokit.request.mockRejectedValue(new Error("Not Found"));

      await expect(getPRStatus(999, "owner/repo")).rejects.toThrow(
        "Failed to get PR status: Not Found"
      );
    });

    it("should rethrow non-Error exceptions", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);
      mockOctokit.request.mockRejectedValue(404);

      await expect(getPRStatus(999, "owner/repo")).rejects.toBe(404);
    });

    it("should parse repo from full GitHub URL in getPRStatus", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit = makeMockOctokit();
      mockGetInstallationOctokit.mockResolvedValue(mockOctokit);

      mockOctokit.request
        .mockResolvedValueOnce({
          data: { state: "closed", mergeable: false, head: { sha: "sha1" } },
        })
        .mockResolvedValueOnce({ data: { check_runs: [] } })
        .mockResolvedValueOnce({ data: [] });

      await getPRStatus(10, "https://github.com/myorg/myrepo.git");

      expect(mockOctokit.request).toHaveBeenCalledWith(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        expect.objectContaining({ owner: "myorg", repo: "myrepo" })
      );
    });
  });

  describe("getInstallationToken", () => {
    it("should return token from installation access token endpoint", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      mockAppOctokitRequest.mockResolvedValue({
        data: { token: "ghs_mock_installation_token" },
      });

      const token = await getInstallationToken();

      expect(token).toBe("ghs_mock_installation_token");
      expect(mockAppOctokitRequest).toHaveBeenCalledWith(
        "POST /app/installations/{installation_id}/access_tokens",
        { installation_id: 67890 }
      );
    });

    it("should throw when credentials are missing", async () => {
      mockLoadConfig.mockReturnValue({});

      await expect(getInstallationToken()).rejects.toThrow("GitHub App credentials not configured");
    });
  });

  describe("getAuthenticatedCloneUrl", () => {
    it("should return HTTPS URL with embedded token for owner/repo format", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      mockAppOctokitRequest.mockResolvedValue({
        data: { token: "ghs_test_token" },
      });

      const url = await getAuthenticatedCloneUrl("myowner/myrepo");

      expect(url).toBe("https://x-access-token:ghs_test_token@github.com/myowner/myrepo.git");
    });

    it("should return HTTPS URL with embedded token for full GitHub URL", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      mockAppOctokitRequest.mockResolvedValue({
        data: { token: "ghs_test_token_2" },
      });

      const url = await getAuthenticatedCloneUrl("https://github.com/org/project.git");

      expect(url).toBe("https://x-access-token:ghs_test_token_2@github.com/org/project.git");
    });

    it("should throw for invalid repo format", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());

      await expect(getAuthenticatedCloneUrl("invalid")).rejects.toThrow("Invalid repo format");
    });

    it("should throw when credentials are missing", async () => {
      mockLoadConfig.mockReturnValue({});

      await expect(getAuthenticatedCloneUrl("owner/repo")).rejects.toThrow(
        "GitHub App credentials not configured"
      );
    });
  });

  describe("resetOctokit", () => {
    it("should clear cached instance so next call re-creates it", async () => {
      mockLoadConfig.mockReturnValue(makeGithubConfig());
      const mockOctokit1 = makeMockOctokit();
      const mockOctokit2 = makeMockOctokit();
      mockGetInstallationOctokit
        .mockResolvedValueOnce(mockOctokit1)
        .mockResolvedValueOnce(mockOctokit2);

      const first = await getOctokit();
      expect(first).toBe(mockOctokit1);

      resetOctokit();

      const second = await getOctokit();
      expect(second).toBe(mockOctokit2);
      expect(App).toHaveBeenCalledTimes(2);
    });
  });
});
