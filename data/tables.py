"""Minimal HTML table reader for the Wikipedia pages build.py scrapes."""
from html.parser import HTMLParser


class _Tables(HTMLParser):
    SKIP = {"style", "script", "sup"}  # footnote markers and inline CSS are not cell text

    def __init__(self):
        super().__init__()
        self.tables, self.stack, self.cell, self.skip = [], [], None, 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag == "table":
            self.stack.append([])
        elif tag == "tr" and self.stack:
            self.stack[-1].append([])
        elif tag in ("td", "th") and self.stack and self.stack[-1]:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip -= 1
        elif tag in ("td", "th") and self.cell is not None and self.stack:
            self.stack[-1][-1].append(" ".join("".join(self.cell).split()))
            self.cell = None
        elif tag == "table" and self.stack:
            self.tables.append(self.stack.pop())

    def handle_data(self, data):
        if self.cell is not None and not self.skip:
            self.cell.append(data)


def read_tables(html):
    """Return every table as a list of rows, each row a list of cell strings."""
    parser = _Tables()
    parser.feed(html)
    return parser.tables
