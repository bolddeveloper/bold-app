"""Accent-insensitive channel discovery, including small typing mistakes."""
import re
import unicodedata


def normalized(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value.lower()) if not unicodedata.combining(c))


def similar_word(term, word):
    if term in word:
        return True
    limit = 2 if len(term) >= 8 else 1 if len(term) >= 4 else 0
    if not limit or abs(len(term) - len(word)) > limit:
        return False
    previous = list(range(len(word) + 1))
    before = None
    for i, left in enumerate(term, 1):
        current = [i]
        for j, right in enumerate(word, 1):
            distance = min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (left != right))
            if before is not None and j > 1 and left == word[j - 2] and term[i - 2] == right:
                distance = min(distance, before[j - 2] + 1)
            current.append(distance)
        before, previous = previous, current
    return previous[-1] <= limit


def channel_matches(name, query):
    words = re.findall(r"\w+", normalized(name))
    return all(any(similar_word(term, word) for word in words) for term in re.findall(r"\w+", normalized(query)))
