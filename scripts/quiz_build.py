# Спільний збирач банків Квізу (Квіз 3+). Джерело пака — scripts/quizN-source.py:
# T = {"Тема": [(ціна, питання, правильна, [3 хибні], пояснення[, час]), ...]}, 15 питань на тему (по 3 на ціну).
# Правильні відповіді розкладаються порівну по позиціях 0–3 (стабільно, з фіксованим seed).
import json, os, random


def build(T, set_id, var_name, seed, header):
    n = len(T) * 15
    assert n % 4 == 0, n
    rnd = random.Random(seed)
    pos = [0, 1, 2, 3] * (n // 4)
    rnd.shuffle(pos)
    seen = set()
    out = []
    for name, qs in T.items():
        assert len(qs) == 15, (name, len(qs))
        assert sorted(q[0] for q in qs) == [100] * 3 + [200] * 3 + [300] * 3 + [400] * 3 + [500] * 3, name
        items = []
        for q in qs:
            value, text, correct, wrong, expl = q[:5]
            tl = q[5] if len(q) > 5 else (20 if value <= 200 else 30)
            assert len(wrong) == 3 and correct not in wrong and len(set(wrong)) == 3, text
            assert text not in seen, text
            seen.add(text)
            w = wrong[:]
            rnd.shuffle(w)
            p = pos.pop()
            opts = w[:p] + [correct] + w[p:]
            items.append({"text": text, "options": opts, "value": value, "timeLimit": tl,
                          "correctIndices": [opts.index(correct)], "answerText": expl})
        out.append((name, items))

    lines = [f"// {line}" for line in header] + [f"const {var_name} = ["]
    for i, (name, items) in enumerate(out):
        lines.append("  {")
        lines.append(f"    name: {json.dumps(name, ensure_ascii=False)},")
        lines.append("    questions: [")
        lines.append(",\n".join("      " + json.dumps(q, ensure_ascii=False) for q in items))
        lines.append("    ]")
        lines.append("  }" + ("," if i < len(out) - 1 else ""))
    lines.append("];")
    lines.append(f'(window.QUIZ_SETS = window.QUIZ_SETS || {{}})["{set_id}"] = {var_name};')
    lines.append('(window.QUIZ_SET_CREDITS = window.QUIZ_SET_CREDITS || {})'
                 f'["{set_id}"] = "Питання: Open Trivia DB (CC BY-SA 4.0), переклад і адаптація";')
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "js", "promts", f"quiz-topics-{set_id}.js")
    open(path, "w").write("\n".join(lines) + "\n")
    print(f"quiz {set_id}: topics {len(out)}, questions {sum(len(i) for _, i in out)}")
