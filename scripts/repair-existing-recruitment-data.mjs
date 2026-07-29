import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

import { canonicalRecruitmentUrl } from '../src/core/canonical-recruitment-url.mjs';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    out[token.slice(2)] = !next || next.startsWith('--') ? true : next;
    if (out[token.slice(2)] !== true) index += 1;
  }
  return out;
}

function portalRank(portal, normalizedUrl) {
  return (portal.canonical_url === normalizedUrl ? 10_000 : 0)
    + ({ VERIFIED: 3_000, REVIEW: 2_000, BLOCKED: 1_000, REJECTED: 0 }[portal.verification_status] || 0)
    + (portal.hiring_availability === 'OPENINGS_FOUND' ? 500 : 0)
    + ({ JOB_LIST: 100, CAMPAIGN: 90, CAREER_HOME: 80, APPLY: 70, JOB_DETAIL: 20 }[portal.page_type] || 0)
    + Number(portal.confidence_score || 0);
}

export async function repairExistingRecruitmentData({
  databaseFile = 'data/lite-job-search.sqlite',
  backupDir = 'data/backups',
  apply = false,
} = {}) {
  const databasePath = path.resolve(databaseFile);
  const database = new Database(databasePath, apply ? {} : { readonly: true });
  try {
    const portals = database.prepare(`
      SELECT * FROM career_portals
      WHERE superseded_by_portal_id IS NULL
      ORDER BY company_id, canonical_url, id
    `).all();
    const groups = new Map();
    for (const portal of portals) {
      const normalizedUrl = canonicalRecruitmentUrl(portal.canonical_url);
      const key = `${portal.company_id}|${normalizedUrl}`;
      const group = groups.get(key) || { normalizedUrl, portals: [] };
      group.portals.push(portal);
      groups.set(key, group);
    }
    const duplicateGroups = [...groups.values()].filter((group) => group.portals.length > 1);
    const affectedPortalRows = duplicateGroups.reduce((sum, group) => sum + group.portals.length - 1, 0);
    const incompleteTasks = database.prepare(`
      SELECT tasks.id, tasks.batch_id,
        SUM(CASE WHEN items.status = 'DEFERRED' THEN 1 ELSE 0 END) AS deferred,
        SUM(CASE WHEN items.status = 'FAILED' THEN 1 ELSE 0 END) AS failed
      FROM control_tasks AS tasks
      JOIN batch_items AS items ON items.batch_id = tasks.batch_id
      WHERE tasks.state = 'COMPLETE'
      GROUP BY tasks.id, tasks.batch_id
      HAVING deferred > 0 OR failed > 0
    `).all();
    let backupFile = null;
    if (apply && (affectedPortalRows || incompleteTasks.length)) {
      await mkdir(path.resolve(backupDir), { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupFile = path.resolve(backupDir, `lite-job-search-before-recruitment-repair-${stamp}.sqlite`);
      await copyFile(databasePath, backupFile);
      const now = new Date().toISOString();
      database.transaction(() => {
        const moveJobs = database.prepare('UPDATE job_openings SET career_portal_id = ? WHERE career_portal_id = ?');
        const moveEvents = database.prepare('UPDATE recruitment_events SET career_portal_id = ? WHERE career_portal_id = ?');
        const supersede = database.prepare('UPDATE career_portals SET superseded_by_portal_id = ? WHERE id = ?');
        const normalizeWinner = database.prepare('UPDATE career_portals SET url = ?, canonical_url = ? WHERE id = ?');
        for (const group of duplicateGroups) {
          const [winner, ...duplicates] = [...group.portals]
            .sort((left, right) => portalRank(right, group.normalizedUrl) - portalRank(left, group.normalizedUrl));
          if (winner.canonical_url !== group.normalizedUrl) {
            normalizeWinner.run(group.normalizedUrl, group.normalizedUrl, winner.id);
          }
          for (const duplicate of duplicates) {
            moveJobs.run(winner.id, duplicate.id);
            moveEvents.run(winner.id, duplicate.id);
            supersede.run(winner.id, duplicate.id);
          }
        }
        const markTaskPartial = database.prepare(`
          UPDATE control_tasks SET state = 'PARTIAL', updated_at = ? WHERE id = ?
        `);
        for (const task of incompleteTasks) markTaskPartial.run(now, task.id);
        database.prepare(`
          INSERT INTO audit_logs (
            id, action, target_type, target_id, actor, details_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          'RECRUITMENT_DATA_QUALITY_REPAIR',
          'DATABASE',
          databasePath,
          'codex',
          JSON.stringify({
            duplicateGroups: duplicateGroups.length,
            supersededPortals: affectedPortalRows,
            incompleteTasks: incompleteTasks.length,
            backupFile,
          }),
          now,
        );
      })();
    }
    return {
      status: apply ? 'APPLIED' : 'AUDIT_ONLY',
      duplicateGroups: duplicateGroups.length,
      supersededPortals: affectedPortalRows,
      incompleteTasks: incompleteTasks.length,
      backupFile,
    };
  } finally {
    database.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = parseArgs(process.argv.slice(2));
  repairExistingRecruitmentData({
    databaseFile: input.database,
    backupDir: input['backup-dir'],
    apply: input.apply === true,
  }).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ status: 'FAILED', error: String(error?.message || error) })}\n`);
      process.exitCode = 2;
    });
}
