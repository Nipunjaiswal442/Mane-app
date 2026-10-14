"""Real PostgreSQL recovery drill in an isolated, disposable, networkless container.

Uses the application schema and deliberately seeded published-meeting records; does
not claim that a speech/LLM pipeline has run. No existing database/volume is touched.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid
import wave

ROOT = Path(__file__).resolve().parent.parent


def main():
    with tempfile.TemporaryDirectory(prefix="mane-recovery-drill-") as temporary:
        work = Path(temporary)
        compose = work / "compose.yml"
        compose.write_text(f"""name: mane-recovery-{uuid.uuid4().hex[:12]}
services:
  postgres:
    image: postgres:16-alpine
    pull_policy: never
    network_mode: none
    environment:
      POSTGRES_USER: mane
      POSTGRES_PASSWORD: disposable-recovery-test-only
      POSTGRES_DB: mane
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: [CMD-SHELL, "pg_isready -U mane -d mane"]
      interval: 1s
      timeout: 3s
      retries: 30
""")
        dc = ["docker", "compose", "-f", str(compose)]

        def sql(statement, database="mane"):
            return subprocess.run(
                [*dc, "exec", "-T", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "mane", "-d", database, "-At"],
                input=statement, text=True, capture_output=True, check=True,
            ).stdout.strip()

        try:
            subprocess.run([*dc, "up", "-d", "--wait"], check=True)
            sql((ROOT / "apps/api/src/db/001_initial.sql").read_text())
            sql("CREATE TABLE schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); INSERT INTO schema_migrations(name) VALUES('001_initial');")
            storage = work / "storage"
            storage.mkdir()
            (storage / "minutes.md").write_text("# Recovery drill\n\nThe team approved the recovery procedure.\n")
            with wave.open(str(storage / "audio.wav"), "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16000)
                audio.writeframes(bytes(32000))
            shutil.copyfile(ROOT / "services/doc-worker/templates/minutes.docx", storage / "minutes.docx")
            ids = {name: str(uuid.uuid4()) for name in ["org", "admin", "space", "audio", "md", "docx", "meeting", "post"]}
            # Fixed literal fixture values and generated UUIDs only, no user input in SQL.
            sql(f"""
INSERT INTO orgs(id,name,slug) VALUES('{ids['org']}','Recovery fixture','recovery');
INSERT INTO users(id,org_id,email,display_name,role) VALUES('{ids['admin']}','{ids['org']}','admin@recovery.local','Recovery Admin','admin');
INSERT INTO spaces(id,org_id,name,slug,created_by) VALUES('{ids['space']}','{ids['org']}','General','general','{ids['admin']}');
INSERT INTO space_members(space_id,user_id,role) VALUES('{ids['space']}','{ids['admin']}','owner');
""")
            import hashlib
            for name, filename, mime in [
                ("audio", "audio.wav", "audio/wav"),
                ("md", "minutes.md", "text/markdown"),
                ("docx", "minutes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
            ]:
                data = (storage / filename).read_bytes()
                digest = hashlib.sha256(data).hexdigest()
                sql(f"INSERT INTO media(id,org_id,owner_id,storage_key,original_name,mime,bytes,sha256) VALUES('{ids[name]}','{ids['org']}','{ids['admin']}','{filename}','{filename}','{mime}',{len(data)},'{digest}');")
            content = {"title": "Recovery drill", "held_at": None, "attendees": [], "summary": "The team discussed recovery. The backup was prepared. Restoration was approved.", "agenda": [], "decisions": [], "action_items": [], "open_questions": [], "risks": [], "next_meeting": None, "confidence_notes": []}
            sql(f"""
INSERT INTO meetings(id,org_id,space_id,uploader_id,reviewer_id,title,status,audio_media_id) VALUES('{ids['meeting']}','{ids['org']}','{ids['space']}','{ids['admin']}','{ids['admin']}','Recovery drill','published','{ids['audio']}');
INSERT INTO posts(id,space_id,author_id,body,meeting_id,attachments) VALUES('{ids['post']}','{ids['space']}','{ids['admin']}','Published recovery fixture','{ids['meeting']}','["{ids['md']}","{ids['docx']}"]');
UPDATE meetings SET published_post_id='{ids['post']}' WHERE id='{ids['meeting']}';
INSERT INTO transcripts(meeting_id,language,segments) VALUES('{ids['meeting']}','en','[{{"start_s":0,"end_s":1,"speaker":null,"text":"Recovery approved"}}]');
INSERT INTO minutes(meeting_id,version,content,approved_by,approved_at,docx_media_id,md_media_id) VALUES('{ids['meeting']}',1,'{json.dumps(content)}','{ids['admin']}',now(),'{ids['docx']}','{ids['md']}');
INSERT INTO doc_jobs(meeting_id,kind,status) VALUES('{ids['meeting']}','render','done');
""")
            backup = work / "backup"
            command = [sys.executable, str(ROOT / "scripts/backup.py")]
            subprocess.run([*command, "backup", str(backup), "--storage", str(storage), "--compose", str(compose), "--quiesced"], check=True)
            sql("CREATE DATABASE mane_restored;")
            restored_storage = work / "restored-storage"
            restore = [*command, "restore", str(backup), "--storage", str(restored_storage), "--compose", str(compose), "--database", "mane_restored", "--quiesced"]
            subprocess.run(restore, check=True)
            tables = ["orgs", "users", "spaces", "space_members", "media", "meetings", "posts", "transcripts", "minutes", "doc_jobs"]
            for table in tables:
                query = f"SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM {table} t;"
                assert sql(query) == sql(query, "mane_restored"), f"Restored table differs: {table}"
            for file in storage.iterdir():
                assert file.read_bytes() == (restored_storage / file.name).read_bytes(), f"Restored bytes differ: {file.name}"
            refused = subprocess.run(restore, text=True, capture_output=True)
            assert refused.returncode != 0 and "refuses existing storage content" in refused.stderr
            # Exercise nonempty-database refusal independently of the storage safeguard.
            nonempty = [*command, "restore", str(backup), "--storage", str(work / "second-storage"), "--compose", str(compose), "--database", "mane_restored", "--quiesced"]
            refused = subprocess.run(nonempty, text=True, capture_output=True)
            assert refused.returncode != 0 and "nonempty database" in refused.stderr
            print("PASS: real PostgreSQL dump/restore preserved 10 application tables and audio/Markdown/DOCX bytes; nonempty targets refused.")
        finally:
            subprocess.run([*dc, "down", "--volumes", "--remove-orphans"], check=True)


if __name__ == "__main__":
    main()
