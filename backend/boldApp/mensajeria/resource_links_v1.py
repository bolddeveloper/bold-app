"""Frozen, bounded link extraction shared with the historical backfill.

This module never fetches a URL. Keep v1 stable for migration reproducibility.
"""
import re
import unicodedata
from urllib.parse import urlsplit

URLS = re.compile(r'''(?:https?://|www\.)[^\s<>"']+''', re.IGNORECASE)


def resource_links(text):
    links, seen = [], set()
    for match in URLS.finditer(text or ""):
        label = match.group().rstrip(".,;:!?")
        while label.endswith(")") and label.count(")") > label.count("("):
            label = label[:-1]
        href = "https://" + label if label.lower().startswith("www.") else label
        if len(href) > 5008 or "\\" in href or any(c.isspace() or unicodedata.category(c).startswith("C") for c in href):
            continue
        try:
            parsed = urlsplit(href)
            if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname or parsed.username is not None or parsed.password is not None:
                continue
            parsed.port  # Reject malformed or out-of-range ports too.
            parsed.hostname.encode("idna")
        except (ValueError, UnicodeError):
            continue
        if href not in seen:
            links.append({"href": href, "label": label})
            seen.add(href)
    return links
