/** Browser-test fixture only. Exercises the production queue, callbacks, review and
 * document renderer with deterministic speech/extraction in place of large models.
 * Never imported by the application, Makefile dev runner or production containers. */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, join, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(join(root, 'apps/api/package.json'));
const { Pool } = require('pg');
if (process.env.MANE_E2E_FIXTURES !== '1' || process.env.NODE_ENV !== 'test') {
  throw new Error('Fixture worker requires MANE_E2E_FIXTURES=1 and NODE_ENV=test.');
}
const databaseUrl = new URL(process.env.DATABASE_URL || '');
const isTestDatabase = /(?:_test|_e2e)$/.test(databaseUrl.pathname);
const isTestSchema = /search_path[= ](?:[\w]*_)?(?:test|e2e)[\w]*(?:,public)?(?:\s|$)/.test(
  databaseUrl.searchParams.get('options') || '',
);
if (!isTestDatabase && !isTestSchema)
  throw new Error('Fixture worker requires an isolated test database or test/e2e schema.');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname))
  throw new Error('Test database must be on loopback.');
const apiUrl = new URL(process.env.API_URL || 'http://127.0.0.1:4000');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(apiUrl.hostname))
  throw new Error('Test API must be on loopback.');
const secret = process.env.WORKER_TOKEN || '';
if (secret.length < 32) throw new Error('WORKER_TOKEN must contain at least 32 characters.');
const dataDir = resolve(process.env.DATA_DIR || process.env.STORAGE_PATH || join(root, 'data/e2e'));
const python = process.env.WORKER_PYTHON || join(root, 'services/doc-worker/.venv/bin/python');
const pool = new Pool({ connectionString: databaseUrl.toString(), max: 2 });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopping = true;
  });

function log(event, details = {}) {
  console.log(JSON.stringify({ service: 'mane-e2e-fixture-worker', event, ...details }));
}
function pathInData(key) {
  const target = resolve(dataDir, key);
  if (!target.startsWith(dataDir + sep)) throw new Error('Unsafe fixture storage key');
  return target;
}
async function api(path, body) {
  const response = await fetch(new URL(path, apiUrl), {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: { 'x-worker-token': secret, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`API ${response.status}: ${result.error || response.statusText}`);
  return result.data;
}
async function pythonJson(source, input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(python, ['-c', source], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: join(root, 'services/doc-worker/src') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      errors = '';
    const timeout = setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      output += text;
    });
    child.stderr.on('data', (text) => {
      errors += text;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(`Fixture renderer failed: ${errors}`));
      try {
        resolveResult(JSON.parse(output));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
const inspectWav = `
import json, sys, wave
p=json.load(sys.stdin)
with wave.open(p['path'],'rb') as audio:
    if audio.getsampwidth()!=2 or audio.getnchannels()!=1:
        raise ValueError('Browser fixture must be mono PCM16 WAV')
    duration=audio.getnframes()/audio.getframerate()
    if duration < 2:
        raise ValueError('Browser fixture must contain at least 2 seconds of audio')
print(json.dumps({'durationS':duration}))
`;
const render = `
import json, sys
from pathlib import Path
from mane_worker.models import Transcript
from mane_worker.rendering import render_minutes
from mane_worker.adapters.storage import metadata
p=json.load(sys.stdin)
root=Path(p['root'])
key=p['key']
directory=Path(p['dataDir'])/key
schema=json.loads((root/'packages/shared/minutes.schema.json').read_text())
docx,markdown=render_minutes(p['content'],Transcript.model_validate(p['transcript']),root/'services/doc-worker/templates/minutes.docx',directory,schema,p['meetingId'])
print(json.dumps({'docx':metadata(key+'/minutes.docx',str(docx),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),'markdown':metadata(key+'/minutes.md',str(markdown),'text/markdown')}))
`;
async function claim() {
  const lease = randomUUID();
  const { rows } = await pool.query(
    `WITH candidate AS (
    SELECT id FROM doc_jobs WHERE attempts < 3 AND (status='queued' OR
      (status='running' AND locked_at < now()-interval '30 seconds'))
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE doc_jobs j SET status='running',locked_by=$1,locked_at=now(),
    attempts=j.attempts+1,updated_at=now() FROM candidate c WHERE j.id=c.id RETURNING j.*`,
    [lease],
  );
  const job = rows[0];
  if (job && job.kind !== 'render')
    await pool.query('UPDATE meetings SET status=$2,updated_at=now() WHERE id=$1', [
      job.meeting_id,
      job.kind === 'transcribe' ? 'transcribing' : 'drafting',
    ]);
  return job;
}
async function processJob(job) {
  const context = await api(`/internal/jobs/${job.id}/context`);
  let result;
  const reviewer = context.users.find((user) => user.id === context.meeting.reviewerId);
  const name = reviewer?.displayName || 'Test reviewer';
  if (job.kind === 'transcribe') {
    // Read the actual uploaded recording. A mislabeled or invalid WAV fails the job.
    const wav = await pythonJson(inspectWav, { path: pathInData(context.audio.storageKey) });
    const middle = wav.durationS / 2;
    result = {
      durationS: wav.durationS,
      transcript: {
        language: 'en',
        segments: [
          {
            start_s: 0,
            end_s: middle,
            speaker: name,
            text: 'We agreed to share the project brief with the team.',
          },
          {
            start_s: middle,
            end_s: wav.durationS,
            speaker: name,
            text: `${name} will prepare the project brief.`,
          },
        ],
      },
    };
  } else if (job.kind === 'draft') {
    const segments = context.transcript.segments;
    result = {
      content: {
        title: context.meeting.title,
        held_at: context.meeting.heldAt || null,
        attendees: [{ name, matched_user_id: reviewer?.id || null }],
        summary:
          'The team reviewed the project brief. They agreed to share it with the team. An owner will prepare the brief for review.',
        agenda: ['Project brief'],
        decisions: [
          {
            text: 'Share the project brief with the team.',
            evidence: [{ start_s: segments[0].start_s, end_s: segments[0].end_s }],
          },
        ],
        action_items: [
          {
            text: 'Prepare the project brief.',
            owner: name,
            due_date: null,
            evidence: [{ start_s: segments[1].start_s, end_s: segments[1].end_s }],
          },
        ],
        open_questions: [],
        risks: [],
        next_meeting: null,
        confidence_notes: [
          'Browser test fixture: transcript and extraction are deterministic. No speech or language model inference ran.',
        ],
      },
    };
  } else {
    const key = `generated/${context.meeting.id}/v${context.minutes.version}/${job.locked_by}`;
    result = await pythonJson(render, {
      root,
      dataDir,
      key,
      meetingId: context.meeting.id,
      content: context.minutes.content,
      transcript: { language: context.transcript.language, segments: context.transcript.segments },
    });
    // Confirm a real Word ZIP was produced before reporting artifacts to the API.
    const bytes = await readFile(pathInData(result.docx.storageKey));
    if (bytes.readUInt32LE(0) !== 0x04034b50) throw new Error('Renderer did not produce a Word archive');
  }
  await api(`/internal/jobs/${job.id}/complete`, { lockToken: job.locked_by, ...result });
  log('job.complete', { jobId: job.id, kind: job.kind });
}
log('ready', { database: databaseUrl.pathname, fixture: true });
try {
  let connectionFailures = 0;
  while (!stopping) {
    let job;
    try {
      job = await claim();
      connectionFailures = 0;
    } catch (error) {
      if (++connectionFailures > 60) throw error;
      await delay(500);
      continue; // The test API may still be applying its initial migration.
    }
    if (!job) {
      await delay(200);
      continue;
    }
    const heartbeat = setInterval(
      () =>
        pool
          .query("UPDATE doc_jobs SET locked_at=now() WHERE id=$1 AND locked_by=$2 AND status='running'", [
            job.id,
            job.locked_by,
          ])
          .catch((error) => log('heartbeat.error', { error: error.message })),
      3000,
    );
    try {
      await processJob(job);
    } catch (error) {
      log('job.error', { jobId: job.id, error: error.message });
      await api(`/internal/jobs/${job.id}/fail`, { lockToken: job.locked_by, error: error.message }).catch(
        (callbackError) => log('callback.error', { error: callbackError.message }),
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
} finally {
  await pool.end();
}
