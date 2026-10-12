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
