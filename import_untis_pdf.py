"""Extract Untis timetable cells using their PDF geometry, including split cells."""
import argparse
import json
import re
from pathlib import Path

import pdfplumber


SUBJECTS = {
    'MAT': 'Matemática', 'PORT': 'Português', 'POR': 'Português',
    'ING-I': 'Inglês', 'ESP-I': 'Espanhol', 'ESP-': 'Espanhol',
    'FRA-I': 'Francês', 'FRA-': 'Francês', 'CN': 'Ciências Naturais',
    'FQ': 'Ciências Físico-Químicas', 'HGP': 'História e Geografia de Portugal',
    'HIST': 'História', 'GEO': 'Geografia', 'EDF': 'Educação Física',
    'EV': 'Educação Visual', 'EDM': 'Educação Musical',
    'EA': 'Expressões Artísticas', 'ART': 'Ateliarte', 'CID': 'Cidadania',
    'TIC': 'Tecnologias da Informação e Comunicação',
    'DTAA': 'DT Atendimento a Alunos', 'OC': 'Oficina do Conhecimento',
    'ATM': 'Apoio Tutorial Multidisciplinar',
    'EMR': 'Educação Moral Religiosa Católica',
    'INT': 'Interpretação', 'IMP': 'Improvisação', 'VOZ': 'Voz',
    'TPT': 'Técnicas de Produção Teatral',
    'PLNM': 'Português Língua Não Materna',
    'PPF_': 'Preparação de Provas Finais', 'ALMOÇO': 'ALMOÇO',
}
ROOM = re.compile(r'(?:[SG]\d+|BE|Dram|MediaLab|GAB_PLNM|CAF)')


def minutes(value):
    h, m = map(int, value.split(':'))
    return h * 60 + m


def extract(path):
    schedules = {}
    report = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            assert '2026/2027' in text
            match = re.search(r'([5-9])º\s*([A-F])', text)
            assert match, page.page_number
            key = ''.join(match.groups())
            assert key not in schedules
            words = page.extract_words(x_tolerance=1, y_tolerance=2)
            # The time-column backgrounds define the eleven teaching periods.
            time_rects = {round(r['top'], 2): r for r in page.rects
                          if 22 < r['x0'] < 24 and 44 < r['width'] < 47
                          and 30 < r['height'] < 40 and r['top'] > 90}
            time_rects = [time_rects[y] for y in sorted(time_rects)]
            assert len(time_rects) == 11, (key, len(time_rects))
            slots = []
            for rect in time_rects:
                times = [w['text'] for w in words if w['x0'] < 69
                         and rect['top'] < w['top'] < rect['bottom']
                         and re.fullmatch(r'\d{1,2}:\d{2}', w['text'])]
                assert len(times) == 2, (key, times)
                slots.append(tuple(f'{int(t.split(":")[0]):02}:{t.split(":")[1]}' for t in times))
            boundaries = [r['top'] for r in time_rects] + [time_rects[-1]['bottom']]
            heads = [w for w in words if w['text'] in ('Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta')]
            assert len(heads) == 5
            centers = [(w['x0'] + w['x1']) / 2 for w in heads]
            cells = []
            for rect in page.rects:
                if not (69 < rect['x0'] < rect['x1'] < 380 and 20 < rect['width'] < 65):
                    continue
                start = min(range(12), key=lambda i: abs(boundaries[i] - rect['top']))
                end = min(range(12), key=lambda i: abs(boundaries[i] - rect['bottom']))
                if end <= start or abs(boundaries[start] - rect['top']) > 1 or abs(boundaries[end] - rect['bottom']) > 1:
                    continue
                cells.append((rect, start, end))
            assert cells
            periods = {str(d): [[] for _ in slots] for d in range(1, 6)}
            consumed = set()
            for rect, start, end in cells:
                day = str(min(range(5), key=lambda d: abs(centers[d] - (rect['x0'] + rect['x1']) / 2)) + 1)
                tokens = []
                for i, word in enumerate(words):
                    cx, cy = (word['x0'] + word['x1']) / 2, (word['top'] + word['bottom']) / 2
                    if rect['x0'] <= cx <= rect['x1'] and rect['top'] <= cy <= rect['bottom']:
                        tokens.append(word['text'])
                        consumed.add(i)
                options = []
                for token in tokens:
                    code = token.lstrip('.*')
                    if code in SUBJECTS:
                        options.append({'subject': SUBJECTS[code], 'room': 'Sem sala', 'code': code})
                    elif ROOM.fullmatch(token):
                        assert options and options[-1]['room'] == 'Sem sala', (key, tokens)
                        options[-1]['room'] = token
                    else:
                        raise ValueError((key, 'Unrecognized cell text', tokens, token))
                assert options, (key, rect)
                for slot in range(start, end):
                    for option in options:
                        if option not in periods[day][slot]:
                            periods[day][slot].append(option)
            # No text inside the timetable may be silently dropped.
            unassigned = [w['text'] for i, w in enumerate(words)
                          if 70 < (w['x0'] + w['x1']) / 2 < 379
                          and boundaries[0] < (w['top'] + w['bottom']) / 2 < boundaries[-1]
                          and i not in consumed]
            assert not unassigned, (key, unassigned)
            schedules[key] = {}
            for day, entries in periods.items():
                lessons = []
                for (start, end), options in zip(slots, entries):
                    if not options:
                        continue
                    if lessons and lessons[-1]['end'] == start and lessons[-1]['options'] == options:
                        lessons[-1]['end'] = end
                        lessons[-1]['endMinutes'] = minutes(end)
                    else:
                        lessons.append({'start': start, 'end': end,
                                        'startMinutes': minutes(start), 'endMinutes': minutes(end),
                                        'subject': ' / '.join(dict.fromkeys(o['subject'] for o in options)),
                                        'room': options[0]['room'] if len(options) == 1 else '',
                                        'options': options})
                schedules[key][day] = lessons
            report.append({'class': key, 'page': page.page_number, 'cells': len(cells),
                           'lessons': sum(map(len, schedules[key].values()))})
    return schedules, report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    schedules, report = extract(args.pdf)
    args.output.write_text(json.dumps({'schedules': schedules, 'report': report}, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))
