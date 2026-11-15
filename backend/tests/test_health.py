from app.main import health


def test_process_health():
    assert health()["status"] == "ok"
    assert health()["service"] == "nhg-manabi-v2"
