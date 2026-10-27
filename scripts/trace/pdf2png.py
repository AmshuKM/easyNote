# Usage: python pdf2png.py in.pdf out.png  (page 0, scaled to 2000 px wide)
import sys, pymupdf
page = pymupdf.open(sys.argv[1])[0]
page.get_pixmap(matrix=pymupdf.Matrix(2000 / page.rect.width, 2000 / page.rect.width)).save(sys.argv[2])
