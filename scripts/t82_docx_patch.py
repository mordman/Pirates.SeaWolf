#!/usr/bin/env python3
# Task 82: пост-обработка отчёта docx (совместимость Word/WPS):
#  1) футер «PAGE» → «PAGE \* arabic \* MERGEFORMAT» (fmt из pgNumType
#     WPS игнорирует);
#  2) удалить пустые <w:pgNumType/> из document.xml (обложка/секции
#     без нумерации).
# Запуск: python3 scripts/t82_docx_patch.py <файл.docx>
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

path = Path(sys.argv[1])
tmp = Path(tempfile.mkdtemp())
with zipfile.ZipFile(path) as z:
    z.extractall(tmp)

changed = []
# 1) футеры: голый PAGE → арабский формат
for f in sorted((tmp / "word").glob("footer*.xml")):
    xml = f.read_text(encoding="utf-8")
    new = re.sub(
        r"(<w:instrText[^>]*>)\s*PAGE\s*(</w:instrText>)",
        r"\1 PAGE \\* arabic \\* MERGEFORMAT \2",
        xml,
    )
    if new != xml:
        f.write_text(new, encoding="utf-8")
        changed.append(f.name + ": PAGE → arabic")

# 2) пустые pgNumType
docxml = tmp / "word" / "document.xml"
xml = docxml.read_text(encoding="utf-8")
new = xml.replace("<w:pgNumType/>", "")
if new != xml:
    docxml.write_text(new, encoding="utf-8")
    changed.append("document.xml: пустые pgNumType удалены")

out = Path(str(path) + ".tmp")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(tmp.rglob("*")):
        if f.is_file():
            z.write(f, f.relative_to(tmp))
shutil.move(out, path)
shutil.rmtree(tmp)
print("OK:", "; ".join(changed) if changed else "правок не потребовалось")
