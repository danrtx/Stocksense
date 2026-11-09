"""HU-33: el modelo propio del asistente, entrenado con las fichas reales del repositorio."""

import json
import time
from pathlib import Path

import pytest

from app.assistant import TARGET_ACCURACY, AssistantModel, build_training_set, evaluate, is_follow_up, normalize, typo

ROOT = Path(__file__).resolve().parents[2]
KB = ROOT / "backend" / "src" / "assistant" / "knowledge" / "articles.json"
TEST_SET = Path(__file__).resolve().parents[1] / "data" / "assistant_test.json"


def articles_from_repo() -> list[dict]:
    """Mismo armado que hace la API (KnowledgeService.expandExamples)."""
    kb = json.loads(KB.read_text(encoding="utf-8"))
    out = []
    for a in kb["articles"]:
        generated = [t.replace("{p}", p) for p in a["phrases"] for t in kb["templates"]]
        examples = list(dict.fromkeys(e.strip() for e in a["examples"] + generated))
        out.append(
            {"id": a["id"], "title": a["title"], "summary": a["summary"], "examples": examples, "keywords": a.get("keywords", [])}
        )
    return out


@pytest.fixture(scope="module")
def model():
    if not KB.exists():
        pytest.skip("las fichas viven en backend/; corre las pruebas desde el repositorio completo")
    return AssistantModel.train(articles_from_repo())


def test_normaliza_tildes_y_signos():
    assert normalize("¿Cómo REGISTRO una salida?") == "como registro una salida"


def test_las_variantes_tienen_errores_de_escritura_pero_se_parecen():
    import random

    rng = random.Random(1)
    text = "registrar una salida de mercancia"
    variant = typo(text, rng)
    assert variant != text and len(variant.split()) == len(text.split())


def test_el_conjunto_de_prueba_no_aparece_en_el_entrenamiento():
    """Las preguntas de evaluación son nuevas: el modelo no las ve al entrenar."""
    if not KB.exists():
        pytest.skip("sin fichas")
    texts, _ = build_training_set(articles_from_repo())
    seen = set(texts)
    test_set = json.loads(TEST_SET.read_text(encoding="utf-8"))
    repeated = [c["q"] for c in test_set if normalize(c["q"]) in seen]
    assert repeated == []
    ids = {a["id"] for a in articles_from_repo()}
    assert {c["article"] for c in test_set} <= ids


def test_acierta_al_menos_85_por_ciento_y_responde_rapido(model):
    """Criterios 2 y 4 de HU-33."""
    metrics = evaluate(model, json.loads(TEST_SET.read_text(encoding="utf-8")))
    assert metrics["total"] >= 100
    assert metrics["accuracy"] >= TARGET_ACCURACY, metrics["confusions"]
    assert metrics["latencyMsP95"] < 300


def test_confianza_entre_0_y_1(model):
    result = model.predict("como registro una salida")
    assert result["articleId"] == "registrar-salida"
    assert 0 <= result["confidence"] <= 1
    assert all(0 <= a["confidence"] <= 1 for a in result["alternatives"])


def test_entiende_una_pregunta_de_seguimiento(model):
    """Criterio 3 de HU-34: «¿y una entrada?» después de preguntar por una salida."""
    assert is_follow_up("¿y una entrada?")
    result = model.predict("¿y una entrada?", ["¿cómo registro una salida?"])
    assert result["articleId"] == "registrar-entrada"
    assert result["usedContext"] is True
    assert not is_follow_up("como creo una orden de compra para el proveedor de pinturas")


def test_fichas_parecidas_con_embeddings(model):
    items = model.similar("quiero mover cajas a la otra sede", 3)
    assert items[0]["articleId"] == "transferir"
    assert items[0]["score"] >= items[1]["score"]


def test_se_guarda_y_se_carga(model):
    loaded = AssistantModel.loads(model.dumps())
    started = time.perf_counter()
    assert loaded.predict("ver el stock actual")["articleId"] == "stock-actual"
    assert (time.perf_counter() - started) < 0.3


# ------------------------------------------------------------------ HU-36


def test_los_ejemplos_aprobados_se_suman_a_su_ficha_sin_filtrar_el_conjunto_de_prueba():
    from app.assistant import merge_examples

    articles = [{"id": "a", "examples": ["hola"]}, {"id": "b", "examples": []}]
    approved = [
        {"article": "a", "text": "¿Cómo hago un pedido nuevo?"},
        {"article": "b", "text": "Registrar una salida de bodega"},  # está en el conjunto de prueba
        {"article": "zz", "text": "ficha que ya no existe"},
    ]
    test_set = [{"article": "b", "q": "registrar una salida de bodega"}]
    merged, used = merge_examples(articles, approved, test_set)
    assert used == 1
    assert merged[0]["examples"] == ["hola", "¿Cómo hago un pedido nuevo?"]
    assert merged[1]["examples"] == []


def test_la_version_nueva_solo_reemplaza_si_el_acierto_no_baja():
    from app.assistant import decide

    assert decide(0.80, None, 100)[0] is True  # no había modelo
    accept, reason = decide(0.90, {"version": 3, "accuracy": 0.88}, 157, approved=4)
    assert accept and "v3" in reason and "4 ejemplos aprobados" in reason
    assert decide(0.88, {"version": 3, "accuracy": 0.88}, 157)[0] is True  # igual: no baja
    accept, reason = decide(0.86, {"version": 3, "accuracy": 0.88}, 157)
    assert not accept and "Se conserva" in reason
