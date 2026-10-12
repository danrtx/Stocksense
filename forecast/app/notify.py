"""T-22.3: aviso por correo al equipo técnico cuando un trabajo falla."""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

import psycopg

from .config import Settings

log = logging.getLogger("stocksense.forecast")

KIND_LABELS = {
    "FORECAST_RETRAIN": "Reentrenamiento del pronóstico",
    "ASSISTANT_TRAIN": "Entrenamiento del asistente",
}


def recipients(settings: Settings, conn: psycopg.Connection) -> list[str]:
    """TECH_ALERT_EMAILS si está definido; si no, las personas administradoras activas."""
    if settings.tech_alert_emails:
        return settings.tech_alert_emails
    rows = conn.execute("SELECT email FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY email").fetchall()
    return [r["email"] if isinstance(r, dict) else r[0] for r in rows]


def build_failure_email(settings: Settings, job: dict, error: str, to: list[str]) -> EmailMessage:
    label = KIND_LABELS.get(job["kind"], job["kind"])
    message = EmailMessage()
    message["Subject"] = f"[StockSense] Falló: {label}"
    message["From"] = settings.mail_from
    message["To"] = ", ".join(to)
    message.set_content(
        "\n".join(
            [
                f"El trabajo «{label}» falló después de {job['attempts']} intento(s).",
                "",
                f"Origen: {'programado' if job['trigger'] == 'SCHEDULED' else job['trigger'].lower()}",
                f"Trabajo: {job['id']}",
                f"Encolado: {job['queued_at']:%Y-%m-%d %H:%M} (UTC)",
                "",
                "Motivo:",
                error[:1500],
                "",
                "El pronóstico vigente se conserva hasta que una ejecución termine bien.",
                f"Revisa StockSense › Pronóstico › Modelos ({settings.frontend_url}/pronostico/modelos).",
            ]
        )
    )
    return message


def send_failure_alert(settings: Settings, conn: psycopg.Connection, job: dict, error: str) -> bool:
    to = recipients(settings, conn)
    if not to:
        log.warning("No hay a quién avisar de la falla del trabajo %s.", job["id"])
        return False
    if not settings.smtp_host:
        log.warning("SMTP_HOST no está configurado: no se envió el aviso de falla a %s.", ", ".join(to))
        return False
    message = build_failure_email(settings, job, error, to)
    try:
        smtp_class = smtplib.SMTP_SSL if settings.smtp_port == 465 else smtplib.SMTP
        with smtp_class(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_user:
                if settings.smtp_port != 465:
                    smtp.starttls()
                smtp.login(settings.smtp_user, settings.smtp_pass)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        log.error("No se pudo enviar el aviso de falla: %s", exc)
        return False
    log.info("Aviso de falla enviado a %s.", ", ".join(to))
    return True
