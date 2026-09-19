"""
Alert system for SeaSID.

Generates in-app alerts when conditions cross thresholds.
Optionally sends email alerts via SMTP.
"""

from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText

from dotenv import load_dotenv

from app.lib import db
from app.lib.features import build_features
from app.lib.scoring import features_dict_from_row
from app.lib.sites import get_all_sites

logger = logging.getLogger(__name__)

load_dotenv()

# ── Alert thresholds ───────────────────────────────────────────────────────
ALERT_THRESHOLDS = {
    "high_wind": {"wind_max_24h_kmh": 35.0, "kind": "high_wind", "message": "Wind gusts exceed 35 km/h — unsafe for small boats."},
    "heavy_rain": {"precip_24h_mm": 25.0, "kind": "heavy_rain", "message": "Heavy rainfall (>25mm/24h) — visibility likely severely reduced."},
    "high_waves": {"wave_max_24h_m": 2.0, "kind": "high_waves", "message": "Wave height exceeds 2m — dangerous surface conditions."},
    "strong_current": {"tide_range_24h_m": 1.5, "kind": "strong_current", "message": "Large tidal range (>1.5m) — strong currents expected."},
}

# Audit F-B1-16: during a multi-day storm the per-hour idempotency key alone
# produced one alert per hour per kind. An event cooldown collapses that to
# one alert per condition episode; a scheduled check within the cooldown is
# silently skipped.
ALERT_EVENT_COOLDOWN_H = float(os.getenv("ALERT_EVENT_COOLDOWN_H", "6"))


def check_and_create_alerts(site_key: str) -> list[dict]:
    """
    Check current conditions against thresholds and create alerts.
    Idempotent twice over: the (site, kind, ts_hour) unique constraint
    blocks same-hour duplicates, and the event cooldown skips a kind that
    already fired within the cooldown window.

    Returns list of new alerts created.
    """
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    cooldown_cutoff = now - timedelta(hours=ALERT_EVENT_COOLDOWN_H)

    try:
        feat_df = build_features(site_key, now)
        feat_dict = features_dict_from_row(feat_df.values[0])
    except Exception as exc:
        logger.warning("Cannot check alerts for %s: %s", site_key, exc)
        return []

    new_alerts = []
    session = db.SessionLocal()

    try:
        for alert_name, config in ALERT_THRESHOLDS.items():
            feature_name = [k for k in config.keys() if k not in ("kind", "message")][0]
            threshold = config[feature_name]
            current_value = feat_dict.get(feature_name, 0)

            if current_value >= threshold:
                # Event cooldown: this kind already fired recently for this
                # site — the condition persists but does not need a new alert.
                recent = (
                    session.query(db.Alert)
                    .filter(
                        db.Alert.site_key == site_key,
                        db.Alert.kind == config["kind"],
                        db.Alert.ts_hour >= cooldown_cutoff,
                    )
                    .first()
                )
                if recent is not None:
                    continue

                message = f"{config['message']} (Current: {current_value:.1f})"

                alert = db.Alert(
                    site_key=site_key,
                    kind=config["kind"],
                    ts_hour=now,
                    channel="in_app",
                    message=message,
                )
                session.add(alert)
                new_alerts.append({
                    "site_key": site_key,
                    "kind": config["kind"],
                    "message": message,
                    "ts_hour": now.isoformat(),
                })

        session.commit()
    except Exception as exc:
        session.rollback()
        logger.error("Alert creation failed: %s", exc)
    finally:
        session.close()

    # Send email for new alerts if configured
    if new_alerts and _smtp_configured():
        _send_email_alerts(site_key, new_alerts)

    return new_alerts


def check_all_sites() -> list[dict]:
    """Check alerts for all registered sites."""
    all_alerts = []
    for site in get_all_sites():
        alerts = check_and_create_alerts(site["key"])
        all_alerts.extend(alerts)
    return all_alerts


def get_recent_alerts(site_key: str | None = None, hours: int = 24) -> list[dict]:
    """Fetch recent alerts from the database."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    session = db.SessionLocal()
    try:
        query = session.query(db.Alert).filter(db.Alert.sent_at >= cutoff)
        if site_key:
            query = query.filter(db.Alert.site_key == site_key)

        alerts = query.order_by(db.Alert.sent_at.desc()).limit(50).all()

        return [
            {
                "id": a.id,
                "site_key": a.site_key,
                "kind": a.kind,
                "message": a.message,
                "ts_hour": a.ts_hour.isoformat() if a.ts_hour else None,
                "sent_at": a.sent_at.isoformat() if a.sent_at else None,
                "channel": a.channel,
            }
            for a in alerts
        ]
    finally:
        session.close()


# ── Email alerts ───────────────────────────────────────────────────────────

def _smtp_configured() -> bool:
    """Check if all SMTP fields are present."""
    required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "ALERT_EMAIL_TO"]
    return all(os.getenv(k, "").strip() for k in required)


def _send_email_alerts(site_key: str, alerts: list[dict]) -> bool:
    """Send email alerts via SMTP. Returns True on success."""
    if not _smtp_configured():
        return False

    try:
        host = os.getenv("SMTP_HOST", "")
        port = int(os.getenv("SMTP_PORT", "587"))
        user = os.getenv("SMTP_USER", "")
        password = os.getenv("SMTP_PASS", "")
        to_addr = os.getenv("ALERT_EMAIL_TO", "")

        body = f"SeaSID Alert for {site_key}\n{'='*40}\n\n"
        for a in alerts:
            body += f"⚠️ [{a['kind']}] {a['message']}\n\n"

        msg = MIMEText(body)
        msg["Subject"] = f"SeaSID Alert: {len(alerts)} warning(s) for {site_key}"
        msg["From"] = user
        msg["To"] = to_addr

        with smtplib.SMTP(host, port, timeout=10) as server:
            # Audit F-B1-09: explicit timeout (a hung SMTP server used to
            # block the request thread forever) and certificate-verifying
            # TLS context (starttls() without one does not verify).
            import ssl
            server.starttls(context=ssl.create_default_context())
            server.login(user, password)
            server.sendmail(user, [to_addr], msg.as_string())

        logger.info("Sent %d email alerts for %s", len(alerts), site_key)
        return True

    except Exception as exc:
        logger.error("Email alert failed: %s", exc)
        return False
