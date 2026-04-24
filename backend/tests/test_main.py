import importlib
import json

from fastapi.testclient import TestClient


def _reload_main():
    import main

    return importlib.reload(main)


def test_parse_json_suggestions_normalizes_and_limits():
    main = _reload_main()
    payload = {
        "suggestions": [
            {"type": "answer", "title": "A", "preview": "P", "reason": "R"},
            {"type": "invalid_type", "title": "B", "preview": "Q", "reason": "R"},
            {"type": "clarify", "title": "C", "preview": "X"},
            {"type": "fact_check", "title": "D", "preview": "Y"},
        ]
    }
    out = main._parse_json_suggestions(json.dumps(payload))
    assert len(out) == 3
    assert out[1]["type"] == "talking_point"


def test_validate_suggestion_quality_rejects_duplicates():
    main = _reload_main()
    suggestions = [
        {"type": "answer", "title": "One", "preview": "A"},
        {"type": "clarify", "title": "One", "preview": "B"},
        {"type": "fact_check", "title": "Three", "preview": "C"},
    ]
    try:
        main._validate_suggestion_quality(suggestions)
        assert False, "Expected HTTPException for duplicate titles."
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 422


def test_cors_origins_from_env(monkeypatch):
    monkeypatch.setenv("FRONTEND_ORIGINS", "https://a.com, https://b.com")
    main = _reload_main()
    assert main._cors_origins() == ["https://a.com", "https://b.com"]


def test_suggest_endpoint_success(monkeypatch):
    main = _reload_main()

    class _Msg:
        content = json.dumps(
            {
                "suggestions": [
                    {"type": "answer", "title": "T1", "preview": "P1", "reason": "R1"},
                    {"type": "clarify", "title": "T2", "preview": "P2", "reason": "R2"},
                    {"type": "fact_check", "title": "T3", "preview": "P3", "reason": "R3"},
                ]
            }
        )

    class _Choice:
        message = _Msg()

    class _CompletionResponse:
        choices = [_Choice()]

    class _Completions:
        @staticmethod
        def create(**kwargs):
            return _CompletionResponse()

    class _Chat:
        completions = _Completions()

    class _FakeGroq:
        def __init__(self, api_key):
            self.chat = _Chat()

    monkeypatch.setattr(main, "Groq", _FakeGroq)
    client = TestClient(main.app)
    res = client.post(
        "/suggest",
        data={"transcript": "hello", "prompt": "p", "key": "k", "sugg_context": "ctx"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert len(body["data"]["suggestions"]) == 3
