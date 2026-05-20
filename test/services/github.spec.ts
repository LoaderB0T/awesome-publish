import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubService } from '../../src/services/github.js';

describe('GitHubService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: GitHubService;

  beforeEach(() => {
    fetchMock = vi.fn();
    service = new GitHubService('owner', 'repo', 'test-token', fetchMock as any);
  });

  it('creates a release', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 123 }),
    });

    const result = await service.createRelease('v1.0.0', 'Release notes');
    expect(result.id).toBe(123);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/releases',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('updates a release', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await service.updateRelease(123, 'Updated notes');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/releases/123',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Bad credentials',
    });

    await expect(service.createRelease('v1.0.0')).rejects.toThrow(/401/);
  });
});
