import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from extractor import ExtractionError, extract_invoice, fallback_parse, local_text, normalize_date


def pdf_file(path, lines=(), image=False):
    # Small real PDFs built without optional test dependencies.
    content = 'BT /F1 10 Tf\n'
    for x, y, text in lines:
        text = text.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
        content += f'1 0 0 1 {x} {y} Tm ({text}) Tj\n'
    content += 'ET\n'
    if image:
        content += 'q 200 0 0 200 50 400 cm /Im1 Do Q\n'
    stream = content.encode()
    resources = '/Font << /F1 5 0 R >>' + (' /XObject << /Im1 6 0 R >>' if image else '')
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << {resources} >> /Contents 4 0 R >>'.encode(),
               f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'endstream',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    if image:
        objects.append(b'<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x00\nendstream')
    result, offsets = b'%PDF-1.4\n', [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
    start = len(result)
    result += f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()
    result += b''.join(f'{o:010d} 00000 n \n'.encode() for o in offsets[1:])
    result += f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF'.encode()
    Path(path).write_bytes(result)


class ExtractionTests(unittest.TestCase):
    def test_tax_and_discount_columns_remain_distinct(self):
        rows = fallback_parse('Description  Qty  Unit price  Discount %  Discount amount  Taxable amount  CGST  SGST  IGST  Line total\nPens  2  100  5  10  190  9.50  9.50  -  209')['items']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['discount'], 5)
        self.assertEqual(rows[0]['discount_type'], 'PERCENT')
        self.assertEqual(rows[0]['discount_amount'], 10)
        self.assertEqual(rows[0]['taxable_amount'], 190)
        self.assertEqual(rows[0]['cgst'], 9.5)
        self.assertIsNone(rows[0]['igst'])
        self.assertIsNone(rows[0]['gst'])

    def test_component_tax_rates_are_not_rupee_amounts(self):
        result = fallback_parse('Description  Qty  Rate  CGST %  SGST %  Amount\nPens  2  100  9  9  236')
        self.assertIsNone(result['items'][0]['cgst'])
        self.assertIsNone(result['items'][0]['sgst'])
        self.assertTrue(result['warnings'])

    def test_existing_coordinate_table(self):
        result = extract_invoice(str(Path(__file__).parents[2] / 'ideal_invoice.pdf'))
        self.assertEqual(len(result['items']), 10)
        self.assertEqual(result['items'][0]['description'], 'A4 Copy Paper Box')
        self.assertEqual(result['items'][0]['quantity'], 15)
        self.assertEqual(result['items'][0]['unit_price'], 300)
        self.assertIsNone(result['items'][0]['unit'])
        self.assertIsNone(result['supplier'])
        self.assertEqual(result['invoice_number'], 'INV-98234')

    def test_template_with_real_pdf(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'abc.pdf')
            pdf_file(path, [(50, 740, 'ABC Supplier INVOICE'), (50, 720, 'Invoice Number: INV-2026-42'),
                           (50, 700, 'Date: 2026-10-08'), (50, 670, 'Product  Qty  Unit  Price  Total'),
                           (50, 650, 'Apple  5  BOX  100  500'), (50, 620, 'Total: 500')])
            result = extract_invoice(path)
            self.assertEqual(result['source'], 'invoice2data')
            self.assertEqual(result['items'][0]['quantity'], 5)
            self.assertEqual(result['items'][0]['unit_price'], 100)
            self.assertEqual(result['supplier'], 'ABC Supplier')

    def test_greedy_quantity_regression(self):
        result = fallback_parse('Description  Qty  Rate  Amount\nApple  5  100  500\nTotal  500')
        self.assertEqual(result['items'][0]['description'], 'Apple')
        self.assertEqual(result['items'][0]['quantity'], 5)
        self.assertEqual(result['items'][0]['unit_price'], 100)
        self.assertEqual(result['items'][0]['line_total'], 500)

    def test_metadata_and_columns(self):
        result = fallback_parse('Supplier: Acme Ltd\nSupplier GSTIN: 27ABCDE1234F1Z5\nInvoice No.: AB/2026/12\nDate: 2026-10-08\nSKU  Description  HSN  Qty  UOM  Rate  GST%  Discount%  Amount\nA-1  Blue Pens  9608  10  PCS  1,200.50  18  5  12,005.00')
        self.assertEqual(result['invoice_number'], 'AB/2026/12')
        self.assertEqual(result['supplier'], 'Acme Ltd')
        item = result['items'][0]
        self.assertEqual((item['sku'], item['hsn'], item['unit'], item['gst'], item['discount_type']), ('A-1', '9608', 'PIECE', 18, 'PERCENT'))
        self.assertEqual(item['unit_price'], 1200.50)

    def test_unknown_fields_are_not_invented(self):
        item = fallback_parse('Description  Qty\nApples  2')['items'][0]
        self.assertIsNone(item['unit_price'])
        self.assertIsNone(item['unit'])
        self.assertIsNone(normalize_date('03/04/2026'))
        self.assertEqual(normalize_date('23/04/2026'), '2026-04-23')
        self.assertIsNone(fallback_parse('Buyer GSTIN: 27ABCDE1234F1Z5')['supplier_gstin'])

    def test_empty_template_uses_generic(self):
        with patch('extractor.extract_data', return_value={'invoice_number': 'INV-1', 'lines': []}):
            result = extract_invoice(str(Path(__file__).parents[2] / 'ideal_invoice.pdf'))
            self.assertEqual(len(result['items']), 10)
            self.assertEqual(result['source'], 'generic_pdf_parser')

    def test_invalid_corrupt_blank_and_scanned(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'test.pdf')
            for data, code in [(b'not a PDF', 'INVALID_PDF'), (b'%PDF-1.4 broken', 'CORRUPT_PDF')]:
                Path(path).write_bytes(data)
                with self.assertRaises(ExtractionError) as caught:
                    local_text(path)
                self.assertEqual(caught.exception.code, code)
            for image, code in [(False, 'NO_TEXT'), (True, 'NO_TEXT')]:
                pdf_file(path, image=image)
                with patch('extractor.page_text', return_value=('', None)), self.assertRaises(ExtractionError) as caught:
                    local_text(path)
                self.assertEqual(caught.exception.code, code)

    def test_missing_invoice_number_and_combined_uom(self):
        result = fallback_parse('Invoice No.:\nDate: 2026-10-08\nItem Description  Qty  Rate\nPens  10 PCS  20')
        self.assertIsNone(result['invoice_number'])
        self.assertEqual(result['items'][0]['quantity'], 10)
        self.assertEqual(result['items'][0]['unit'], 'PIECE')

    def test_no_items_has_actionable_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, 'unknown.pdf')
            pdf_file(path, [(50, 700, 'Unfamiliar invoice with no recognizable table')])
            result = extract_invoice(path)
            self.assertEqual(result['items'], [])
            self.assertTrue(any('No reliable product rows' in w for w in result['warnings']))


if __name__ == '__main__':
    unittest.main()
