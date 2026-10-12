"""HU-33 y T-35.1: modelo propio del asistente de ayuda.

- Clasificador de intenciones: TF-IDF de palabras y de pedazos de palabras (aguanta errores
  de escritura) + regresión logística, que da una confianza entre 0 y 1.
- Búsqueda de fichas parecidas: *embeddings* densos (LSA: TF-IDF reducido con SVD) y
  similitud coseno contra el centro de cada ficha.

El entrenamiento usa solo las preguntas de ejemplo de las fichas (más variantes con errores
de escritura). La evaluación usa `data/assistant_test.json`: preguntas escritas a mano, con
otras palabras, que el modelo nunca ve al entrenar.
"""

from __future__ import annotations

import io
import json
import logging
import random
import re
import threading
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import joblib
import numpy as np
import psycopg
from psycopg.rows import dict_row
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import FeatureUnion, Pipeline

from .config import Settings
from .forecasting import pct

log = logging.getLogger("stocksense.assistant")

TARGET_ACCURACY = 0.85
TYPO_VARIANTS = 2
CONTEXT_WEIGHT = 0.5
RELOAD_SECONDS = 30
FOLLOW_UP_STARTS = ("y ", "e ", "o ", "tambien", "ahora ", "entonces ", "pero ")
FOLLOW_UP_WORDS = {"eso", "esa", "ese", "ahi", "alli", "esto", "mismo", "misma", "lo", "la", "le"}


def normalize(text: str) -> str:
    """Minúsculas, sin tildes ni signos: «¿Cómo registro?» → «como registro»."""
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-z0-9ñ ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def typo(text: str, rng: random.Random) -> str:
    """Una variante con 1 o 2 errores de escritura comunes (letra que falta, cambiada o repetida)."""
    words = text.split()
    candidates = [i for i, w in enumerate(words) if len(w) > 3]
    if not candidates:
        return text
    for i in rng.sample(candidates, k=min(len(candidates), rng.choice((1, 2)))):
        w = words[i]
        j = rng.randrange(1, len(w) - 1)
        op = rng.choice(("drop", "swap", "double", "vowel"))
        if op == "drop":
            w = w[:j] + w[j + 1 :]
        elif op == "swap":
            w = w[: j - 1] + w[j] + w[j - 1] + w[j + 1 :]
        elif op == "double":
            w = w[:j] + w[j] + w[j:]
        else:
            w = w[:j] + rng.choice("aeiou") + w[j + 1 :]
        words[i] = w
    return " ".join(words)


def build_training_set(articles: list[dict], seed: int = 7) -> tuple[list[str], list[str]]:
    """Ejemplos de cada ficha (y su título) más variantes con errores de escritura."""
    rng = random.Random(seed)
    texts: list[str] = []
    labels: list[str] = []
    for article in articles:
        seen = set()
        for raw in [article["title"], *article["examples"], *article.get("keywords", [])]:
            clean = normalize(raw)
            if not clean or clean in seen:
                continue
            seen.add(clean)
            texts.append(clean)
            labels.append(article["id"])
            for _ in range(TYPO_VARIANTS):
                texts.append(typo(clean, rng))
                labels.append(article["id"])
    return texts, labels


def make_classifier() -> Pipeline:
    return Pipeline(
        [
            (
                "features",
                FeatureUnion(
                    [
                        ("words", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), sublinear_tf=True)),
                        ("chars", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True, min_df=2)),
                    ]
                ),
            ),
            ("clf", LogisticRegression(C=20, max_iter=3000)),
        ]
    )


class AssistantModel:
    """Lo que se guarda en `assistant_models.artifact`."""

    def __init__(self, classifier: Pipeline, svd: TruncatedSVD, centroids: np.ndarray, article_ids: list[str]):
        self.classifier = classifier
        self.svd = svd
        self.centroids = centroids
        self.article_ids = article_ids

    @classmethod
    def train(cls, articles: list[dict]) -> AssistantModel:
        texts, labels = build_training_set(articles)
        classifier = make_classifier().fit(texts, labels)
        matrix = classifier.named_steps["features"].transform(texts)
        components = max(2, min(128, matrix.shape[1] - 1, matrix.shape[0] - 1))
        svd = TruncatedSVD(n_components=components, random_state=7).fit(matrix)
        embedded = _unit(svd.transform(matrix))
        article_ids = [a["id"] for a in articles]
        by_label = defaultdict(list)
        for vector, label in zip(embedded, labels, strict=True):
            by_label[label].append(vector)
        centroids = _unit(np.array([np.mean(by_label[aid], axis=0) for aid in article_ids]))
        return cls(classifier, svd, centroids, article_ids)

    def probabilities(self, text: str) -> dict[str, float]:
        proba = self.classifier.predict_proba([normalize(text)])[0]
        return dict(zip(self.classifier.classes_, proba, strict=True))

    def predict(self, text: str, previous: list[str] | None = None) -> dict:
        """Función más probable y su confianza. Con una pregunta de seguimiento («¿y una
        entrada?») combina la probabilidad de la pregunta con la de la anterior."""
        probs = self.probabilities(text)
        used_context = False
        if previous and is_follow_up(text):
            before = self.probabilities(previous[-1])
            combined = {k: p * (before.get(k, 0.0) ** CONTEXT_WEIGHT) for k, p in probs.items()}
            total = sum(combined.values())
            if total > 0:
                probs = {k: v / total for k, v in combined.items()}
                used_context = True
        ranked = sorted(probs.items(), key=lambda kv: kv[1], reverse=True)
        return {
            "articleId": ranked[0][0],
            "confidence": round(float(ranked[0][1]), 4),
            "alternatives": [{"articleId": k, "confidence": round(float(v), 4)} for k, v in ranked[1:4]],
            "usedContext": used_context,
        }

    def similar(self, text: str, k: int = 4) -> list[dict]:
        vector = _unit(self.svd.transform(self.classifier.named_steps["features"].transform([normalize(text)])))[0]
        scores = self.centroids @ vector
        order = np.argsort(-scores)[:k]
        return [{"articleId": self.article_ids[i], "score": round(float(scores[i]), 4)} for i in order]

    def dumps(self) -> bytes:
        buffer = io.BytesIO()
        joblib.dump(self, buffer, compress=3)
        return buffer.getvalue()

    @staticmethod
    def loads(data: bytes) -> AssistantModel:
        # El artefacto solo lo escribe este servicio en la base de datos interna.
        return joblib.load(io.BytesIO(data))


def _unit(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=-1, keepdims=True)
    return matrix / np.where(norms == 0, 1, norms)


def is_follow_up(text: str) -> bool:
    clean = normalize(text)
    words = clean.split()
    if not words or len(words) > 6:
        return False
    return clean.startswith(FOLLOW_UP_STARTS) or bool(FOLLOW_UP_WORDS & set(words)) or len(words) <= 2


# --- Datos -------------------------------------------------------------------------------

ARTICLES_SQL = """SELECT id, title, summary, examples, keywords FROM assistant_articles ORDER BY id"""
HASH_SQL = """SELECT md5(coalesce(string_agg(id || title || examples::text || array_to_string(keywords, ','), '|'
                                         ORDER BY id), ''))
                AS hash, count(*)::int AS n FROM assistant_articles"""


def load_articles(conn: psycopg.Connection) -> list[dict]:
    return [dict(r) for r in conn.execute(ARTICLES_SQL).fetchall()]


def articles_hash(conn: psycopg.Connection) -> tuple[str, int]:
    row = conn.execute(HASH_SQL).fetchone()
    return (row["hash"], row["n"]) if isinstance(row, dict) else (row[0], row[1])


def load_test_set(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def evaluate(model: AssistantModel, test_set: list[dict]) -> dict:
    """Acierto en preguntas no vistas, acierto por ficha, confusiones y latencia."""
    hits = 0
    per_article: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    confusions: Counter[tuple[str, str]] = Counter()
    latencies = []
    scored = []
    for case in test_set:
        started = time.perf_counter()
        result = model.predict(case["q"], case.get("previous"))
        latencies.append((time.perf_counter() - started) * 1000)
        ok = result["articleId"] == case["article"]
        hits += ok
        per_article[case["article"]][0] += ok
        per_article[case["article"]][1] += 1
        scored.append((result["confidence"], ok))
        if not ok:
            confusions[(case["article"], result["articleId"])] += 1
    thresholds = []
    for t in (0.2, 0.3, 0.4, 0.5, 0.6, 0.7):
        accepted = [ok for c, ok in scored if c >= t]
        thresholds.append(
            {
                "threshold": t,
                "coverage": round(len(accepted) / len(scored), 4) if scored else 0,
                "accuracy": round(sum(accepted) / len(accepted), 4) if accepted else None,
            }
        )
    return {
        "accuracy": round(hits / len(test_set), 4) if test_set else 0.0,
        "hits": hits,
        "total": len(test_set),
        "latencyMsAvg": round(float(np.mean(latencies)), 2) if latencies else None,
        "latencyMsP95": round(float(np.percentile(latencies, 95)), 2) if latencies else None,
        "perArticle": {k: {"hits": v[0], "total": v[1]} for k, v in sorted(per_article.items())},
        "confusions": [{"expected": e, "predicted": p, "count": n} for (e, p), n in confusions.most_common(10)],
        "thresholds": thresholds,
    }


def train_assistant(settings: Settings, trigger: str = "MANUAL", job_id: str | None = None) -> dict:
    """Entrena, evalúa y guarda una versión. Se activa si llega a la meta (85 %)."""
    started = time.monotonic()
    with psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=True) as conn:
        articles = load_articles(conn)
        if not articles:
            raise RuntimeError("No hay fichas en la base de conocimiento. Arranca la API para sincronizarlas.")
        known = {a["id"] for a in articles}
        test_set = load_test_set(settings.assistant_test_set)
        missing = sorted({c["article"] for c in test_set} - known)
        test_set = [c for c in test_set if c["article"] in known]
        model = AssistantModel.train(articles)
        metrics = evaluate(model, test_set)
        metrics["missingArticles"] = missing
        metrics["trigger"] = trigger
        digest, _ = articles_hash(conn)
        train_size = len(build_training_set(articles)[0])
        accuracy = metrics["accuracy"]
        active = conn.execute("SELECT version, accuracy::float AS accuracy FROM assistant_models WHERE is_active").fetchone()

        if accuracy >= TARGET_ACCURACY:
            accept, reason = True, f"Acierto {pct(accuracy)} en {metrics['total']} preguntas no vistas (meta 85 %)."
        elif active is None:
            accept, reason = True, f"Acierto {pct(accuracy)}, debajo de la meta de 85 %. Se activa porque no había otro modelo."
        else:
            accept, reason = (
                False,
                (f"Acierto {pct(accuracy)}, debajo de la meta de 85 %. Se conserva la versión v{active['version']}."),
            )

        with conn.transaction():
            if accept:
                conn.execute("UPDATE assistant_models SET is_active = false WHERE is_active")
            row = conn.execute(
                """INSERT INTO assistant_models (status, is_active, accuracy, train_size, test_size, articles, articles_hash,
                                                 metrics, artifact, reason, duration_ms, job_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, version""",
                (
                    "READY" if accept else "REJECTED",
                    accept,
                    accuracy,
                    train_size,
                    metrics["total"],
                    len(articles),
                    digest,
                    json.dumps(metrics),
                    model.dumps(),
                    reason,
                    int((time.monotonic() - started) * 1000),
                    job_id,
                ),
            ).fetchone()
            # Se conservan los artefactos de las últimas 5 versiones (y el activo).
            conn.execute(
                """UPDATE assistant_models SET artifact = NULL
                    WHERE NOT is_active AND artifact IS NOT NULL
                      AND id NOT IN (SELECT id FROM assistant_models ORDER BY version DESC LIMIT 5)"""
            )
        log.info("Asistente v%s: %s", row["version"], reason)
        RUNTIME.invalidate()
        return {"version": row["version"], "accepted": accept, "accuracy": accuracy, "reason": reason}


class Runtime:
    """Modelo activo en memoria; revisa cada 30 s si hay una versión nueva."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model: AssistantModel | None = None
        self._version: int | None = None
        self._checked = 0.0

    def invalidate(self) -> None:
        self._checked = 0.0

    def get(self, settings: Settings) -> tuple[AssistantModel | None, int | None]:
        with self._lock:
            if self._model is None or time.monotonic() - self._checked > RELOAD_SECONDS:
                self._checked = time.monotonic()
                with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
                    row = conn.execute("SELECT version FROM assistant_models WHERE is_active AND artifact IS NOT NULL").fetchone()
                    if row is None:
                        self._model, self._version = None, None
                    elif row["version"] != self._version:
                        artifact = conn.execute(
                            "SELECT artifact FROM assistant_models WHERE version = %s", (row["version"],)
                        ).fetchone()["artifact"]
                        self._model, self._version = AssistantModel.loads(bytes(artifact)), row["version"]
            return self._model, self._version


RUNTIME = Runtime()
