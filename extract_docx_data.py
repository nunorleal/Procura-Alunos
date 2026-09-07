#!/usr/bin/env python3
import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

SOURCE_DOCX = Path("/Users/nunoleal/Desktop/Lista ALunos e Horários 2026.docx")
SCHOOL_YEAR = "2025/2026"
SUPPLEMENTAL_PDFS = [
    Path(
        "/Users/nunoleal/Library/Mobile Documents/com~apple~CloudDocs/Escola/Ano Letivo 2025-2026/Util/Listas e Fotografias Turmas/2C_RELACAO_EB058b.pdf"
    )
]
OUTPUT_JS = Path(__file__).with_name("app-data.js")

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
DAYS = {
    "Segunda-feira": 1,
    "Terça-feira": 2,
    "Quarta-feira": 3,
    "Quinta-feira": 4,
    "Sexta-feira": 5,
}


def text_from(element):
    return "".join(t.text or "" for t in element.findall(".//w:t", NS)).strip()


def normalize_key(value):
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def class_key_from_student_heading(heading):
    match = re.match(r"^Turma\s+(\d+)\.º\s*-?\s*([A-Z])$", heading)
    if not match:
        return None
    return f"{match.group(1)}{match.group(2)}"


def class_key_from_schedule_heading(heading):
    match = re.match(r"^(\d+)\.º Ano - Turma ([A-Z])$", heading)
    if not match:
        return None
    return f"{match.group(1)}{match.group(2)}"


def display_class_from_key(key):
    return f"{key[:-1]}.º {key[-1]}"


def split_activity(raw):
    raw = raw.strip()
    if " — " in raw:
        subject, room_text = raw.split(" — ", 1)
        room_text = room_text.strip().rstrip(".")
        room_text = room_text.strip("()")
        if "sem sala fixa" in room_text.lower():
            return subject.strip(" ."), ""
        room = re.sub(r"^Sala\s+", "", room_text, flags=re.IGNORECASE).strip()
        return subject.strip(" ."), room

    room = ""
    match = re.search(r"\(([^()]*)\)\s*$", raw)
    if match:
        room = match.group(1).strip()
        raw = raw[: match.start()].strip()
    subject = raw.strip(" .")
    return subject, room


def parse_time(value):
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)


def read_paragraphs(docx_path):
    with ZipFile(docx_path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    return [
        text_from(paragraph)
        for paragraph in root.findall(".//w:body/w:p", NS)
        if text_from(paragraph)
    ]


def parse_students(paragraphs):
    students = []
    current_class = None
    student_re = re.compile(r"^(\d+)\s*-\s*(.+?)\s*[–-]\s*(\d+)$")

    for paragraph in paragraphs:
        if paragraph.startswith("Turma "):
            current_class = class_key_from_student_heading(paragraph)
            continue

        match = student_re.match(paragraph)
        if not match or not current_class:
            continue

        number, name, process = match.groups()
        students.append(
            {
                "id": f"{current_class}-{number}",
                "name": name.strip(),
                "searchName": normalize_key(name),
                "classKey": current_class,
                "className": display_class_from_key(current_class),
                "number": int(number),
                "process": process,
            }
        )

    return students


def parse_schedules(paragraphs):
    schedules = {}
    current_class = None
    current_day = None
    lesson_re = re.compile(r"^(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2}):\s*(.+)$")

    for paragraph in paragraphs:
        class_key = class_key_from_schedule_heading(paragraph)
        if class_key:
            current_class = class_key
            schedules.setdefault(current_class, {str(day): [] for day in range(1, 6)})
            current_day = None
            continue

        if paragraph in DAYS:
            current_day = DAYS[paragraph]
            continue

        match = lesson_re.match(paragraph)
        if not match or not current_class or not current_day:
            continue

        start, end, activity = match.groups()
        subject, room = split_activity(activity)
        schedules[current_class][str(current_day)].append(
            {
                "start": start,
                "end": end,
                "startMinutes": parse_time(start),
                "endMinutes": parse_time(end),
                "subject": subject,
                "room": room,
                "raw": activity.strip(),
            }
        )

    return schedules


def class_key_from_pdf_text(text):
    match = re.search(r"\n([5-9])º - ([A-Z])\n", text)
    if not match:
        return None
    return f"{match.group(1)}{match.group(2)}"


def parse_pdf_students(pdf_path):
    try:
        from pypdf import PdfReader
    except ImportError:
        print(f"Skipping {pdf_path}: install pypdf to read supplemental PDFs.")
        return []

    students = []
    reader = PdfReader(str(pdf_path))
    date_re = re.compile(r"^\d{2}-\d{2}-\d{4}$")
    ignore_between_date_and_name = {"X", "A", "B", "C", "--"}

    for page in reader.pages:
        text = page.extract_text() or ""
        class_key = class_key_from_pdf_text(text)
        if not class_key:
            continue

        lines = [line.strip() for line in text.splitlines() if line.strip()]
        i = 0
        while i < len(lines):
            if not (lines[i] == class_key[:-1] and i + 5 < len(lines)):
                i += 1
                continue

            process = lines[i + 3]
            birth_date = lines[i + 5]
            if not (process.isdigit() and len(process) == 4 and date_re.match(birth_date)):
                i += 1
                continue

            j = i + 6
            while j < len(lines) and lines[j] in ignore_between_date_and_name:
                j += 1
            if j + 1 >= len(lines) or not lines[j + 1].isdigit():
                i += 1
                continue

            name = lines[j]
            number = int(lines[j + 1])
            students.append(
                {
                    "id": f"{class_key}-{number}",
                    "name": name.strip(),
                    "searchName": normalize_key(name),
                    "classKey": class_key,
                    "className": display_class_from_key(class_key),
                    "number": number,
                    "process": process,
                }
            )
            i = j + 2

    return students


def merge_supplemental_students(students):
    seen = {(student["classKey"], student["number"]) for student in students}
    added = []

    for pdf_path in SUPPLEMENTAL_PDFS:
        if not pdf_path.exists():
            print(f"Skipping missing supplemental PDF: {pdf_path}")
            continue
        for student in parse_pdf_students(pdf_path):
            key = (student["classKey"], student["number"])
            if key in seen:
                continue
            students.append(student)
            seen.add(key)
            added.append(student)

    return added


def main():
    paragraphs = read_paragraphs(SOURCE_DOCX)
    first_schedule = next(
        i for i, paragraph in enumerate(paragraphs) if class_key_from_schedule_heading(paragraph)
    )
    students = parse_students(paragraphs[:first_schedule])
    added = merge_supplemental_students(students)
    schedules = parse_schedules(paragraphs[first_schedule:])
    classes = sorted(
        {
            student["classKey"]: student["className"]
            for student in students
        }.items(),
        key=lambda item: (int(item[0][:-1]), item[0][-1]),
    )

    year_payload = {
        "source": str(SOURCE_DOCX),
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "students": students,
        "classes": [{"key": key, "name": name} for key, name in classes],
        "schedules": schedules,
    }
    payload = {
        "activeYear": SCHOOL_YEAR,
        "years": {
            SCHOOL_YEAR: year_payload,
        },
    }
    OUTPUT_JS.write_text(
        "window.SCHOOL_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_JS} with {len(students)} students and {len(schedules)} schedules.")
    if added:
        added_classes = sorted({student["className"] for student in added})
        print(f"Added {len(added)} supplemental students from PDFs: {', '.join(added_classes)}.")


if __name__ == "__main__":
    main()
