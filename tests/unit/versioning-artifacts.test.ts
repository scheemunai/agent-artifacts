import { describe, expect, it } from 'vitest';
import type { SqliteDatabaseHandle } from '../../src/db/client.js';
import type { ArtifactEvent, CloudModule } from '../../src/extension/cloud-module.js';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { createMigratedSqliteContext } from './db-test-utils.js';

describe('ArtifactService versioning', () => {
  it('creates v1 then slug upsert creates v2 with same artifact id and share url', async () => {
    const ctx = await createMigratedSqliteContext();
    const service = createService(ctx.db);

    try {
      const first = await service.upsertArtifact({
        account: ctx.account,
        slug: 'weekly-report',
        type: 'markdown',
        title: 'Weekly Report',
        content: '# Week 1',
        share: true,
      });
      const second = await service.upsertArtifact({
        account: ctx.account,
        slug: 'weekly-report',
        type: 'markdown',
        title: 'Weekly Report',
        content: '# Week 2',
        share: true,
      });

      expect(first.mode).toBe('created');
      expect(second.mode).toBe('updated');
      expect(second.artifact.id).toBe(first.artifact.id);
      expect(second.artifact.versionNum).toBe(2);
      expect(second.share?.url).toBe(first.share?.url);
      expect(await versionNums(service, first.artifact.id)).toEqual([1, 2]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('unchanged content is a no-op with no version row', async () => {
    const ctx = await createMigratedSqliteContext();
    const service = createService(ctx.db);

    try {
      const first = await service.upsertArtifact({
        account: ctx.account,
        slug: 'same-content',
        type: 'markdown',
        title: 'Same Content',
        content: '# Stable',
      });
      const second = await service.upsertArtifact({
        account: ctx.account,
        slug: 'same-content',
        type: 'markdown',
        title: 'Same Content',
        content: '# Stable',
      });

      expect(second.mode).toBe('unchanged');
      expect(second.artifact.id).toBe(first.artifact.id);
      expect(second.artifact.versionNum).toBe(1);
      expect(second.artifact.updatedAt).toBe(first.artifact.updatedAt);
      expect(await versionNums(service, first.artifact.id)).toEqual([1]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('concurrent writes allocate unique sequential version numbers', async () => {
    const ctx = await createMigratedSqliteContext();
    const service = createService(ctx.db);

    try {
      const first = await service.upsertArtifact({
        account: ctx.account,
        slug: 'concurrent',
        type: 'markdown',
        title: 'Concurrent',
        content: '# v1',
      });

      await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          service.upsertArtifact({
            account: ctx.account,
            slug: 'concurrent',
            type: 'markdown',
            title: `Concurrent ${index}`,
            content: `# v${index + 2}`,
          })
        )
      );

      const nums = await versionNums(service, first.artifact.id);
      const latest = await service.getArtifactById(ctx.account.id, first.artifact.id);

      expect(nums).toEqual([1, 2, 3, 4, 5, 6]);
      expect(new Set(nums).size).toBe(nums.length);
      expect(latest?.versionNum).toBe(6);
    } finally {
      await ctx.cleanup();
    }
  });

  it('restore creates a new version without rewriting history', async () => {
    const ctx = await createMigratedSqliteContext();
    const service = createService(ctx.db);

    try {
      const first = await service.upsertArtifact({
        account: ctx.account,
        slug: 'restore-me',
        type: 'markdown',
        title: 'Restore Me',
        content: '# Original',
      });
      await service.upsertArtifact({
        account: ctx.account,
        slug: 'restore-me',
        type: 'markdown',
        title: 'Restore Me',
        content: '# Changed',
      });
      const restored = await service.restoreVersion({
        account: ctx.account,
        artifactId: first.artifact.id,
        versionNum: 1,
      });
      const versions = await service.listVersions(first.artifact.id);

      expect(restored.mode).toBe('updated');
      expect(restored.artifact.versionNum).toBe(3);
      expect(restored.artifact.content).toBe('# Original');
      expect(versions.map((version) => version.versionNum)).toEqual([1, 2, 3]);
      expect(versions.at(-1)?.restoredFromVersion).toBe(1);
      expect(versions[0]?.content).toBe('# Original');
      expect(versions[1]?.content).toBe('# Changed');
    } finally {
      await ctx.cleanup();
    }
  });

  it('patchArtifact content changes create exactly one new version and emit an update event', async () => {
    const ctx = await createMigratedSqliteContext();
    const events: ArtifactEvent[] = [];
    const service = createService(ctx.db, recordingCloudModule(events));

    try {
      const first = await service.upsertArtifact({
        account: ctx.account,
        slug: 'patch-content',
        type: 'markdown',
        title: 'Patch Content',
        content: '# v1',
      });
      events.length = 0;

      const patched = await service.patchArtifact({
        account: ctx.account,
        idOrSlug: 'patch-content',
        patch: {
          content: '# v2',
          changeSummary: 'service patch',
        },
      });
      const versions = await service.listVersions(first.artifact.id);

      expect(patched.mode).toBe('updated');
      expect(patched.artifact.id).toBe(first.artifact.id);
      expect(patched.artifact.versionNum).toBe(2);
      expect(versions.map((version) => version.versionNum)).toEqual([1, 2]);
      expect(versions[1]?.changeSummary).toBe('service patch');
      expect(events).toEqual([
        expect.objectContaining({
          type: 'artifact.updated',
          accountId: ctx.account.id,
          artifactId: first.artifact.id,
        }),
      ]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('patchArtifact slug and metadata changes do not create a version row', async () => {
    const ctx = await createMigratedSqliteContext();
    const service = createService(ctx.db);

    try {
      const first = await service.upsertArtifact({
        account: ctx.account,
        slug: 'patch-metadata',
        type: 'markdown',
        title: 'Patch Metadata',
        content: '# Stable',
        metadata: { status: 'draft' },
      });

      const patched = await service.patchArtifact({
        account: ctx.account,
        idOrSlug: first.artifact.id,
        patch: {
          slug: 'patch-metadata-renamed',
          metadata: { status: 'reviewed' },
        },
      });

      expect(patched.mode).toBe('unchanged');
      expect(patched.artifact.slug).toBe('patch-metadata-renamed');
      expect(patched.artifact.metadata).toEqual({ status: 'reviewed' });
      expect(patched.artifact.versionNum).toBe(1);
      expect(await versionNums(service, first.artifact.id)).toEqual([1]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('patchArtifact preserves v1 slug conflict status and error code', async () => {
    const ctx = await createMigratedSqliteContext();
    const service = createService(ctx.db);

    try {
      await service.upsertArtifact({
        account: ctx.account,
        slug: 'patch-conflict-a',
        type: 'markdown',
        title: 'Patch Conflict A',
        content: '# A',
      });
      await service.upsertArtifact({
        account: ctx.account,
        slug: 'patch-conflict-b',
        type: 'markdown',
        title: 'Patch Conflict B',
        content: '# B',
      });

      await expect(
        service.patchArtifact({
          account: ctx.account,
          idOrSlug: 'patch-conflict-a',
          patch: { slug: 'patch-conflict-b' },
        })
      ).rejects.toMatchObject({ status: 409, code: 'slug_conflict' });
    } finally {
      await ctx.cleanup();
    }
  });

  it('soft delete revokes the active share', async () => {
    const ctx = await createMigratedSqliteContext();
    const service = createService(ctx.db);

    try {
      const created = await service.upsertArtifact({
        account: ctx.account,
        slug: 'delete-me',
        type: 'markdown',
        title: 'Delete Me',
        content: '# Delete',
        share: true,
      });
      const result = await service.softDeleteArtifact({
        account: ctx.account,
        artifactId: created.artifact.id,
      });
      const artifact = ctx.db.sqlite
        .prepare('SELECT deleted_at FROM artifacts WHERE id = ?')
        .get(created.artifact.id) as { deleted_at: number | null };
      const share = ctx.db.sqlite
        .prepare('SELECT revoked_at FROM shares WHERE id = ?')
        .get(created.share?.shareId) as { revoked_at: number | null };

      expect(result).toEqual({ deleted: true, revokedShareCount: 1 });
      expect(artifact.deleted_at).toEqual(expect.any(Number));
      expect(share.revoked_at).toEqual(expect.any(Number));
      await expect(service.getActiveShare(created.artifact.id)).resolves.toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});

function createService(
  db: SqliteDatabaseHandle,
  extension = createDefaultCloudModule({ aaHideFooter: false })
) {
  return new ArtifactService({
    db,
    extension,
    baseUrl: 'https://example.test',
    now: tickingClock(),
  });
}

function recordingCloudModule(events: ArtifactEvent[]): CloudModule {
  return {
    ...createDefaultCloudModule({ aaHideFooter: false }),
    onArtifactEvent(event) {
      events.push(event);
    },
  };
}

function tickingClock(): () => number {
  let now = 1_800_000_000_000;
  return () => {
    now += 1;
    return now;
  };
}

async function versionNums(service: ArtifactService, artifactId: string): Promise<number[]> {
  return (await service.listVersions(artifactId)).map((version) => version.versionNum);
}
