import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFont
from extractor import ExtractionError, extract_invoice, fallback_parse, local_text, number, ocr_table_text
from local_ocr import OCRError, grid_text, recognize, table_grid, tesseract_binary
from test_extractor import pdf_file


def has_tesseract():
    try:
        tesseract_binary()
        return True
    except OCRError:
        return False


class OCRTests(unittest.TestCase):
    def test_grid_preserves_missing_cells_and_wrapped_description(self):
        def word(text, x, y):
            return dict(text=text, left=x, top=y, width=40, height=10)
        rows = grid_text([word('Long', 20, 20), word('name', 20, 40), word('12', 220, 30)],
                         [[0, 1], [100, 101], [200, 201], [300, 301]], [[0, 1], [60, 61]])
        self.assertEqual(rows, [['Long name', '-', '12']])

    def test_table_header_recognition_and_uncertain_quantity(self):
        table = [['#', 'Item name', 'HSN/ SAC', 'Quantity', 'Unit', 'Price/ Unit', 'GST', 'Amount'],
                 ['1', 'Wrapped name', '21069099', '-', '-', '338.87', '3,578.47 (12%)', '33,399.03']]
        row = fallback_parse(ocr_table_text(table), allow_missing_quantity=True)['items'][0]
        self.assertEqual(row['unit_price'], 338.87)
        self.assertEqual(row['gst'], 12)
        self.assertIsNone(row['quantity'])
        self.assertIsNone(row['unit'])

    def test_money_with_missing_decimal_is_not_multiplied_by_100(self):
        self.assertIsNone(number('847,17'))
        self.assertEqual(number('1,00,000.50'), 100000.50)
        table = [['Description', 'Quantity', 'Price/ Unit', 'Amount'],
                 ['Pens', '2', '10.00', '20.00'], ['Boxes', '3', '15.00', '45.00'],
                 ['Paper', '4', '1200', '4800']]
        rows = fallback_parse(ocr_table_text(table), allow_missing_quantity=True)['items']
        self.assertIsNone(rows[2]['unit_price'])
        self.assertIsNone(rows[2]['line_total'])

    def test_grid_excludes_invoice_heading(self):
        image = Image.new('L', (1000, 900), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((50, 20, 950, 150), outline=0, width=2)
        for x in [50, 150, 550, 750, 950]:
            draw.line((x, 250, x, 850), fill=0, width=2)
        for y in range(250, 851, 100):
            draw.line((50, y, 950, y), fill=0, width=2)
        xs, ys = table_grid(image)
        self.assertEqual(len(xs), 5)
        self.assertEqual(len(ys), 7)
        self.assertEqual(ys[0][0], 250)

    def test_missing_engine_is_actionable(self):
        with patch.dict(os.environ, {'TESSERACT_CMD': '/missing/tesseract'}):
            with self.assertRaises(OCRError) as caught:
                tesseract_binary()
        self.assertEqual(caught.exception.code, 'OCR_UNAVAILABLE')

    def test_timeout_and_engine_failure(self):
        with tempfile.TemporaryDirectory() as folder, patch('local_ocr.tesseract_binary', return_value='/fake/tesseract'):
            for outcome, code in [(subprocess.TimeoutExpired('tesseract', 1), 'OCR_TIMEOUT'),
                                  (subprocess.CompletedProcess([], 1, '', 'missing eng data'), 'OCR_FAILED')]:
                with patch('local_ocr.subprocess.run', side_effect=outcome if isinstance(outcome, Exception) else None, return_value=outcome):
                    with self.assertRaises(OCRError) as caught:
                        recognize(Image.new('L', (50, 50), 255), folder, 'test', 6)
                    self.assertEqual(caught.exception.code, code)

    def test_text_pdfs_do_not_require_ocr(self):
        with tempfile.TemporaryDirectory() as folder, patch('extractor.page_text', side_effect=AssertionError('OCR should not run')):
            path = str(Path(folder, 'text.pdf'))
            pdf_file(path, [(50, 700, 'Description  Qty  Rate'), (50, 680, 'Pens  2  10')])
            self.assertFalse(local_text(path).ocr_used)

    def test_missing_ocr_is_reported_for_scan(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'TESSERACT_CMD': '/missing/tesseract'}):
            path = str(Path(folder, 'scan.pdf'))
            pdf_file(path, image=True)
            with self.assertRaises(ExtractionError) as caught:
                local_text(path)
            self.assertEqual(caught.exception.code, 'OCR_UNAVAILABLE')

    @unittest.skipUnless(has_tesseract(), 'local Tesseract not installed')
    def test_real_raster_pdf(self):
        image = Image.new('RGB', (1800, 1300), 'white')
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=30)
        draw.text((60, 60), 'Supplier: Test Supplier', font=font, fill='black')
        draw.text((60, 120), 'Invoice Number: SCAN-123', font=font, fill='black')
        xs, ys = [60, 880, 1130, 1400, 1740], [250, 400, 600, 800, 1000, 1200]
        for x in xs:
            draw.line((x, ys[0], x, ys[-1]), fill='black', width=3)
        for y in ys:
            draw.line((xs[0], y, xs[-1], y), fill='black', width=3)
        rows = [['Description', 'Quantity', 'Unit price', 'Amount'], ['Blue Pens', '2', '10.00', '20.00'],
                ['Office Paper', '3', '15.00', '45.00'], ['Small Boxes', '4', '12.00', '48.00'], ['Black Pens', '5', '10.00', '50.00']]
        for y, row in zip(ys, rows):
            for x, value in zip(xs, row):
                draw.text((x + 20, y + 40), value, font=font, fill='black')
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder, 'scan.pdf'))
            image.save(path, resolution=200)
            result = extract_invoice(path)
        self.assertEqual(result['source'], 'local_ocr')
        self.assertEqual(len(result['items']), 4)
        self.assertEqual(result['items'][0]['quantity'], 2)
        self.assertEqual(result['items'][0]['unit_price'], 10)
        self.assertTrue(any('local OCR' in warning for warning in result['warnings']))

    @unittest.skipUnless(os.environ.get('INVOICE_TEST_CURVED_SCAN'), 'optional private curved regression scan')
    def test_curved_purchase_invoice(self):
        result = extract_invoice(os.environ['INVOICE_TEST_CURVED_SCAN'])
        self.assertEqual(len(result['items']), 37)
        first, last = result['items'][0], result['items'][-1]
        self.assertIn('Chinese Pasta', first['description'])
        self.assertEqual(first['quantity'], 20)
        self.assertEqual(first['unit'], 'BOX')
        self.assertEqual(first['unit_price'], 256.99)
        self.assertEqual(first['discount_amount'], 152.5)
        self.assertEqual(first['line_total'], 4987.3)
        self.assertIsNone(first['gst'])
        self.assertIn('Masala Sev Mamra', last['description'])
        self.assertEqual(last['quantity'], 10)
        self.assertEqual(last['unit'], 'BAGS')
        self.assertEqual(last['line_total'], 5989.91)
        self.assertIsNone(result['items'][14]['quantity']) # OCR's 16 conflicts with printed amounts.
        self.assertIsNone(result['items'][29]['line_total']) # OCR's 41,988.07 conflicts with quantity/rate.
        self.assertIsNone(result['amount'])
        self.assertTrue(any('continuation' in warning for warning in result['warnings']))
        self.assertLess(result['diagnostics']['total_ms'], 35000)

    @unittest.skipUnless(os.environ.get('INVOICE_TEST_SCAN'), 'optional private regression scan')
    def test_reported_invoice(self):
        result = extract_invoice(os.environ['INVOICE_TEST_SCAN'])
        self.assertEqual(result['source'], 'local_ocr')
        self.assertEqual(len(result['items']), 35)
        self.assertEqual(result['supplier'], 'Gopal Snacks Limited')
        self.assertEqual(result['invoice_date'], '2024-09-30')
        self.assertIsNone(result['invoice_number'])
        self.assertIn('KHATTA MEETHA', result['items'][10]['description'])
        self.assertIn('CORNOZ NACHOS', result['items'][23]['description'])
        self.assertIsNone(result['items'][14]['unit'])
        self.assertEqual(result['items'][13]['unit_price'], 837.21)


if __name__ == '__main__':
    unittest.main()
