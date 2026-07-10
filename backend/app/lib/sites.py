"""
Site registry for SeaSID.
Adding a new site is as simple as appending one dict entry.
"""

from __future__ import annotations

SITES: list[dict] = [
    {
        "key": "dauin_muck",
        "name": "Dauin Muck Bays",
        "type": "muck",
        "lat": 9.1844,
        "lon": 123.2678,
        "description": "World-class muck diving along Dauin's black-sand coast.",
        # AQICN's free tier has no nearby monitoring station for Dauin — the
        # nearest (Sandakan) is ~1100 km away. Skip air ingestion for this
        # site until a closer station appears or we add a paid tier.
        "air_provider_disabled": True,
    },
    {
        "key": "apo_reef",
        "name": "Apo Island Reef",
        "type": "reef",
        "lat": 9.0671,
        "lon": 123.2737,
        "description": "Marine sanctuary. Tidal currents can be dangerous for new divers.",
        "air_provider_disabled": True,
    },
]


def get_site(key: str) -> dict | None:
    """Return a site dict by key, or None if not found."""
    for site in SITES:
        if site["key"] == key:
            return site
    return None


def get_all_sites() -> list[dict]:
    """Return all registered sites."""
    return list(SITES)


def site_keys() -> list[str]:
    """Return all valid site keys."""
    return [s["key"] for s in SITES]


def is_muck_site(key: str) -> bool:
    """Return True if the site is a muck-diving site."""
    site = get_site(key)
    return site is not None and site["type"] == "muck"
