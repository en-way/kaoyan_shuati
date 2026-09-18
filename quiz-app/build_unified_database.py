import os
import sys
import docx
import re
import json
import shutil

# Ensure UTF-8 output
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
DATA_DIR = os.path.join(BASE_DIR, "data")
QUESTIONS_JSON_PATH = os.path.join(DATA_DIR, "questions.json")

# Answer file candidates
ANSWERS_DOCX_PATH = os.path.join(DATA_DIR, "27肖秀荣1000题-答案册.docx")
if not os.path.exists(ANSWERS_DOCX_PATH):
    ANSWERS_DOCX_PATH = os.path.join(PARENT_DIR, "27肖秀荣1000题-答案册.docx")

def parse_answers_book(docx_path):
    print(f"Loading answer document: {docx_path}...")
    doc = docx.Document(docx_path)
    paras = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    print(f"Total non-empty paragraphs: {len(paras)}")

    ans_list = []
    cur_ans = None

    for p in paras:
        # Match lines like "1. 答案 A", "2. 答案 D [时政储备题]"
        m = re.match(r'^(\d+)\.\s*答案\s*([A-D]+)(?:\s*\[(.*?)\])?', p)
        if m:
            if cur_ans:
                ans_list.append(cur_ans)
            cur_ans = {
                'num': int(m.group(1)),
                'answer': m.group(2).strip(),
                'tag': m.group(3).strip() if m.group(3) else '',
                'source': '',
                'analysis': '',
                'tips': ''
            }
            continue

        if cur_ans:
            if p.startswith('【出处】'):
                cur_ans['source'] = p.replace('【出处】', '').strip()
            elif p.startswith('【简析】'):
                cur_ans['analysis'] = p.replace('【简析】', '').strip()
            elif p.startswith('【点拨】'):
                cur_ans['tips'] = p.replace('【点拨】', '').strip()
            elif cur_ans['tips']:
                cur_ans['tips'] += '\n' + p
            elif cur_ans['analysis']:
                cur_ans['analysis'] += '\n' + p

    if cur_ans:
        ans_list.append(cur_ans)

    print(f"Successfully extracted {len(ans_list)} answers with explanations!")
    return ans_list

def merge_database():
    # 1. Back up answers docx to quiz-app/data/ if not there
    target_docx_in_data = os.path.join(DATA_DIR, "27肖秀荣1000题-答案册.docx")
    if not os.path.exists(target_docx_in_data) and os.path.exists(ANSWERS_DOCX_PATH):
        shutil.copy2(ANSWERS_DOCX_PATH, target_docx_in_data)
        print("Copied answer docx to quiz-app/data/")

    # 2. Load existing questions
    with open(QUESTIONS_JSON_PATH, 'r', encoding='utf-8') as f:
        qdata = json.load(f)
    questions = qdata['questions']
    print(f"Existing questions count: {len(questions)}")

    # 3. Parse answers
    ans_list = parse_answers_book(ANSWERS_DOCX_PATH)

    if len(questions) != len(ans_list):
        print(f"Warning: question count ({len(questions)}) != answer count ({len(ans_list)})")

    # 4. Merge sequentially and verify question numbers
    mismatches = 0
    merged_questions = []

    for i in range(len(questions)):
        q = questions[i]
        a = ans_list[i] if i < len(ans_list) else None

        q_num = q['num']
        a_num = a['num'] if a else -1

        if q_num != a_num:
            mismatches += 1
            if mismatches <= 5:
                print(f"Mismatch at index {i}: Q#{q_num} ({q['part']} {q['chapter']} {q['type']}) != A#{a_num}")

        q_copy = dict(q)
        if a:
            q_copy['answer'] = a['answer']
            q_copy['tag'] = a['tag']
            q_copy['source'] = a['source']
            q_copy['analysis'] = a['analysis']
            q_copy['tips'] = a['tips']
        else:
            q_copy['answer'] = ''
            q_copy['tag'] = ''
            q_copy['source'] = ''
            q_copy['analysis'] = ''
            q_copy['tips'] = ''

        merged_questions.append(q_copy)

    print(f"Alignment verification completed. Total mismatches: {mismatches}")
    assert mismatches == 0, f"Expected 0 mismatches between questions and answers, got {mismatches}"

    # 5. Save updated questions.json
    qdata['questions'] = merged_questions
    with open(QUESTIONS_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(qdata, f, ensure_ascii=False, indent=2)

    print(f"Successfully saved merged database to {QUESTIONS_JSON_PATH}")
    print(f"File size: {os.path.getsize(QUESTIONS_JSON_PATH) / 1024:.1f} KB")

    # 6. Pre-populate user_data.json standard_answers
    user_data_path = os.path.join(DATA_DIR, "user_data.json")
    user_data = {"answers": {}, "standard_answers": {}, "mistakes": {}, "chapter_stats": {}}
    if os.path.exists(user_data_path):
        try:
            with open(user_data_path, 'r', encoding='utf-8') as f:
                user_data = json.load(f)
        except Exception:
            pass

    for q in merged_questions:
        user_data['standard_answers'][q['id']] = q['answer']

    with open(user_data_path, 'w', encoding='utf-8') as f:
        json.dump(user_data, f, ensure_ascii=False, indent=2)
    print("Pre-populated standard_answers in user_data.json successfully!")

if __name__ == '__main__':
    merge_database()
