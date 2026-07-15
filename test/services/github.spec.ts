import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubService, parseRemoteUrl } from '../../src/services/github.js';

describe('parseRemoteUrl', () => {
  it('parses ssh and https remotes', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseRemoteUrl('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseRemoteUrl('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('handles repo names containing dots (regression for B2)', () => {
    expect(parseRemoteUrl('git@github.com:owner/foo.js.git')).toEqual({
      owner: 'owner',
      repo: 'foo.js',
    });
    expect(parseRemoteUrl('https://github.com/owner/my.cool.repo')).toEqual({
      owner: 'owner',
      repo: 'my.cool.repo',
    });
  });

  it('throws on an unparseable remote', () => {
    expect(() => parseRemoteUrl('not-a-url')).toThrow(/Could not parse/);
  });
});

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

  it('reuses an existing release on 422 already_exists (idempotent re-run)', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        text: async () => '{"errors":[{"code":"already_exists"}]}',
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 555 }) });

    const result = await service.createRelease({ tag: 'v1.0.0' });
    expect(result.id).toBe(555);
    // Second call is the GET releases/tags/<tag> lookup.
    expect(fetchMock.mock.calls[1][0]).toContain('/releases/tags/v1.0.0');
  });

  it('sends target_commitish when target is provided', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 1 }) });
    await service.createRelease({ tag: 'v1.0.0', target: 'abc123' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.target_commitish).toBe('abc123');
  });
});
