from app.api.topic_practice import type_sort_key


def test_types_follow_paper_order_not_alphabet():
    ids = ["vocabulary_usage", "vocabulary_context", "vocabulary_kanji_reading",
           "vocabulary_word_formation", "vocabulary_orthography",
           "vocabulary_paraphrase"]
    assert sorted(ids, key=type_sort_key) == [
        "vocabulary_kanji_reading", "vocabulary_orthography",
        "vocabulary_word_formation", "vocabulary_context",
        "vocabulary_paraphrase", "vocabulary_usage"]


def test_unknown_type_sorts_last():
    ids = ["zzz_new", "grammar_cloze", "grammar_form"]
    assert sorted(ids, key=type_sort_key) == [
        "grammar_form", "grammar_cloze", "zzz_new"]
