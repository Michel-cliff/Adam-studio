def allocate(spans: list[tuple[int, int]]) -> list[int]:
    """Track index for each (start, end) span, spans sorted by start: spans on one track never overlap."""
    ends: list[int] = []
    out: list[int] = []
    for start, end in spans:
        for i, e in enumerate(ends):
            if e <= start:
                ends[i] = end
                out.append(i)
                break
        else:
            ends.append(end)
            out.append(len(ends) - 1)
    return out
