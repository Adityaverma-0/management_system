
"""Offline Tesseract OCR with coordinate-based reconstruction of ruled tables."""
import csv
import io
import os
import re
import statistics
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


class OCRError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def tesseract_binary():
    configured = os.environ.get('TESSERACT_CMD')
    candidates = [configured] if configured else [shutil.which('tesseract'), '/opt/homebrew/bin/tesseract', '/usr/local/bin/tesseract']
    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise OCRError('OCR_UNAVAILABLE', 'Local OCR is unavailable. Install Tesseract with English language data on the server, then retry.')


def recognize(image, folder, name, psm, deadline=None):
    # Leptonica on macOS needs canonical paths, including /private/tmp rather than /tmp.
    path = str(Path(folder, name + '.png').resolve())
    image.save(path)
    command = [tesseract_binary(), path, 'stdout', '-l', 'eng', '--psm', str(psm), '-c', 'tessedit_create_tsv=1', '-c', 'thresholding_method=2']
    remaining = min(25, deadline - time.monotonic()) if deadline is not None else 60
    if remaining <= 0:
        raise OCRError('OCR_TIMEOUT', 'Local OCR timed out. Try fewer pages or a clearer PDF.')
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=remaining, check=False)
    except subprocess.TimeoutExpired as exc:
        raise OCRError('OCR_TIMEOUT', 'Local OCR timed out. Try fewer pages or a clearer PDF.') from exc
    except OSError as exc:
        raise OCRError('OCR_UNAVAILABLE', 'The local OCR engine could not be started.') from exc
    if result.returncode:
        raise OCRError('OCR_FAILED', 'Local OCR could not read this scan. Check Tesseract English language data or try a clearer PDF.')
    words = []
    for row in csv.DictReader(io.StringIO(result.stdout), delimiter='\t', quoting=csv.QUOTE_NONE):
        if row.get('level') == '5' and row.get('text', '').strip():
            words.append({key: int(row[key]) for key in ('left', 'top', 'width', 'height')} | {'text': row['text'].strip(), 'confidence': float(row['conf']), 'line': tuple(row[k] for k in ('block_num', 'par_num', 'line_num'))})
    return words


def text_lines(words):
    rows = []
    for word in sorted(words, key=lambda word: (word['top'] + word['height'] / 2, word['left'])):
        y = word['top'] + word['height'] / 2
        if not rows or abs(rows[-1][0] - y) > max(8, word['height'] * .55):
            rows.append((y, []))
        rows[-1][1].append(word)
    output = []
    for _, words in rows:
        words.sort(key=lambda word: word['left'])
        line, last_right = '', None
        for word in words:
            gap = '  ' if last_right is not None and word['left'] - last_right > word['height'] else ' '
            line += (gap if line else '') + word['text']
            last_right = word['left'] + word['width']
        output.append(line)
    return '\n'.join(output)


def bands(values):
    groups = []
    for value in values:
        if not groups or value > groups[-1][1] + 1:
            groups.append([value, value])
        else:
            groups[-1][1] = value
    return groups


def table_grid(image):
    """Find a sustained grid, excluding the differently divided invoice heading."""
    width, height = image.size
    mask = image.point(lambda p: 255 if p < 200 else 0)
    xs = bands(x for x in range(width) if mask.crop((x, 0, x + 1, height)).histogram()[255] > height * .4)
    ys = bands(y for y in range(height) if mask.crop((0, y, width, y + 1)).histogram()[255] > width * .65)
    if len(xs) < 4 or len(ys) < 4:
        return None
    runs, run = [], []
    for index in range(len(ys) - 1):
        mid = (ys[index][1] + ys[index + 1][0]) // 2
        intersections = sum(mask.getpixel(((a + b) // 2, mid)) > 0 for a, b in xs)
        if intersections >= len(xs) * .8:
            run.append(index)
        else:
            if run:
                runs.append(run)
            run = []
    if run:
        runs.append(run)
    if not runs:
        return None
    run = max(runs, key=len)
    return (xs, ys[run[0]:run[-1] + 2]) if len(run) >= 3 else None


def grid_text(words, xs, ys):
    rows = []
    for top, bottom in zip(ys, ys[1:]):
        cells = []
        for left, right in zip(xs, xs[1:]):
            inside = [word for word in words if left[1] < word['left'] + word['width'] / 2 < right[0]
                      and top[1] < word['top'] + word['height'] / 2 < bottom[0]]
            # Fold wrapped cell text while retaining an explicit missing-cell marker.
            cells.append(' '.join(text_lines(inside).split()) or '-')
        rows.append(cells)
    return rows


def column_lines(words):
    """Use Tesseract's baselines: geometric clustering splits tilted names."""
    groups = {}
    for word in words:
        groups.setdefault(word['line'], []).append(word)
    return sorted(groups.values(), key=lambda row: min(w['top'] for w in row))


def curved_table(image, words, folder, deadline):
    """Conservative fallback for HSN tables with separate weight/pieces/Qty.

    Header labels locate columns; sustained dark rules follow the photographed
    page's curvature. Each column must independently agree with the HSN row
    count and spacing before its values are associated with product rows.
    """
    from PIL import Image
    def label(value):
        return next((w for w in words if re.sub(r'[^a-z/]', '', w['text'].lower()) == value), None)
    names = ('description', 'hsn/sac', 'kgs', 'pcs', 'qty', 'rate', 'uom')
    headers = {name: label(name) for name in names}
    if not all(headers.values()):
        return None
    hsn = headers['hsn/sac']
    h = hsn['height']
    if any(abs(w['top'] - hsn['top']) > h * 2 for w in headers.values()):
        return None
    anchors = sorted([w for w in words if w['top'] > hsn['top'] + h * 2
                      and abs(w['left'] - hsn['left']) < h
                      and re.fullmatch(r'\d{8}', w['text'])], key=lambda w: w['top'])
    if len(anchors) < 4:
        return None
    pitch = statistics.median(b['top'] - a['top'] for a, b in zip(anchors, anchors[1:]))
    if pitch < h or any(not pitch * .65 < b['top'] - a['top'] < pitch * 1.5 for a, b in zip(anchors, anchors[1:])):
        return None
    discounts = sorted([w for w in words if re.sub(r'[^a-z]', '', w['text'].lower()) == 'disc'
                        and abs(w['top'] - hsn['top']) < h * 2], key=lambda w: w['left'])
    amounts = sorted([w for w in words if w['text'].lower() == 'amount'
                      and abs(w['top'] - hsn['top']) < h * 2], key=lambda w: w['left'])
    if len(discounts) != 2 or len(amounts) != 2:
        return None
    desc, pcs, qty, rate, unit = (headers[k] for k in ('description', 'pcs', 'qty', 'rate', 'uom'))
    # The lower label of "Disc Amount" gives its left edge.
    boundaries = [(desc['left'] + desc['width'], hsn['left']),
                  (pcs['left'] + pcs['width'], qty['left']),
                  (qty['left'] + qty['width'], rate['left']),
                  (rate['left'] + rate['width'], unit['left']),
                  (unit['left'] + unit['width'], discounts[0]['left']),
                  (discounts[0]['left'] + discounts[0]['width'], amounts[0]['left']),
                  (amounts[0]['left'] + amounts[0]['width'], amounts[1]['left'])]
    pixels = image.load()
    top = max(0, round(anchors[0]['top'] - pitch * 1.2))
    bottom = min(image.height, round(anchors[-1]['top'] + pitch * 1.3))
    ys = list(range(anchors[0]['top'], anchors[-1]['top'] + 1, max(8, round(pitch * .65))))
    def score(x, y):
        return sum(pixels[x, yy] < 170 for yy in range(max(0, y - round(pitch * 1.3)), min(image.height, y + round(pitch * 1.3))))
    traces = []
    for lo, hi in boundaries:
        if hi <= lo:
            return None
        # Exclude the first data glyph: labels may extend into adjacent cells.
        candidates = [w['left'] for w in words if abs(w['top'] - anchors[0]['top']) < pitch
                      and lo < w['left'] < hi and re.search(r'\d', w['text'])]
        if candidates:
            hi = min(hi, min(candidates) - 2)
        if hi <= lo:
            return None
        x = max(range(lo, hi + 1), key=lambda xx: score(xx, ys[0]))
        trace = []
        for y in ys:
            step = max(2, round(pitch * .13))
            x = max(range(max(0, x - step), min(image.width, x + step + 1)), key=lambda xx: score(xx, y))
            trace.append(x)
        traces.append(trace)
    serial = [w for w in words if w['left'] < desc['left'] and abs(w['top'] - desc['top']) < h * 3]
    left = min((w['left'] for w in serial), default=0)
    full_left, full_right = [left] * len(ys), [image.width - 1] * len(ys)
    specs = [('description', full_left, traces[0]), ('quantity', traces[1], traces[2]),
             ('unit price', traces[2], traces[3]), ('unit', traces[3], traces[4]),
             ('discount %', traces[4], traces[5]), ('discount amount', traces[5], traces[6]),
             ('line total', traces[6], full_right)]
    columns = []
    reference = [w['top'] + w['height'] / 2 for w in anchors]
    for name, lefts, rights in specs:
        width = round(statistics.median(b - a for a, b in zip(lefts, rights))) - 7
        if width < 4:
            return None
        meshys = [top] + ys + [bottom]
        ll, rr = [lefts[0]] + lefts + [lefts[-1]], [rights[0]] + rights + [rights[-1]]
        mesh = [((0, (a - top) * 2, width * 2, (b - top) * 2),
                 (ll[j] + 4, a, ll[j + 1] + 4, b, rr[j + 1] - 3, b, rr[j] - 3, a))
                for j, (a, b) in enumerate(zip(meshys, meshys[1:]))]
        crop = image.transform((width * 2, (bottom - top) * 2), Image.Transform.MESH, mesh, Image.Resampling.BICUBIC)
        groups = column_lines(recognize(crop, folder, 'column-' + str(len(columns)), 6, deadline))
        candidates = []
        for group in groups:
            value = ' '.join(w['text'] for w in sorted(group, key=lambda w: w['left']))
            if name == 'description':
                value = re.sub(r'^[^A-Za-z]+', '', value)
                valid = bool(re.search(r'[A-Za-z]{2}', value))
            elif name == 'unit':
                valid = bool(re.fullmatch(r'[A-Za-z.]+', value))
            else:
                value = ' '.join(w['text'] for w in sorted(group, key=lambda w: w['left']) if re.search(r'\d|%', w['text']))
                valid = bool(re.search(r'\d', value))
            center = statistics.median(w['top'] + w['height'] / 2 for w in group) / 2 + top
            if valid and not (name == 'description' and center < reference[0] - pitch * .3):
                candidates.append((center, value))
        # Missing cells must not shift subsequent rows. Require both endpoints
        # near the HSN body and assign only unique, nearby coordinate matches.
        values = ['-'] * len(anchors)
        if len(anchors) * .8 <= len(candidates) <= len(anchors):
            start_delta = candidates[0][0] - reference[0]
            end_delta = candidates[-1][0] - reference[-1]
            if abs(start_delta) < pitch * .7 and abs(end_delta) < pitch * .7:
                expected = [ref + start_delta + (end_delta - start_delta) * i / (len(anchors) - 1) for i, ref in enumerate(reference)]
                assignments = {}
                for y, value in candidates:
                    i = min(range(len(expected)), key=lambda i: abs(y - expected[i]))
                    if abs(y - expected[i]) < pitch * (.65 if name == 'description' else .45):
                        assignments.setdefault(i, []).append(value)
                values = [assignments[i][0] if len(assignments.get(i, [])) == 1 else '-' for i in range(len(anchors))]
        columns.append(values)
    if all(value == '-' for value in columns[0]):
        return None
    return [[name for name, _, _ in specs] + ['HSN']] + [list(row) + [anchors[i]['text']] for i, row in enumerate(zip(*columns))]


def page_text(pdf_path, page_index, deadline=None):
    try:
        import pypdfium2 as pdfium
        from PIL import ImageDraw
    except ImportError as exc:
        raise OCRError('OCR_UNAVAILABLE', 'Local PDF rendering is unavailable. Install the invoice extraction requirements, then retry.') from exc
    tesseract_binary()
    with pdfium.PdfDocument(pdf_path) as document:
        page = document[page_index]
        try:
            width, height = page.get_size()
            scale = min(1 if width > 1500 else 200 / 72, (5_000_000 / max(1, width * height)) ** .5)
            bitmap = page.render(scale=scale)
            try:
                image = bitmap.to_pil().convert('L')
            finally:
                bitmap.close()
        finally:
            page.close()
    with tempfile.TemporaryDirectory(prefix='invoice-ocr-') as folder:
        grid = table_grid(image)
        if not grid:
            words = recognize(image, folder, 'page', 11, deadline)
            table = curved_table(image, words, folder, deadline)
            if table:
                return text_lines(words), table
            return text_lines(words), None
        xs, ys = grid
        heading = image.crop((0, 0, image.width, ys[0][0]))
        heading_words = recognize(heading, folder, 'heading', 11, deadline)
        heading_text = text_lines(heading_words)
        # A date in the right-hand header may be interleaved with the seller's name.
        for label in heading_words:
            if label['text'].lower().rstrip(':') == 'date':
                nearby = [word for word in heading_words if abs(word['left'] - label['left']) < label['height'] * 2
                          and 0 < word['top'] - label['top'] < label['height'] * 4
                          and re.fullmatch(r'\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}', word['text'])]
                if len(nearby) == 1:
                    heading_text += '\nDate: ' + nearby[0]['text']
        # Remove only table rules; never erase header/supplier text at the same x coordinate.
        cleaned = image.copy()
        draw = ImageDraw.Draw(cleaned)
        for a, b in ys:
            draw.rectangle((xs[0][0], a - 1, xs[-1][1], b + 1), fill=255)
        for a, b in xs:
            draw.rectangle((a - 1, ys[0][0], b + 1, ys[-1][1]), fill=255)

        table_top = ys[0][0]
        table_image = cleaned.crop((0, table_top, cleaned.width, cleaned.height))
        words = recognize(table_image, folder, 'table', 6, deadline)
        for word in words:
            word['top'] += table_top

        table = grid_text(words, xs, ys)
        # Tall rows contain wrapped names. Read these cells separately so OCR does
        # not merge the first line of the name into adjacent numeric columns.
        typical_height = statistics.median(bottom[0] - top[1] for top, bottom in zip(ys, ys[1:]))
        for ri, (top, bottom) in enumerate(zip(ys, ys[1:])):
            if bottom[0] - top[1] > typical_height * 1.35:
                for ci, (left, right) in enumerate(zip(xs, xs[1:])):
                    if right[0] - left[1] > image.width * .15:
                        crop = cleaned.crop((left[1] + 2, top[1] + 2, right[0] - 2, bottom[0] - 2))
                        value = text_lines(recognize(crop, folder, f'wrapped-{ri}-{ci}', 6, deadline))
                        if value.strip():
                            table[ri][ci] = ' '.join(value.split())
        footer = text_lines([word for word in words if word['top'] > ys[-1][1]])
        return heading_text + '\n' + footer, table