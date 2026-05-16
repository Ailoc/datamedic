import json
from concurrent.futures import ThreadPoolExecutor


def test_create_load_list_and_delete_conversation(tmp_path):
    from datamedic.chat_store import (
        create_conversation,
        delete_conversation,
        list_conversations,
        load_conversation,
    )

    conversation = create_conversation("session/with unsafe chars", root=tmp_path)

    assert conversation["id"] == "session/with unsafe chars"
    assert conversation["messages"] == []
    assert load_conversation("session/with unsafe chars", root=tmp_path)["id"] == conversation["id"]
    assert [item["id"] for item in list_conversations(root=tmp_path)] == [conversation["id"]]

    delete_conversation("session/with unsafe chars", root=tmp_path)

    assert list_conversations(root=tmp_path) == []


def test_append_message_persists_plotly_figures_as_json_objects(tmp_path):
    from datamedic.chat_store import append_message, create_conversation, load_conversation

    create_conversation("chart-session", root=tmp_path)
    figure = {"data": [{"type": "bar", "x": ["骨科"], "y": [12]}], "layout": {"title": "图表"}}
    append_message("chart-session", "assistant", "已生成图表", figures=[figure], root=tmp_path)

    raw = json.loads((tmp_path / "chart-session" / "conversation.json").read_text(encoding="utf-8"))
    loaded = load_conversation("chart-session", root=tmp_path)

    assert raw["messages"][0]["figures"][0] == figure
    assert loaded["messages"][0]["figures"][0]["data"][0]["type"] == "bar"


def test_append_message_persists_all_concurrent_writes(tmp_path):
    from datamedic.chat_store import append_message, create_conversation, load_conversation

    create_conversation("concurrent-session", root=tmp_path)

    def append(index: int):
        append_message("concurrent-session", "user", f"问题{index}", root=tmp_path)

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(append, range(40)))

    conversation = load_conversation("concurrent-session", root=tmp_path)
    texts = {message["text"] for message in conversation["messages"]}

    assert len(conversation["messages"]) == 40
    assert texts == {f"问题{index}" for index in range(40)}


def test_build_model_messages_keeps_only_latest_10_text_rounds_and_excludes_figures(tmp_path):
    from datamedic.chat_store import append_message, build_model_messages, create_conversation

    create_conversation("history-session", root=tmp_path)
    for index in range(12):
        append_message("history-session", "user", f"问题{index}", root=tmp_path)
        append_message(
            "history-session",
            "assistant",
            f"回答{index}",
            figures=[{"data": [{"y": [index]}]}],
            root=tmp_path,
        )
    conversation, _ = append_message("history-session", "user", "当前问题", root=tmp_path)

    messages = build_model_messages(conversation, max_rounds=10)

    assert messages[0] == {"role": "user", "content": "问题3"}
    assert messages[-1] == {"role": "user", "content": "当前问题"}
    assert len([message for message in messages if message["role"] == "user"]) == 10
    assert all("figures" not in message for message in messages)
