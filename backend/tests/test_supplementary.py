"""扩展练习 / supplementary exams (ADR-0030): V1 book conversion, validator
rules, and isolation from the past-exam catalog and topic sampling."""
import copy
import os

import pytest
import sqlalchemy as sa

from app.importer.reader import load_archive
from app.importer.validator import validate_package
from app.v1_book_convert import (build_package, classify, lesson_number,
                                 prompt_richtext, split_stem, write_package)
from conftest import RELEASE_TABLES
from importer_fixture import make_provenance, make_records, write_zip

requires_db = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="DATABASE_URL not set")


def opt(qid, texts, correct):
    return [dict(question_id=qid, text=t, is_correct=int(i == correct),
                 source_order=i) for i, t in enumerate(texts)]


def make_book(subject_label="漢字", name="第 13 课", level="N3"):
    return dict(id=7, name=name, level=level, subject="x", subject_label=subject_label)


def make_questions():
    qs, opts = [], {}
    def add(i, stem, texts, correct):
        qs.append(dict(id=i, external_id=f"v1-{i}", book_id=7, stem=stem, source_index=i))
        opts[i] = opt(i, texts, correct)
    add(1, "ペットの体調が　悪いので　【動物】病院へ　連れて行きました。",
        ["どうぶつ", "とうぶつ", "どぶつ", "とふつ"], 0)            # kanji reading
    add(2, "この　かばんは　【ちいさい】です。",
        ["小さい", "小いさい", "少さい", "少いさい"], 0)            # orthography
    add(4, "池の【水】が冷たい。", ["みず", "すい", "うみ"], 0)     # 3 options
    add(5, "壊れた問題【問題】。", ["a", "b", "c", "d"], None)     # no correct
    opts[5] = [dict(question_id=5, text=t, is_correct=0, source_order=i)
               for i, t in enumerate("abcd")]
    return qs, opts


# ------------------------------------------------------------ pure parts ----

def test_lesson_number_and_split_stem_and_classify():
    assert lesson_number("第 04 课") == 4 and lesson_number("附录") is None
    prompt, opts = split_stem("池にボートが【　　　】いる。\n1.うまって\n2.うかんで\n3.うもれて\n4.うえられて")
    assert prompt == "池にボートが【　　　】いる。" and opts[1] == "うかんで" and len(opts) == 4
    assert split_stem("普通の文。") == ("普通の文。", [])
    assert classify("漢字", "【動物】") == "vocabulary_kanji_reading"
    assert classify("漢字", "【ぞく】") == "vocabulary_orthography"
    assert classify("漢字", "括弧なし") is None
    assert classify("語彙", "x") == "vocabulary_context"
    assert classify("文法", "x") == "grammar_form"


def test_prompt_richtext_blank_and_underline():
    kids = prompt_richtext("家【ぞく】と【　　　】へ")["blocks"][0]["children"]
    assert kids[1] == {"type": "text", "text": "ぞく", "marks": ["underline"]}
    assert kids[3]["text"] == "（　　　）" and "marks" not in kids[3]


def test_build_package_never_silently_fixes(tmp_path):
    qs, opts = make_questions()
    records, prov, rep = build_package(make_book(), qs, opts)
    assert rep["converted"] == 3
    assert rep["excluded"] == [{"question_id": 5, "reason": "correct_answers=0"}]
    assert rep["needs_review"] == [{"question_id": 4, "issues": ["option_count=3"]}]
    exam = records["exam.json"][0]
    assert exam["kind"] == "supplementary" and exam["year"] is None
    assert exam["id"] == "JLPTGO-SUP-N3-kanji-L013"
    types = [l["question_type_id"] for l in records["layers.jsonl"]]
    assert set(types) == {"vocabulary_kanji_reading", "vocabulary_orthography"}
    statuses = {u["id"]: u["conversion_status"] for u in records["units.jsonl"]}
    assert list(statuses.values()).count("needs_review") == 1
    assert all(p["source_system"] == "jlptgo-v1-book" for p in prov)

    pkg_dir = write_package(tmp_path, records, prov)
    (pkg,) = load_archive(pkg_dir)
    vr = validate_package(pkg)
    assert vr.errors == [], [i.as_dict() for i in vr.errors]


def test_options_written_in_the_stem_are_recovered_with_the_right_answer():
    stem = "ごみは分別して【　　　】する地域が多い。\n1.収穫\n2.収集\n3.収入\n4.収納"
    qs = [dict(id=3, external_id="v1-3", book_id=8, stem=stem, source_index=1)]
    book = make_book(subject_label="語彙", name="第 02 课")
    records, _, rep = build_package(book, qs, {3: opt(3, ["1", "2", "3", "4"], 1)})
    assert rep["needs_review"] == [] and rep["converted"] == 1
    q = records["questions.jsonl"][0]
    assert [o["content"]["blocks"][0]["children"][0]["text"] for o in q["options"]] \
        == ["収穫", "収集", "収入", "収納"]
    assert records["answer_keys.private.jsonl"][0]["correct_option_ids"] == [q["id"] + "-o2"]
    assert records["layers.jsonl"][0]["question_type_id"] == "vocabulary_context"
    # unparsable placeholders must not be guessed
    bad = [dict(id=4, external_id="v1-4", book_id=8, stem="問題【　　　】。", source_index=1)]
    _, _, rep2 = build_package(book, bad, {4: opt(4, ["1", "2", "3", "4"], 0)})
    assert rep2["needs_review"] == [{"question_id": 4, "issues": ["options_unparsed"]}]


@pytest.mark.parametrize("stem,expected_prompt,expected", [
    ("このワインは、ゆっくり時間をかけて【　　　】のが一番だ。1.舌が回る2.かみ[砕](くだ)く3.溶ける4.味わう",
     "このワインは、ゆっくり時間をかけて【　　　】のが一番だ。", ["舌が回る", "かみ[砕](くだ)く", "溶ける", "味わう"]),
    ("テストで答えがわからなくて【　　　】答えを書いた。\n1.なつかしい2こいしい\n3.でたらめな\n4.あきっぽい",
     "テストで答えがわからなくて【　　　】答えを書いた。", ["なつかしい", "こいしい", "でたらめな", "あきっぽい"]),
    ("【　　　】がのぼって、暖かくなった。\n1.月\n2.日\n3.雲4星",
     "【　　　】がのぼって、暖かくなった。", ["月", "日", "雲", "星"]),
    ("今日は時間がないので、また日を【　　　】話しましょう。 1.改めて2.かためて3.沿って4.治めて",
     "今日は時間がないので、また日を【　　　】話しましょう。", ["改めて", "かためて", "沿って", "治めて"]),
])
def test_inline_options_are_parsed(stem, expected_prompt, expected):
    from app.v1_book_convert import split_inline_options
    assert split_inline_options(stem) == (expected_prompt, expected)


def test_inline_options_never_guess():
    from app.v1_book_convert import split_inline_options
    assert split_inline_options("10分の【　　　】だ。")[1] == []           # no 1./2./3./4.
    assert split_inline_options("文。1.あ2.い3.う")[1] == []              # only three
    assert split_inline_options("文。1.あ2.い3.う4.")[1] == []            # empty option


def test_inline_options_book_converts_clean_with_ruby_kept_as_text():
    qs = [dict(id=9, external_id="v1-9", book_id=8, source_index=1,
               stem="税金を【　　　】なければならない。1.かぶせ2.かり3.占め4.[納](おさ)め")]
    book = make_book(subject_label="語彙", name="第 41 课", level="N2")
    records, _, rep = build_package(book, qs, {9: opt(9, ["1", "2", "3", "4"], 3)})
    assert rep["needs_review"] == []
    q = records["questions.jsonl"][0]
    assert q["options"][3]["content"]["blocks"][0]["children"][0]["text"] == "納(おさ)め"
    assert records["answer_keys.private.jsonl"][0]["correct_option_ids"] == [q["id"] + "-o4"]


def test_unsupported_or_empty_books_are_reported_not_converted():
    qs, opts = make_questions()
    assert build_package(make_book(name="附录"), qs, opts)[0] is None
    assert build_package(make_book(subject_label="其他"), qs, opts)[0] is None
    assert build_package(make_book(), [], {})[0] is None


# ------------------------------------------------------------- validator ----

def _validate_records(tmp_path, records):
    write_zip(records, make_provenance(), tmp_path / "p.zip")
    (pkg,) = load_archive(tmp_path / "p.zip")
    return {i.code for i in validate_package(pkg).errors}


def test_dated_kinds_require_year_and_month_supplementary_forbids_them(tmp_path):
    base = make_records()
    assert _validate_records(tmp_path, base) == set()
    no_year = copy.deepcopy(base); no_year["exam.json"][0]["year"] = None
    assert "exam_year" in _validate_records(tmp_path, no_year)
    sup = copy.deepcopy(base); sup["exam.json"][0].update(kind="supplementary")
    assert "exam_date" in _validate_records(tmp_path, sup)
    sup["exam.json"][0].update(year=None, month=None)
    assert _validate_records(tmp_path, sup) == set()


# -------------------------------------------------------------- database ----

SUP_EXAM = "JLPTGO-SUP-N3-kanji-L013"


@pytest.fixture()
def sup_published(pg_engine, tmp_path):
    from app.importer.staging import stage_package
    from app.publisher import auto_publish_package

    def wipe():
        with pg_engine.begin() as c:
            for t in RELEASE_TABLES:
                c.execute(sa.text(f"DELETE FROM {t} WHERE release_id IN"
                                  " (SELECT id FROM exam_releases WHERE exam_id = :e)"), {"e": SUP_EXAM})
            c.execute(sa.text("DELETE FROM exam_current_releases WHERE exam_id = :e"), {"e": SUP_EXAM})
            c.execute(sa.text("DELETE FROM publication_decisions WHERE exam_id = :e"), {"e": SUP_EXAM})
            c.execute(sa.text("DELETE FROM content_reviews WHERE canonical_id LIKE 'JLPTGO-SUP-%'"))
            c.execute(sa.text("DELETE FROM content_issues WHERE canonical_id LIKE 'JLPTGO-SUP-%'"))
            c.execute(sa.text("DELETE FROM exam_releases WHERE exam_id = :e"), {"e": SUP_EXAM})
            c.execute(sa.text("DELETE FROM question_registry WHERE exam_id = :e"), {"e": SUP_EXAM})
            c.execute(sa.text("DELETE FROM source_mappings WHERE source_system = 'jlptgo-v1-book'"))
            c.execute(sa.text("DELETE FROM import_records WHERE job_id IN (SELECT id FROM import_jobs"
                              " WHERE package_id = :p)"), {"p": SUP_EXAM + "-r1"})
            c.execute(sa.text("DELETE FROM import_jobs WHERE package_id = :p"), {"p": SUP_EXAM + "-r1"})
            c.execute(sa.text("DELETE FROM exam_catalogs WHERE id = :e"), {"e": SUP_EXAM})
    wipe()
    qs, opts = make_questions()
    records, prov, _ = build_package(make_book(), qs, opts)
    (pkg,) = load_archive(write_package(tmp_path, records, prov))
    stage_package(pg_engine, pkg)
    out = auto_publish_package(pg_engine, pkg.package_id)
    yield out
    wipe()


@requires_db
def test_supplementary_publishes_with_null_dates_and_check_constraint(pg_engine, sup_published):
    with pg_engine.connect() as c:
        row = c.execute(sa.text("SELECT kind, year, month FROM exam_catalogs WHERE id = :e"),
                        {"e": SUP_EXAM}).one()
        assert tuple(row) == ("supplementary", None, None)
    with pytest.raises(sa.exc.IntegrityError):          # dated kinds still need a date
        with pg_engine.begin() as c:
            c.execute(sa.text("INSERT INTO exam_catalogs (id, level, year, month, kind, title)"
                              " VALUES ('JLPTGO-X-BAD', 'N5', NULL, NULL, 'past_exam', 't')"))


@requires_db
def test_supplementary_is_isolated_from_catalog_and_topic_sampling(pg_engine, sup_published, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", pg_engine.url.render_as_string(hide_password=False))
    from fastapi.testclient import TestClient
    from app.api.topic_practice import _CANDIDATES_SQL, _WRONG_SQL
    from app.main import app
    with pg_engine.connect() as c:
        assert c.execute(sa.text(
            "SELECT count(*) FROM exam_current_releases WHERE exam_id = :e"), {"e": SUP_EXAM}).scalar_one() == 1
        cand = c.execute(sa.text(_CANDIDATES_SQL), {"level": "N3"}).mappings().all()
        assert all(r["exam_id"] != SUP_EXAM for r in cand)
        # the filter is what excludes it: the same query without it sees the lesson
        unfiltered = _CANDIDATES_SQL.replace("   AND e.kind IN ('past_exam', 'mock_exam')", "")
        assert unfiltered != _CANDIDATES_SQL
        assert any(r["exam_id"] == SUP_EXAM for r in
                   c.execute(sa.text(unfiltered), {"level": "N3"}).mappings())
        c.execute(sa.text(_WRONG_SQL), {"u": "00000000-0000-0000-0000-000000000001", "level": "N3"})
    client = TestClient(app)
    body = client.get("/api/exams").json()
    rows = body["exams"] if isinstance(body, dict) else body
    assert SUP_EXAM not in [e["exam_id"] for e in rows]
