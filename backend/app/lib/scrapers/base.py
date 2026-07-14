"""
Scraper base classes + registry.

Each scraper implements ``BaseScraper``:

    class MyScraper(BaseScraper):
        name = "my_source"

        def fetch(self, site_key: str, *, since: date, until: date) -> list[dict]:
            # Pull observations from a public source.
            # Each dict matches NoDiveLabel schema:
            #   {date, label, actual_viz_m, actual_current, comments, no_go_reason, confidence}
            return [...]

The registry collects scrapers and ``run_all()`` persists the rows.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Iterable

from app.lib import db as db_mod

logger = logging.getLogger(__name__)


@dataclass
class ScraperResult:
    """One scraper's run summary."""

    scraper: str
    site_key: str
    rows_fetched: int = 0
    rows_inserted: int = 0
    rows_skipped: int = 0
    errors: list[str] = field(default_factory=list)
    elapsed_ms: float = 0.0

    def to_dict(self) -> dict:
        return {
            "scraper": self.scraper,
            "site_key": self.site_key,
            "rows_fetched": self.rows_fetched,
            "rows_inserted": self.rows_inserted,
            "rows_skipped": self.rows_skipped,
            "errors": self.errors,
            "elapsed_ms": round(self.elapsed_ms, 1),
        }


class BaseScraper(ABC):
    """Base class for data-flywheel scrapers."""

    #: Identifier for this scraper; matches ``NoDiveLabel.source`` prefix.
    name: str = "unnamed"

    @abstractmethod
    def fetch(self, site_key: str, *, since: date, until: date) -> list[dict]:
        """Return a list of label-shaped dicts (without site_key / source)."""
        raise NotImplementedError

    # ── Registry helpers (subclasses inherit these automatically) ──
    def to_label_rows(self, site_key: str, rows: list[dict]) -> list[db_mod.NoDiveLabel]:
        """Wrap raw dicts into NoDiveLabel ORM rows."""
        out = []
        for r in rows:
            d = r["date"]
            if isinstance(d, str):
                from datetime import date as _date
                d = _date.fromisoformat(d)
            out.append(
                db_mod.NoDiveLabel(
                    site_key=site_key,
                    date=d,
                    label=r.get("label", "dive"),
                    source=f"{self.name}_{r.get('sub_source', 'feed')}",
                    actual_viz_m=r.get("actual_viz_m"),
                    actual_current=r.get("actual_current"),
                    comments=r.get("comments"),
                    no_go_reason=r.get("no_go_reason"),
                    confidence=r.get("confidence", "low"),
                )
            )
        return out


# ── Registry ────────────────────────────────────────────────────────────────
_REGISTRY: dict[str, type[BaseScraper]] = {}


def register_scraper(cls: type[BaseScraper]) -> type[BaseScraper]:
    """Class decorator — adds the scraper to the global registry."""
    if not cls.name or cls.name == "unnamed":
        raise ValueError(f"{cls.__name__} must set a unique .name")
    if cls.name in _REGISTRY:
        raise ValueError(f"Scraper {cls.name!r} already registered")
    _REGISTRY[cls.name] = cls
    return cls


def list_scrapers() -> list[str]:
    return sorted(_REGISTRY)


def get_scraper(name: str) -> BaseScraper:
    if name not in _REGISTRY:
        raise KeyError(f"unknown scraper {name!r}; available: {list_scrapers()}")
    return _REGISTRY[name]()


def run_all(
    site_key: str,
    *,
    since: date,
    until: date,
    scrapers: Iterable[str] | None = None,
) -> list[ScraperResult]:
    """Run every (or selected) registered scraper for a site.

    Returns one ``ScraperResult`` per scraper run. Rows are persisted to
    ``no_dive_labels``; duplicates on the ``(site_key, date, source)``
    unique constraint are silently skipped.
    """
    import time
    from sqlalchemy.dialects.sqlite import insert as sqlite_upsert

    selected = list(scrapers) if scrapers else list_scrapers()
    out: list[ScraperResult] = []
    for name in selected:
        scraper = get_scraper(name)
        result = ScraperResult(scraper=name, site_key=site_key)
        t0 = time.perf_counter()
        try:
            rows = scraper.fetch(site_key, since=since, until=until)
            result.rows_fetched = len(rows)
            if not rows:
                result.elapsed_ms = (time.perf_counter() - t0) * 1000
                out.append(result)
                continue

            # Convert raw dicts → ORM rows, then upsert in one statement.
            # ``INSERT ... ON CONFLICT DO NOTHING`` is the only safe path
            # for batches that may include duplicates — a pre-flight
            # SELECT per row is O(N) queries per scraper run, which gets
            # slow when viz_app feeds us 10k rows.
            label_rows = scraper.to_label_rows(site_key, rows)
            session = db_mod.SessionLocal()
            try:
                # Upsert + return inserted rowids so we can count.
                stmt = sqlite_upsert(db_mod.NoDiveLabel).values(
                    [
                        {
                            "site_key": r.site_key,
                            "date": r.date,
                            "label": r.label,
                            "source": r.source,
                            "actual_viz_m": r.actual_viz_m,
                            "actual_current": r.actual_current,
                            "comments": r.comments,
                            "shop_name": r.shop_name,
                            "no_go_reason": r.no_go_reason,
                            "confidence": r.confidence,
                        }
                        for r in label_rows
                    ]
                ).on_conflict_do_nothing(
                    index_elements=["site_key", "date", "source"],
                )
                result_proxy = session.execute(stmt)
                session.commit()
                # SQLite's rowcount == number of rows actually inserted.
                inserted = result_proxy.rowcount or 0
                result.rows_inserted = inserted
                result.rows_skipped = len(label_rows) - inserted
            except Exception as exc:
                session.rollback()
                raise
            finally:
                session.close()
        except Exception as exc:
            logger.warning("Scraper %s failed for %s: %s", name, site_key, exc)
            result.errors.append(str(exc))
        finally:
            result.elapsed_ms = (time.perf_counter() - t0) * 1000
            out.append(result)
    return out