"""Pipeline + oracle trên mẫu train: phải tái tạo đúng đáp án (kiểm tra agent loop, guard, renderer, prompt)."""
from agent_core.data import load_samples, load_zaic_tools, locate_split
from agent_core.pipeline import Pipeline, PipelineConfig
from lab.core.datasets import train_root

TRAIN_ROOT = train_root()


def test_oracle_reproduces_labels():
    root, split = locate_split(TRAIN_ROOT / "train")
    zt = load_zaic_tools(root, split)
    # guard không sửa tham số: oracle phải tái tạo đáp án y hệt
    pipe = Pipeline(PipelineConfig(guards=["validate_repair", "iso_time", "dedupe_reads", "ask_last"]), root, split)
    for s in load_samples(root, split)[:150]:
        env = zt.ToolEnv(split, s.id, root=root)
        pipe.run(s, env)
        assert env.get_tool_calls() == [{"name": c["name"], "arguments": c["arguments"]} for c in s.label["tool_calls"]], s.id


def test_renderer_names_are_api_safe():
    import re

    from agent_core.data import catalog_tools, load_catalog
    from agent_core.registry import build

    tools = catalog_tools(load_catalog(TRAIN_ROOT, "train"))
    for r in ("full", "compact", "signature"):
        for spec in build("renderer", r).render(tools, list(tools)):
            assert re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", spec.api_name)
            assert "x-ref" not in str(spec.parameters) and "x-match" not in str(spec.parameters)


def test_vi_numbers():
    from agent_core.vi_numbers import convert

    assert convert("chuyển ba trăm rưỡi") == "chuyển 350"
    assert convert("hai mươi lăm độ") == "25 độ"
    assert convert("năm nay") == "năm nay"


def test_strip_read_filters_guard():
    from agent_core.data import catalog_tools, load_catalog, load_samples
    from agent_core.guards import AgentState
    from agent_core.registry import build
    from agent_core.types import ToolCall

    tools = catalog_tools(load_catalog(TRAIN_ROOT, "train"))
    st = AgentState(sample=load_samples(TRAIN_ROOT, "train")[0], env=None, tools=tools)
    g = build("guard", "strip_read_filters")
    d = g.before(ToolCall("bill_payment.list_bills", {"type": "electricity"}), st)
    assert d.action == "rewrite" and d.arguments == {}
    assert g.before(ToolCall("contacts.get", {"contact_id": "c_01"}), st).action == "allow"      # tham số bắt buộc giữ nguyên
    assert g.before(ToolCall("contacts.search", {"query": "Lan"}), st).action == "allow"          # đáp án luôn dùng query
    assert g.before(ToolCall("calendar.list_events", {"date_from": "2026-11-01"}), st).arguments == {}
    assert g.before(ToolCall("alarm.create", {"time": "x", "label": "y"}), st).action == "allow"  # tool ghi không đụng tới


def test_single_tool_call_per_step():
    """LLM giả đề xuất mọi call còn lại cùng lúc; agent chỉ thực thi call đầu mỗi bước, vẫn ra đúng đáp án."""
    from agent_core.render import api_name
    from agent_core.types import LLMResponse, ToolCall

    class ParallelLLM:
        cfg = None

        def step(self, system, messages, tools, ctx=None):
            gold = ctx["sample"].label["tool_calls"]
            last = max(i for i, m in enumerate(messages) if m["role"] == "user")
            done = sum(len(m.get("tool_calls") or []) for m in messages[last:] if m["role"] == "assistant")
            rest = gold[done:]
            return LLMResponse(tool_calls=[ToolCall(api_name(c["name"]), c["arguments"], f"p{done}_{k}") for k, c in enumerate(rest)])

    root, split = locate_split(TRAIN_ROOT / "train")
    zt = load_zaic_tools(root, split)
    pipe = Pipeline(PipelineConfig(guards=["validate_repair", "iso_time", "dedupe_reads", "ask_last"]), root, split, llm=ParallelLLM())
    n_multi = 0
    for s in load_samples(root, split)[:120]:
        env = zt.ToolEnv(split, s.id, root=root)
        out = pipe.run(s, env)
        assert env.get_tool_calls() == [{"name": c["name"], "arguments": c["arguments"]} for c in s.label["tool_calls"]], s.id
        for st in out["trace"]["steps"]:
            assert sum(a["executed"] for a in st["actions"]) <= 1
            n_multi += bool(st.get("dropped_calls"))
    assert n_multi > 0


def test_restore_case_and_ask_order_guards():
    from agent_core.data import catalog_tools, load_catalog, load_samples
    from agent_core.guards import AgentState
    from agent_core.registry import build
    from agent_core.types import ToolCall

    tools = catalog_tools(load_catalog(TRAIN_ROOT, "train"))
    st = AgentState(sample=load_samples(TRAIN_ROOT, "train")[0], env=None, tools=tools)
    g = build("guard", "restore_case")
    rc = lambda n, a: g.before(ToolCall(n, a), st)  # noqa: E731
    assert rc("contacts.search", {"query": "sếp dũng"}).arguments == {"query": "Sếp Dũng"}
    assert rc("contacts.search", {"query": "cô giáo mai"}).arguments == {"query": "Cô giáo Mai"}
    assert rc("contacts.search", {"query": "Bố"}).action == "allow"                   # đã có chữ hoa: không đụng
    assert rc("exchange_rate.convert", {"amount": 5, "from_currency": "usd", "to_currency": "vnd"}).arguments["to_currency"] == "VND"
    assert rc("smart_home.light_set", {"device_id": "x", "power": "off"}).action == "allow"   # enum giữ nguyên
    a = build("guard", "ask_params_order")
    d = a.before(ToolCall("sys.ask_missing_info", {"tool_name": "music.add_to_playlist", "params": ["track_id", "playlist_id"]}), st)
    assert d.arguments["params"] == ["playlist_id", "track_id"]                          # khớp ví dụ của BTC


def test_oracle_with_all_rewriting_guards_except_strip():
    """restore_case / ask_params_order không được làm sai đáp án train (chỉ strip_read_filters là có đánh đổi)."""
    root, split = locate_split(TRAIN_ROOT / "train")
    zt = load_zaic_tools(root, split)
    pipe = Pipeline(PipelineConfig(guards=["validate_repair", "iso_time", "restore_case", "ask_params_order", "dedupe_reads", "ask_last"]),
                    root, split)
    for s in load_samples(root, split):
        env = zt.ToolEnv(split, s.id, root=root)
        pipe.run(s, env)
        assert env.get_tool_calls() == [{"name": c["name"], "arguments": c["arguments"]} for c in s.label["tool_calls"]], s.id


def test_wer_number_normalization():
    from lab.scoring.asr_metrics import normalize, utterance_metrics

    same = [("Đô dưới hai sáu ngàn", "Đô dưới 26 ngàn"), ("bảy giờ sáng", "7 giờ sáng"), ("một triệu hai", "1 triệu 2"),
            ("ba trăm rưỡi", "350"), ("số không chín ba năm", "số 0935"), ("9 giờ kém 15", "chín giờ kém mười lăm"),
            ("Chuyển cho Mẹ, nhé!", "chuyển cho mẹ nhé")]
    for a, b in same:
        assert normalize(a) == normalize(b), (a, b)
        assert utterance_metrics(a, b)["w_err"] == 0
    assert utterance_metrics("tắt đèn phòng ngủ", "tắt đèn phòng khách")["w_err"] == 1
