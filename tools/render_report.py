from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer


def main():
    root = Path(__file__).resolve().parents[1]
    fonts = Path("C:/Windows/Fonts")
    pdfmetrics.registerFont(TTFont("ReportText", str(fonts / "msyh.ttc")))
    pdfmetrics.registerFont(TTFont("ReportBold", str(fonts / "msyhbd.ttc")))
    body = ParagraphStyle("Body", fontName="ReportText", fontSize=10.5, leading=18,
                          wordWrap="CJK", alignment=TA_LEFT, spaceAfter=10, textColor=colors.HexColor("#232a32"))
    heading = ParagraphStyle("Heading", parent=body, fontName="ReportBold", fontSize=14,
                             leading=22, spaceBefore=12, spaceAfter=5, keepWithNext=True)
    title = ParagraphStyle("Title", parent=heading, fontSize=24, leading=36, spaceBefore=5)
    meta = ParagraphStyle("Meta", parent=body, fontSize=9, textColor=colors.HexColor("#59646e"))
    target = root / "artifacts" / "PixelHome-stage2-report-draft.pdf"
    target.parent.mkdir(exist_ok=True)
    doc = SimpleDocTemplate(str(target), pagesize=A4, leftMargin=53, rightMargin=53,
                            topMargin=53, bottomMargin=52, title="PixelHome 第二阶段项目报告底稿")
    items = []
    for line in (root / "STAGE2_REPORT_DRAFT.md").read_text(encoding="utf-8").splitlines():
        if line.startswith("# "):
            items.append(Paragraph(escape(line[2:]), title))
            items.append(Paragraph("本地联调版 | 实物与组内信息待补", meta))
            items.append(Spacer(1, 10))
        elif line.startswith("## "):
            if line[3:] == "验证结果与局限":
                items.append(PageBreak())
            items.append(Paragraph(escape(line[3:]), heading))
        elif line.strip():
            items.append(Paragraph(escape(line.replace("`", "")), body))

    def footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#d3d8de"))
        canvas.line(53, 40, A4[0] - 53, 40)
        canvas.setFont("ReportText", 9)
        canvas.setFillColor(colors.HexColor("#59646e"))
        canvas.drawString(53, 25, "PixelHome  |  Design and Build")
        canvas.drawRightString(A4[0] - 53, 25, str(document.page))
        canvas.restoreState()

    doc.build(items, onFirstPage=footer, onLaterPages=footer)
    print(target)


if __name__ == "__main__":
    main()
