from lab.scoring.diagnostics import diagnose
from lab.scoring.official import ScoreOptions, score_sample, token_f1

FUZ = {"sms.send": {"content"}}
G = [{"name": "contacts.search", "arguments": {"query": "Lan"}},
     {"name": "sms.send", "arguments": {"contact_id": "c_01", "content": "mai họp lúc 9 giờ nhé"}}]
TOOLS = {"contacts.search": {"kind": "read"}, "sms.send": {"kind": "write"}, "sys.ask_missing_info": {"kind": "meta"}}


def test_perfect():
    s = score_sample(G, "h", G, "h", FUZ)
    assert s.score == 1.0 and s.M == 2 and s.U == 0


def test_hash_gate():
    s = score_sample(G, "x", G, "h", FUZ)
    assert s.score == 0.0 and s.f1_nohash == 1.0


def test_empty_gold():
    assert score_sample([], "h", [], "h", FUZ).score == 1.0
    assert score_sample(G[:1], "h", [], "h", FUZ).score == 0.0


def test_fuzzy_threshold():
    p = [G[0], {"name": "sms.send", "arguments": {"contact_id": "c_01", "content": "Mai họp lúc 9 giờ nha"}}]
    assert token_f1("Mai họp lúc 9 giờ nha", "mai họp lúc 9 giờ nhé") > 0.6
    assert score_sample(p, "h", G, "h", FUZ).score == 1.0
    p2 = [G[0], {"name": "sms.send", "arguments": {"contact_id": "c_01", "content": "gọi lại sau"}}]
    assert score_sample(p2, "h", G, "h", FUZ).M == 1


def test_extra_read_and_rejected():
    p = [G[0], {"name": "contacts.search", "arguments": {}}, G[1]]
    s = score_sample(p, "h", G, "h", FUZ)
    assert s.M == 2 and s.U == 1 and abs(s.score - 0.8) < 1e-9
    d = diagnose(p, [{"ok": True}, {"ok": False}, {"ok": True}], G, s, TOOLS, FUZ)
    assert "extra_read" in d["tags"] and "rejected_call" in d["tags"]


def test_strict_keys_option():
    """Mặc định (khớp leaderboard): tham số thừa không làm call trượt, thiếu tham số vẫn trượt; strict_keys=True là chấm chặt."""
    p = [G[0], {"name": "sms.send", "arguments": {**G[1]["arguments"], "phone_number": "09"}}]
    assert score_sample(p, "h", G, "h", FUZ).M == 2
    assert score_sample(p, "h", G, "h", FUZ, ScoreOptions(strict_keys=True)).M == 1
    missing = [G[0], {"name": "sms.send", "arguments": {"content": G[1]["arguments"]["content"]}}]
    assert score_sample(missing, "h", G, "h", FUZ).M == 1


def test_matching_is_order_free():
    s = score_sample(list(reversed(G)), "h", G, "h", FUZ)
    assert s.score == 1.0


def test_cost_cache_ratios():
    from lab.core.models import cost_of

    price = {"input": 2.0, "output": 10.0}
    u = {"input_tokens": 1_000_000, "output_tokens": 0, "cache_read_tokens": 1_000_000, "cache_write_tokens": 1_000_000,
         "cache_read_ratio": 0.1, "cache_write_ratio": 1.25}
    assert abs(cost_of(u, price) - (2.0 + 0.2 + 2.5)) < 1e-9
    assert abs(cost_of(u, {**price, "cache_read": 0.3, "cache_write": 3.0}) - (2.0 + 0.3 + 3.0)) < 1e-9


def test_case_insensitive_args():
    """Mặc định (khớp leaderboard): không phân biệt hoa/thường; case_insensitive=False là chấm theo từng chữ."""
    from lab.scoring.official import alt_scores

    g = [{"name": "contacts.search", "arguments": {"query": "Bố"}}]
    p = [{"name": "contacts.search", "arguments": {"query": "bố "}}]
    assert score_sample(p, "h", g, "h", FUZ).score == 1.0
    assert score_sample(p, "h", g, "h", FUZ, ScoreOptions(case_insensitive=False)).score == 0.0
    g2 = [{"name": "x.y", "arguments": {"size": "700 cm"}}]
    assert score_sample([{"name": "x.y", "arguments": {"size": "700CM"}}], "h", g2, "h", FUZ).score == 1.0
    gf = [{"name": "sms.send", "arguments": {"contact_id": "c_01", "content": "Mai Họp Lúc 9 Giờ"}}]
    pf = [{"name": "sms.send", "arguments": {"contact_id": "c_01", "content": "mai họp lúc 9 giờ"}}]
    assert score_sample(pf, "h", gf, "h", FUZ).score == 1.0
    pe = [{"name": "contacts.search", "arguments": {"query": "bố", "limit": 5}}]
    alt = alt_scores(pe, "h", g, "h", FUZ, ScoreOptions())
    assert score_sample(pe, "h", g, "h", FUZ).score == 1.0
    assert alt == {"strict_keys": 0.0, "case_sensitive": 0.0, "literal": 0.0}


def test_value_equality():
    g = [{"name": "banking.transfer", "arguments": {"amount": 2000000}}]
    assert score_sample([{"name": "banking.transfer", "arguments": {"amount": 2000000.0}}], "h", g, "h", FUZ).score == 1.0
    assert score_sample([{"name": "banking.transfer", "arguments": {"amount": "2000000"}}], "h", g, "h", FUZ).score == 0.0
    gb = [{"name": "door_lock.set_lock", "arguments": {"locked": True}}]
    assert score_sample([{"name": "door_lock.set_lock", "arguments": {"locked": 1}}], "h", gb, "h", FUZ).score == 0.0
    gl = [{"name": "sys.ask_missing_info", "arguments": {"tool_name": "a.b", "params": ["x", "y"]}}]
    assert score_sample([{"name": "sys.ask_missing_info", "arguments": {"tool_name": "a.b", "params": ["y", "x"]}}], "h", gl, "h", FUZ).score == 0.0
