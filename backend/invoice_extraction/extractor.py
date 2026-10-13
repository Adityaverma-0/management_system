"""Local-only invoice extraction. Extraction never opens a database connection."""
import datetime
import json
import logging
import math
import os
import re
import sys
import time
from types import ModuleType
from difflib import get_close_matches

from local_ocr import OCRError, page_text

from invoice2data import extract_data
from invoice2data.extract.loader import read_templates
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer, LTImage, LTFigure
from pdfminer.pdfdocument import PDFPasswordIncorrect, PDFTextExtractionNotAllowed

logging.basicConfig(level=logging.ERROR)


class ExtractionError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


class ExtractedText(str):
    ocr_used = False


def local_text(pdf_path):
    """Preserve rows using PDF coordinates instead of pdfminer's column order."""
    with open(pdf_path, 'rb') as document:
        if not document.read(1024).lstrip().startswith(b'%PDF-'):
            raise ExtractionError('INVALID_PDF', 'Please select a valid PDF file.')
    pages, ocr_pages = [], 0
    started, ocr_seconds = time.monotonic(), 0
    deadline = time.monotonic() + 35
    try:
        for page_index, page in enumerate(extract_pages(pdf_path)):
            if page_index >= 100:
                raise ExtractionError('PDF_TOO_LARGE', 'Please use a PDF with at most 100 pages.')
            segments, has_images = [], False

            def collect(node):
                nonlocal has_images
                if isinstance(node, LTImage):
                    has_images = True
                elif isinstance(node, LTTextContainer):
                    for line in node:
                        if hasattr(line, 'get_text') and line.get_text().strip():
                            segments.append((line.y0, line.x0, line.get_text().strip()))
                elif isinstance(node, LTFigure):
                    for child in node:
                        collect(child)

            for node in page:
                collect(node)
            rows = []
            for y, x, value in sorted(segments, key=lambda s: (-s[0], s[1])):
                if not rows or abs(rows[-1][0] - y) > 3:
                    rows.append((y, []))
                rows[-1][1].append((x, value))
            text = '\n'.join('  '.join(value for _, value in sorted(cells)) for _, cells in rows)
            if not text.strip() and has_images:
                ocr_pages += 1
                if ocr_pages > 10:
                    raise ExtractionError('PDF_TOO_LARGE', 'Please split scanned PDFs into files of at most 10 pages.')
                try:
                    ocr_started = time.monotonic()
                    heading, table = page_text(pdf_path, page_index, deadline=deadline)
                    ocr_seconds += time.monotonic() - ocr_started
                    text = heading + ('\n' + ocr_table_text(table) if table else '')
                except OCRError as exc:
                    raise ExtractionError(exc.code, str(exc)) from exc
            pages.append(text)
    except ExtractionError:
        raise
    except (PDFPasswordIncorrect, PDFTextExtractionNotAllowed):
        raise ExtractionError('PROTECTED_PDF', 'This PDF is password-protected or does not allow text extraction.')
    except Exception as exc:
        raise ExtractionError('CORRUPT_PDF', 'This PDF could not be read. It may be corrupt or unsupported.') from exc
    if not pages:
        raise ExtractionError('CORRUPT_PDF', 'This PDF has no readable pages.')
    text = ExtractedText('\n\f\n'.join(pages))
    text.ocr_used = ocr_pages > 0
    text.diagnostics = {'pages': len(pages), 'ocr_pages': ocr_pages, 'ocr_ms': round(ocr_seconds * 1000), 'pdf_text_ms': round((time.monotonic() - started - ocr_seconds) * 1000)}
    if not text.strip():
        raise ExtractionError('NO_TEXT', 'No readable text was detected. Try a clearer scan or a digital PDF.')
    return text


def number(value):
    if value is None or str(value).strip() in ('', '-', '—'):
        return None
    cleaned = re.sub(r'^(?:₹|Rs\.?|INR)\s*', '', str(value).strip(), flags=re.I).rstrip('%').strip()
    if not re.fullmatch(r'-?(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3}|\d+)(?:\.\d+)?', cleaned):
        return None
    result = float(cleaned.replace(',', ''))
    return result if math.isfinite(result) else None


def normalize_unit(value):
    if not value or str(value).strip() in ('-', '—'):
        return None
    value = str(value).strip().upper()
    aliases = {'PCS': 'PIECE', 'PC': 'PIECE', 'NOS': 'PIECE', 'NO': 'PIECE', 'PIECES': 'PIECE', 'BOXES': 'BOX', 'STRIPS': 'STRIP'}
    return aliases.get(value.rstrip('.'), value)


def normalize_date(value):
    if not value:
        return None
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.strftime('%Y-%m-%d')
    value = str(value).strip()
    # Numeric day/month ambiguity must be corrected by the reviewer.
    for fmt in ('%Y-%m-%d', '%Y/%m/%d', '%d-%b-%Y', '%d %b %Y', '%d %B %Y'):
        try:
            return datetime.datetime.strptime(value, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    match = re.fullmatch(r'(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})', value)
    if match and int(match[1]) > 12:
        try:
            return datetime.date(int(match[3]), int(match[2]), int(match[1])).isoformat()
        except ValueError:
            pass
    return None


def metadata(text):
    def find(pattern):
        match = re.search(pattern, text, re.I | re.M)
        return match.group(1).strip() if match else None
    raw_date = find(r'\b(?:invoice\s+date|date)\s*[:#]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}[ -][A-Za-z]+[ -]\d{4})')
    supplier_block = re.search(r'^Bill\s+From[ \t]*:?\s*\n([^\n]+)(.*?)(?=^Bill\s+To|^Ship\s+To|^Item|\Z)', text, re.I | re.M | re.S)
    gstin = re.search(r'GSTIN\s*:\s*([0-9A-Z]{15})\b', supplier_block[2], re.I) if supplier_block else None
    return {
        'invoice_number': find(r'\b(?:invoice|bill)[ \t]*(?:number|no\.?|#)[ \t]*[:#]?[ \t]*([A-Za-z0-9][A-Za-z0-9/_.\-]*)'),
        'invoice_date': normalize_date(raw_date),
        'raw_invoice_date': raw_date,
        'supplier': find(r'^(?:supplier(?:\s+name)?|seller(?:\s+name)?|sold\s+by)\s*:\s*(.+?)(?:\s{2,}|$)') or (supplier_block[1].strip() if supplier_block else None),
        # An unlabelled GSTIN may belong to the buyer. Do not guess its owner.
        'supplier_gstin': find(r'(?:supplier|seller)\s+GSTIN\s*:\s*([0-9A-Z]{15})\b') or (gstin[1].upper() if gstin else None),
        'amount': number(find(r'^\s*(?:grand\s+total|invoice\s+total|total)\s*:?\s+(?:₹\s*)?([\d,.]+)\s*$')),
    }


HEADERS = {
    'description': ('item name', 'item description', 'goods description', 'description of goods', 'product description', 'description', 'particulars', 'product name', 'product', 'item'),
    'quantity': ('quantity', 'qty'),
    'unit': ('uom', 'unit', 'units'),
    'unit_price': ('purchase price', 'unit price', 'price/ unit', 'price/unit', 'unit rate', 'rate', 'price'),
    'line_total': ('line total', 'net amount', 'amount', 'total'),
    'sku': ('product code', 'item code', 'sku', 'code'),
    'barcode': ('barcode', 'ean'),
    'hsn': ('hsn/sac', 'hsn/ sac', 'hsn / sac', 'hsn code', 'hsn', 'sac'),
    'gst': ('gst %', 'gst%', 'gst rate', 'gst'),
    'discount_amount': ('discount amount', 'disc amount'),
    'taxable_amount': ('taxable amount', 'taxable value'),
    'cgst_rate': ('cgst %', 'cgst%', 'cgst rate'),
    'sgst_rate': ('sgst %', 'sgst%', 'sgst rate'),
    'igst_rate': ('igst %', 'igst%', 'igst rate'),
    'cgst': ('cgst amount', 'cgst'),
    'sgst': ('sgst amount', 'sgst'),
    'igst': ('igst amount', 'igst'),
    'discount': ('discount %', 'discount%', 'discount', 'disc %', 'disc.'),
    'serial': ('sr no.', 'sr no', 's.no.', 's.no', 'sl no', 'no.', '#'),
}


def header_columns(line):
    found = []
    for field, aliases in HEADERS.items():
        alternatives = '|'.join(re.escape(alias) for alias in sorted(aliases, key=len, reverse=True))
        for match in re.finditer(r'(?<!\w)(?:' + alternatives + r')(?!\w)', line, re.I):
            found.append((match.start(), match.end(), field, match.group()))
    # Keep the longest overlapping header ("unit price" before "unit").
    chosen = []
    for entry in sorted(found, key=lambda x: -(x[1] - x[0])):
        if not any(entry[0] < other[1] and entry[1] > other[0] for other in chosen):
            chosen.append(entry)
    chosen.sort()
    fields = [entry[2] for entry in chosen]
    if 'description' not in fields or 'quantity' not in fields or len(set(fields)) != len(fields):
        return None
    return chosen


def ocr_table_text(table):
    # Identify columns from their labels, never from invoice-specific positions.
    labels = {re.sub(r'[^a-z0-9]', '', alias): field for field, aliases in HEADERS.items() for alias in aliases}
    fields = []
    for cell in table[0]:
        label = re.sub(r'[^a-z0-9]', '', cell.lower())
        matches = get_close_matches(label, labels, n=1, cutoff=.85) if label else []
        fields.append(labels.get(label) or (labels[matches[0]] if matches else None))
    if 'description' not in fields or 'quantity' not in fields:
        return '\n'.join('  '.join(row) for row in table)
    selected = [(i, field) for i, field in enumerate(fields) if field and field != 'serial']
    header = '  '.join(('GST' if field == 'gst' else 'Discount') + ('%' if '%' in table[0][i] else '') if field in ('gst', 'discount') else HEADERS[field][0] for i, field in selected)
    rows = [list(row) for row in table[1:]]
    for i, field in selected:
        if field in ('unit_price', 'line_total', 'discount_amount', 'taxable_amount', 'cgst', 'sgst', 'igst') or (field == 'discount' and '%' not in table[0][i]):
            decimal_column = sum(bool(re.fullmatch(r'[\d,]+\.\d{2}', row[i])) for row in rows) > len(rows) / 2
            for row in rows:
                # A column printed with cents cannot safely become an integer if
                # OCR loses the decimal point. Request review instead of guessing.
                if decimal_column and not re.fullmatch(r'[\d,]+\.\d{2}', row[i]):
                    row[i] = '-'
    return header + '\n' + '\n'.join('  '.join(row[i] for i, _ in selected) for row in rows)


def fallback_parse(text, allow_missing_quantity=False):
    items, columns, warnings = [], None, []
    for line in text.splitlines():
        if not line.strip():
            continue
        header = header_columns(line)
        if header:
            columns = header
            continue
        if not columns:
            continue
        if re.match(r'^\s*(?:sub\s*total|grand\s+total|total|round\s*off|tax\s+summary|terms|bank\s+details)\b', line, re.I):
            columns = None
            continue
        cells = [cell.strip() for cell in re.split(r'\s{2,}|\t' if allow_missing_quantity else r'\s{2,}|\t|\s*\|\s*', line.strip()) if cell.strip()]
        if len(cells) != len(columns):
            # Wrapped/merged cells cannot be safely assigned to columns.
            if re.search(r'\d', line):
                warnings.append('Some table rows could not be assigned to columns. Review the PDF and add missing items.')
            continue
        row = {column[2]: cell for column, cell in zip(columns, cells)}
        quantity_unit = re.fullmatch(r'(\d+(?:\.\d+)?)\s+(PCS?|PIECES?|NOS?|BOX(?:ES)?|STRIPS?)\.?', row.get('quantity', ''), re.I)
        if quantity_unit and not row.get('unit'):
            row['quantity'], row['unit'] = quantity_unit.groups()
        quantity = number(row.get('quantity'))
        if (quantity is None and not allow_missing_quantity) or row.get('description') in (None, '', '-', '—'):
            continue
        item = {key: None for key in ('description', 'quantity', 'unit', 'unit_price', 'line_total', 'sku', 'barcode', 'hsn', 'gst', 'discount', 'discount_amount', 'taxable_amount', 'cgst', 'sgst', 'igst')}
        item.update({key: row.get(key) for key in ('description', 'sku', 'barcode', 'hsn')})
        item.update({key: number(row.get(key)) for key in ('quantity', 'unit_price', 'line_total', 'gst', 'discount', 'discount_amount', 'taxable_amount', 'cgst', 'sgst', 'igst')})
        item['unit'] = normalize_unit(row.get('unit'))
        if item['discount'] is not None and '%' in row.get('discount', '') and item['discount'] > 100:
            item['discount'] = None
        for field in ('sku', 'barcode', 'hsn'):
            if item[field] in ('-', '—'):
                item[field] = None
        rate = re.search(r'\((\d+(?:\.\d+)?)\s*%\)', row.get('gst', ''))
        if rate:
            item['gst'] = number(rate[1])
        item['discount_type'] = 'PERCENT' if any(c[2] == 'discount' and '%' in c[3] for c in columns) else ('AMOUNT' if row.get('discount') else None)
        if item['discount_type'] == 'PERCENT' and item['discount'] is not None and item['discount'] > 100:
            item['discount'] = None
        if any(row.get(field) for field in ('cgst_rate', 'sgst_rate', 'igst_rate')):
            warnings.append('CGST/SGST/IGST percentage columns were not interpreted as tax amounts. Confirm the tax amounts separately.')
        # Only GST percentage headers unambiguously describe a rate.
        if row.get('gst') and not ('%' in row['gst'] or any(c[2] == 'gst' and ('%' in c[3] or 'rate' in c[3].lower()) for c in columns)):
            item['gst'] = None
            warnings.append('An unlabelled GST amount was not interpreted as a tax rate.')
        items.append(item)
    return {'items': items, 'warnings': sorted(set(warnings)), **metadata(text)}


def normalize_template_item(row):
    def first(*keys):
        return next((row[k] for k in keys if row.get(k) is not None), None)
    return {
        'description': str(first('description', 'item', 'name') or '').strip(),
        'quantity': number(first('qty', 'quantity')),
        'unit': normalize_unit(first('unit', 'uom')),
        'unit_price': number(first('price', 'unit_price', 'rate')),
        'line_total': number(first('line_amount', 'amount', 'line_total')),
        'sku': first('sku', 'product_code'), 'barcode': first('barcode'), 'hsn': first('hsn'),
        'gst': number(first('gst_rate', 'gst_percent')),
        'discount': number(first('discount')), 'discount_type': first('discount_type'),
    }


def extract_invoice(pdf_path):
    started = time.monotonic()
    text = local_text(pdf_path)
    extraction_ms = round((time.monotonic() - started) * 1000)
    generic = fallback_parse(text, allow_missing_quantity=text.ocr_used)
    warnings = generic.pop('warnings')
    if text.ocr_used:
        inconsistent_rows = []
        for index, item in enumerate(generic['items'], 1):
            # A dropped decimal point can turn 847.17 into 84717. Never silently
            # repair money; blank an OCR price that conflicts with the printed total.
            qty, price, total, gst = (item[field] for field in ('quantity', 'unit_price', 'line_total', 'gst'))
            if qty and price is not None and total is not None:
                base = qty * price
                discount = item.get('discount_amount')
                if discount is None and item['discount'] is not None:
                    discount = base * item['discount'] / 100 if item['discount_type'] == 'PERCENT' else item['discount']
                net = base - (discount or 0)
                candidates = [net] + ([net * (1 + gst / 100)] if gst is not None else [])
                inconsistent = min(abs(total - candidate) for candidate in candidates) > max(1, abs(total) * .01) if gst is not None else not net * .99 <= total <= net * 1.5
                if inconsistent:
                    item['quantity'] = None
                    item['unit_price'] = None
                    item['line_total'] = None
                    inconsistent_rows.append(str(index))
            if qty and price is not None and item.get('discount_amount') is not None and item['discount'] is not None and item['discount_type'] == 'PERCENT':
                if abs(qty * price * item['discount'] / 100 - item['discount_amount']) > .1:
                    item['discount'] = None
                    warnings.append('Some printed discount rates disagree with the discount amounts. Confirm the missing rates against the PDF.')
        if inconsistent_rows:
            warnings.append('Check quantities, prices, tax and totals for items ' + ', '.join(inconsistent_rows) + '. Their OCR amounts do not agree; uncertain quantities, purchase prices and line totals were left blank.')
    templates = read_templates(os.path.join(os.path.dirname(__file__), 'templates'))
    reader = ModuleType('local_pdfminer')
    reader.to_text = lambda *_args, **_kwargs: text
    result = None
    try:
        # Explicit local reader prevents environment-dependent/cloud reader selection.
        result = extract_data(pdf_path, templates=templates, input_module=reader, ai_fallback=False)
    except Exception:
        warnings.append('The supplier template could not be parsed; local table extraction was used.')
    source = 'local_ocr' if text.ocr_used else 'generic_pdf_parser'
    if text.ocr_used:
        warnings.append('This scan was read using local OCR. Compare product names, quantities and prices with the PDF before saving.')
    if result:
        template_items = [normalize_template_item(row) for row in result.get('lines', []) if isinstance(row, dict)]
        template_items = [row for row in template_items if row['description'] and row['quantity'] is not None]
        # Prefer the generic table when the template dropped rows or a labelled price column.
        use_template = bool(template_items) and len(template_items) >= len(generic['items'])
        if generic['items'] and any(row['unit_price'] is not None for row in generic['items']) and any(row['unit_price'] is None for row in template_items):
            use_template = False
        if use_template:
            generic['items'] = template_items
            source = 'invoice2data'
        # A template's literal match (e.g. "Sample Purchase Invoice") is not an invoice number.
        if not generic['invoice_number'] and result.get('invoice_number') and str(result['invoice_number']) in text and re.search(r'\d', str(result['invoice_number'])):
            generic['invoice_number'] = str(result['invoice_number'])
        template_supplier = result.get('issuer') or result.get('supplier')
        if not generic['supplier'] and template_supplier and str(template_supplier).lower() in text.lower():
            generic['supplier'] = template_supplier
        if not generic['raw_invoice_date']:
            generic['invoice_date'] = normalize_date(result.get('date'))
        generic['amount'] = generic['amount'] if generic['amount'] is not None else number(result.get('amount'))
    if text.ocr_used and generic['amount'] is None:
        warnings.append('No final invoice total was detected. Check for continuation pages and verify all items before saving.')
    if any(row.get('unit') not in (None, 'BOX', 'STRIP', 'PIECE') for row in generic['items']):
        warnings.append('Unsupported invoice units require a confirmed product conversion. Do not treat bags as boxes automatically.')
    if not generic['items']:
        warnings.append('No reliable product rows were detected. Add items manually or use a clearer digital PDF.')
    if not generic['invoice_number']:
        warnings.append('Invoice number was not detected. Enter it before saving.')
    if generic['raw_invoice_date'] and not generic['invoice_date']:
        warnings.append('Invoice date is ambiguous. Confirm it before saving.')
    if any(row['quantity'] is None or row['unit'] is None or row['unit_price'] is None for row in generic['items']):
        warnings.append('Some quantities, units or purchase prices are missing. Complete them before saving.')
    return {'success': True, 'code': 'REVIEW_REQUIRED' if generic['items'] else ('NO_PRODUCT_ROWS' if any(header_columns(line) for line in text.splitlines()) else 'UNSUPPORTED_INVOICE_FORMAT'), 'diagnostics': {**getattr(text, 'diagnostics', {}), 'extraction_ms': extraction_ms, 'total_ms': round((time.monotonic() - started) * 1000), 'ocr_used': text.ocr_used, 'row_count': len(generic['items'])}, 'source': source, 'confidence': 'review_required', **generic, 'warnings': sorted(set(warnings))}


def main():
    try:
        if len(sys.argv) != 2:
            raise ExtractionError('MISSING_FILE', 'No PDF path provided.')
        output = extract_invoice(sys.argv[1])
    except ExtractionError as exc:
        output = {'success': False, 'code': exc.code, 'error': str(exc)}
    except Exception:
        output = {'success': False, 'code': 'EXTRACTION_FAILED', 'error': 'Local invoice extraction failed. Check the server extraction dependencies.'}
    print(json.dumps(output, allow_nan=False, default=str))


if __name__ == '__main__':
    main()
