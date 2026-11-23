"""Exercise the local D1 projection and CRM API with removable synthetic data."""

import json
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://localhost:3143/api/admin/analysis"


def api(path, body=None, origin="http://localhost:3143", method=None):
    payload = None if body is None else json.dumps(body).encode()
    request = Request(
        BASE + quote(path, safe="/?=&%,:-"),
        data=payload,
        method=method,
        headers={"Content-Type": "application/json", "Origin": origin},
    )
    try:
        with urlopen(request, timeout=90) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        try:
            value = json.loads(text)
        except ValueError:
            value = {"error": text[:300]}
        return error.code, value


def execute(sql):
    npm = shutil.which("npm.cmd" if __import__("os").name == "nt" else "npm")
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".sql", dir=ROOT / ".wrangler", encoding="utf-8", delete=False
    ) as output:
        output.write(sql)
        path = Path(output.name)
    try:
        process = subprocess.run(
            [
                npm,
                "exec",
                "--",
                "wrangler",
                "d1",
                "execute",
                "DB",
                "--local",
                "--config",
                "wrangler.local.jsonc",
                "--file",
                str(path),
            ],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if process.returncode:
            raise RuntimeError(
                "Local test fixture SQL failed. " + process.stderr[-1000:]
            )
    finally:
        path.unlink(missing_ok=True)


def sync(mode):
    body = {"mode": mode}
    for _ in range(10000):
        status, result = api("/sync", body)
        assert status == 200, result
        if result["complete"]:
            return
        body = {"snapshotId": result["snapshotId"], "cursor": result["nextCursor"]}
    raise AssertionError("Local synchronization did not finish.")


def main():
    identifier = "qa-analysis-" + uuid.uuid4().hex
    source, person, conversation = (
        identifier + suffix for suffix in ("-source", "-person", "-conversation")
    )
    message, reply, attempt, profile = (
        identifier + suffix for suffix in ("-message", "-reply", "-test", "-match")
    )
    source2, person2, conversation2, message2 = (
        identifier + suffix
        for suffix in ("-source2", "-person2", "-conversation2", "-message2")
    )
    identity_id = None
    guide_created = False
    original_lexicon = None
    execute(f"""
        INSERT INTO sources(id,slug,name,kind,platform,status,created_at,updated_at) VALUES('{source}','{source}','منبع آزمایشی موقت','chatbot','bale','pending',unixepoch(),unixepoch());
        INSERT INTO contacts(id,source_id,name,age,first_seen_at,last_seen_at,created_at,updated_at) VALUES('{person}','{source}','مخاطب ساختگی آزمایش',28,unixepoch(),unixepoch(),unixepoch(),unixepoch());
        INSERT INTO conversations(id,source_id,contact_id,external_session_id,started_at,last_message_at,created_at,updated_at) VALUES('{conversation}','{source}','{person}','qa-session',unixepoch(),unixepoch(),unixepoch(),unixepoch());
        INSERT INTO messages(id,source_id,conversation_id,contact_id,role,content,occurred_at,created_at) VALUES('{message}','{source}','{conversation}','{person}','user','ازدواج و خانواده موضوع این گفتگوی آزمایشی است',unixepoch(),unixepoch());
        INSERT INTO messages(id,source_id,conversation_id,contact_id,role,content,occurred_at,created_at) VALUES('{reply}','{source}','{conversation}','{person}','assistant','عبارت مختص پاسخ ربات',unixepoch(),unixepoch());
        INSERT INTO test_attempts(id,source_id,contact_id,external_attempt_id,test_key,scores,profile,completed_at,created_at) VALUES('{attempt}','{source}','{person}','qa-attempt','qa-questionnaire','{{"anxiety":7}}','{{}}',unixepoch(),unixepoch());
        INSERT INTO test_answers(id,attempt_id,position,question_text,answer_label,created_at) VALUES('{identifier}-answer','{attempt}',1,'پرسش قالبی آزمایش','گزینه ثابت آزمایش',unixepoch());
        INSERT INTO match_profiles(id,source_id,contact_id,external_profile_id,profile,completed_at,created_at) VALUES('{profile}','{source}','{person}','qa-profile','{{}}',unixepoch(),unixepoch());
        INSERT INTO sources(id,slug,name,kind,platform,status,created_at,updated_at) VALUES('{source2}','{source2}','منبع دوم آزمایشی','chatbot','bale','pending',unixepoch(),unixepoch());
        INSERT INTO contacts(id,source_id,name,first_seen_at,last_seen_at,created_at,updated_at) VALUES('{person2}','{source2}','مخاطب ساختگی آزمایش دوم',unixepoch(),unixepoch(),unixepoch(),unixepoch());
        INSERT INTO conversations(id,source_id,contact_id,external_session_id,started_at,last_message_at,created_at,updated_at) VALUES('{conversation2}','{source2}','{person2}','qa-second',unixepoch(),unixepoch(),unixepoch(),unixepoch());
        INSERT INTO messages(id,source_id,conversation_id,contact_id,role,content,occurred_at,created_at) VALUES('{message2}','{source2}','{conversation2}','{person2}','user','روایت ساختگی دوم',unixepoch(),unixepoch());
    """)
    try:
        sync("full")
        status, overview = api("/overview?sourceIds=" + source)
        assert status == 200, overview
        assert overview["totals"]["records"] == 3, overview
        assert overview["totals"]["contacts"] == 1, overview
        status, all_roles = api(
            "/overview?sourceIds=" + source + "&roles=user,assistant"
        )
        assert all_roles["totals"]["records"] == 4, all_roles
        status, words = api("/words?sourceIds=" + source)
        terms = {item["term"] for item in words["items"]}
        assert "ازدواج" in terms and "مختص" not in terms and "گزینه" not in terms, words
        status, evidence = api("/word-evidence?sourceIds=" + source + "&term=ازدواج")
        assert status == 200 and evidence["items"], evidence
        assert evidence["items"][0]["href"] == "/conversations/" + conversation, (
            evidence
        )
        status, selected = api(
            "/overview?sourceIds=" + source + "&kinds=test&scoreKey=anxiety&scoreFrom=8"
        )
        assert selected["totals"]["records"] == 0, selected
        status, selected = api(
            "/overview?sourceIds=" + source + "&kinds=test&scoreKey=anxiety&scoreFrom=7"
        )
        assert selected["totals"]["tests"] == 1, selected
        status, _ = api(
            "/sessions",
            {"title": "آزمون مبدأ درخواست"},
            origin="http://untrusted.invalid",
        )
        assert status == 403, status
        status, found = api("/contacts?q=مخاطب ساختگی آزمایش")
        assert status == 200, found
        contact = next(item for item in found["items"] if item["localId"] == person)
        status, linked = api(
            "/identities",
            {
                "contactIds": [person, person2],
                "basis": "تأیید هویت صرفاً در دادهٔ ساختگی آزمون",
                "confirmed": True,
            },
        )
        assert status == 201, linked
        identity_id = linked["id"]
        sync("delta")
        status, selected = api(
            "/overview?contactId=" + contact["id"] + "&includeLinkedContacts=true"
        )
        assert status == 200 and selected["totals"]["records"] == 4, selected
        status, blocked = api(
            "/identities",
            {
                "contactIds": [person, person2],
                "basis": "تلاش برای ثبت پیوند تکراری ساختگی",
                "confirmed": True,
            },
        )
        assert status == 409, blocked
        status, revoked = api("/identities?id=" + identity_id, method="DELETE")
        assert status == 200, revoked
        sync("delta")
        status, selected = api(
            "/overview?contactId=" + contact["id"] + "&includeLinkedContacts=true"
        )
        assert status == 200 and selected.get("totals", {}).get("records") == 3, (
            selected
        )
        status, original_lexicon = api("/lexicon")
        assert status == 200, original_lexicon
        status, updated = api(
            "/lexicon", {"stopwords": original_lexicon["stopwords"] + ["ازدواج"]}
        )
        assert status == 200, updated
        status, excluded = api("/words?sourceIds=" + source)
        assert "ازدواج" not in {item["term"] for item in excluded["items"]}, excluded
        status, restored = api("/lexicon", {"stopwords": original_lexicon["stopwords"]})
        assert status == 200, restored
        original_lexicon = None
        status, guide = api(
            "/guides",
            {
                "guide": {
                    "testKey": identifier,
                    "version": "qa-1",
                    "source": "Synthetic test manual",
                    "scoring": {"range": [0, 10]},
                },
                "confirmed": True,
            },
        )
        assert status == 200, guide
        guide_created = True
        status, removed_guide = api(
            "/guides?testKey=" + identifier + "&version=qa-1", method="DELETE"
        )
        assert status == 200, removed_guide
        guide_created = False
        execute(
            f"UPDATE messages SET content='تغییر آزمایشی محتوا درباره مهاجرت' WHERE id='{message}';"
        )
        sync("delta")
        status, changed_words = api("/words?sourceIds=" + source)
        assert "مهاجرت" in {item["term"] for item in changed_words["items"]}, (
            changed_words
        )
        print(
            "Local projection, roles, scores, evidence links, origin, identity verification/revocation, lexicon, guides and delta sync passed."
        )
    finally:
        if original_lexicon is not None:
            api("/lexicon", {"stopwords": original_lexicon["stopwords"]})
        if guide_created:
            api("/guides?testKey=" + identifier + "&version=qa-1", method="DELETE")
        execute(f"""
            DELETE FROM analysis_identity_members WHERE group_id IN (SELECT id FROM analysis_identity_groups WHERE members_json LIKE '%{identifier}%');
            DELETE FROM analysis_identity_groups WHERE members_json LIKE '%{identifier}%';
            DELETE FROM test_answers WHERE attempt_id='{attempt}';
            DELETE FROM test_attempts WHERE id='{attempt}';
            DELETE FROM match_profiles WHERE id='{profile}';
            DELETE FROM messages WHERE source_id='{source}';
            DELETE FROM conversations WHERE source_id='{source}';
            DELETE FROM contacts WHERE source_id='{source}';
            DELETE FROM sources WHERE id='{source}';
            DELETE FROM messages WHERE source_id='{source2}';
            DELETE FROM conversations WHERE source_id='{source2}';
            DELETE FROM contacts WHERE source_id='{source2}';
            DELETE FROM sources WHERE id='{source2}';
        """)
        sync("delta")
        status, removed = api("/overview?sourceIds=" + source)
        assert status == 200 and removed["totals"]["records"] == 0, removed
        print("Synthetic local fixture removed and deletion synchronized.")


if __name__ == "__main__":
    main()
