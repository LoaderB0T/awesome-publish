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

    const result = await service.createRelease({ tag: 'v1.0.0', body: 'Release notes' });
    expect(result.id).toBe(123);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/releases',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('updates a release', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await service.updateRelease(123, 'Updated notes');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/owner/repo/releases/123',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('sends prerelease flag in request body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 456 }),
    });

    await service.createRelease({ tag: 'v1.0.0-beta.0', prerelease: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.prerelease).toBe(true);
    expect(body.tag_name).toBe('v1.0.0-beta.0');
  });

  it('sends draft flag in request body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 789 }),
    });

    await service.createRelease({ tag: 'v1.0.0', draft: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.draft).toBe(true);
    expect(body.prerelease).toBe(false);
  });

  it('throws on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Bad credentials',
    });

    await expect(service.createRelease({ tag: 'v1.0.0' })).rejects.toThrow(/401/);
  });
});
