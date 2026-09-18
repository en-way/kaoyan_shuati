import os
import sys

# Ensure UTF-8 output encoding on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

import json
import re
import socket
import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
STATIC_DIR = os.path.join(BASE_DIR, "static")
QUESTIONS_FILE = os.path.join(DATA_DIR, "questions.json")
USER_DATA_FILE = os.path.join(DATA_DIR, "user_data.json")

# Ensure user data file exists
def get_user_data():
    if not os.path.exists(USER_DATA_FILE):
        data = {
            "answers": {},
            "standard_answers": {},
            "mistakes": {},
            "chapter_stats": {}
        }
        save_user_data(data)
        return data
    try:
        with open(USER_DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading user data: {e}")
        return {"answers": {}, "standard_answers": {}, "mistakes": {}, "chapter_stats": {}}

def save_user_data(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    temp_file = USER_DATA_FILE + ".tmp"
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(temp_file, USER_DATA_FILE)

# Load questions once
def load_questions():
    print("Loading questions database...")
    with open(QUESTIONS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    qmap = {q['id']: q for q in data['questions']}
    print(f"Loaded {len(qmap)} questions with full explanations.")
    return data, qmap

QUESTIONS_DATA, QUESTIONS_MAP = load_questions()


class QuizServerHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def send_json(self, status_code, data):
        response_bytes = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path == '/api/overview':
            user_data = get_user_data()
            answers = user_data.get('answers', {})
            mistakes = user_data.get('mistakes', {})

            overview = []
            for part_name, chapters in QUESTIONS_DATA['subjects_tree'].items():
                subject_info = {
                    'name': part_name,
                    'total': 0,
                    'answered': 0,
                    'correct': 0,
                    'mistakes': 0,
                    'accuracy': 0,
                    'chapters': []
                }
                for ch_name, types_cnt in chapters.items():
                    ch_total = types_cnt['单项选择题'] + types_cnt['多项选择题']
                    ch_q_ids = [q['id'] for q in QUESTIONS_DATA['questions'] if q['part'] == part_name and q['chapter'] == ch_name]
                    
                    ch_answered = sum(1 for qid in ch_q_ids if qid in answers and answers[qid].get('selected'))
                    ch_correct = sum(1 for qid in ch_q_ids if qid in answers and answers[qid].get('is_correct') is True)
                    ch_mistakes = sum(1 for qid in ch_q_ids if qid in mistakes and not mistakes[qid].get('mastered', False))
                    
                    ch_accuracy = round((ch_correct / ch_answered * 100), 1) if ch_answered > 0 else 0

                    ch_obj = {
                        'name': ch_name,
                        'total': ch_total,
                        'single_count': types_cnt['单项选择题'],
                        'multi_count': types_cnt['多项选择题'],
                        'answered': ch_answered,
                        'correct': ch_correct,
                        'mistakes': ch_mistakes,
                        'accuracy': ch_accuracy,
                        'has_std_answers': True  # All questions have official answers now!
                    }
                    subject_info['chapters'].append(ch_obj)
                    subject_info['total'] += ch_total
                    subject_info['answered'] += ch_answered
                    subject_info['correct'] += ch_correct
                    subject_info['mistakes'] += ch_mistakes

                total_graded = subject_info['answered']
                subject_info['accuracy'] = round((subject_info['correct'] / total_graded * 100), 1) if total_graded > 0 else 0
                overview.append(subject_info)

            total_mistakes = sum(1 for m in mistakes.values() if not m.get('mastered', False))
            total_answered = sum(1 for a in answers.values() if a.get('selected'))
            total_correct = sum(1 for a in answers.values() if a.get('is_correct') is True)
            overall_accuracy = round((total_correct / total_answered * 100), 1) if total_answered > 0 else 0

            self.send_json(200, {
                'total_questions': QUESTIONS_DATA['total'],
                'total_answered': total_answered,
                'total_correct': total_correct,
                'total_mistakes': total_mistakes,
                'overall_accuracy': overall_accuracy,
                'subjects': overview
            })
            return

        elif path == '/api/questions':
            part = params.get('part', [''])[0]
            chapter = params.get('chapter', [''])[0]
            q_type = params.get('type', [''])[0]
            mode = params.get('mode', ['instant'])[0]  # 'instant' | 'exam' | 'recite' | 'mistakes_only'

            user_data = get_user_data()
            answers = user_data.get('answers', {})
            mistakes = user_data.get('mistakes', {})

            matched = []
            for q in QUESTIONS_DATA['questions']:
                if part and q['part'] != part:
                    continue
                if chapter and q['chapter'] != chapter:
                    continue
                if q_type and q['type'] != q_type:
                    continue
                if mode == 'mistakes_only':
                    if q['id'] not in mistakes or mistakes[q['id']].get('mastered', False):
                        continue

                q_copy = dict(q)
                user_record = answers.get(q['id'])
                if user_record:
                    q_copy['user_selected'] = user_record.get('selected', [])
                    q_copy['user_time'] = user_record.get('time_spent', 0)
                    q_copy['is_flagged'] = user_record.get('is_flagged', False)
                    q_copy['is_correct'] = user_record.get('is_correct', None)
                else:
                    q_copy['user_selected'] = []
                    q_copy['user_time'] = 0
                    q_copy['is_flagged'] = False
                    q_copy['is_correct'] = None

                q_copy['in_mistakes'] = (q['id'] in mistakes and not mistakes[q['id']].get('mastered', False))

                # If in exam mode, keep official answers/explanations concealed until submitted
                if mode == 'exam' and q_copy['is_correct'] is None:
                    q_copy['answer'] = None
                    q_copy['source'] = None
                    q_copy['analysis'] = None
                    q_copy['tips'] = None
                    q_copy['tag'] = None

                matched.append(q_copy)

            self.send_json(200, {
                'count': len(matched),
                'part': part,
                'chapter': chapter,
                'type': q_type,
                'mode': mode,
                'questions': matched
            })
            return

        elif path == '/api/mistakes':
            part = params.get('part', [''])[0]
            chapter = params.get('chapter', [''])[0]

            user_data = get_user_data()
            mistakes = user_data.get('mistakes', {})
            answers = user_data.get('answers', {})

            mistake_list = []
            for qid, m_info in mistakes.items():
                if m_info.get('mastered', False):
                    continue
                q = QUESTIONS_MAP.get(qid)
                if not q:
                    continue
                if part and q['part'] != part:
                    continue
                if chapter and q['chapter'] != chapter:
                    continue

                item = dict(q)
                item['mistake_info'] = m_info
                item['user_selected'] = answers.get(qid, {}).get('selected', m_info.get('last_selected', []))
                mistake_list.append(item)

            mistake_list.sort(key=lambda x: x['id'])
            self.send_json(200, {
                'count': len(mistake_list),
                'mistakes': mistake_list
            })
            return

        # Serve static files
        if path == '/' or path == '/index.html':
            idx_path = os.path.join(BASE_DIR, 'index.html')
            if not os.path.exists(idx_path):
                idx_path = os.path.join(STATIC_DIR, 'index.html')
            self.serve_file(idx_path, 'text/html; charset=utf-8')
            return
        
        file_path = os.path.join(BASE_DIR, path.lstrip('/'))
        if not os.path.exists(file_path) or os.path.isdir(file_path):
            file_path = os.path.join(STATIC_DIR, path.lstrip('/'))

        if os.path.exists(file_path) and not os.path.isdir(file_path):
            content_type = 'text/plain'
            if file_path.endswith('.html'):
                content_type = 'text/html; charset=utf-8'
            elif file_path.endswith('.css'):
                content_type = 'text/css; charset=utf-8'
            elif file_path.endswith('.js'):
                content_type = 'application/javascript; charset=utf-8'
            elif file_path.endswith('.json'):
                content_type = 'application/json; charset=utf-8'
            elif file_path.endswith('.svg'):
                content_type = 'image/svg+xml'
            elif file_path.endswith('.png'):
                content_type = 'image/png'
            elif file_path.endswith('.ico'):
                content_type = 'image/x-icon'
            self.serve_file(file_path, content_type)
            return

        self.send_error(404, "Not Found")

    def serve_file(self, filepath, content_type):
        try:
            with open(filepath, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Error reading file: {e}")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            length = int(self.headers.get('Content-Length', 0))
            body_bytes = self.rfile.read(length)
            body = json.loads(body_bytes.decode('utf-8')) if body_bytes else {}
        except Exception as e:
            self.send_json(400, {'error': f'Invalid JSON payload: {e}'})
            return

        user_data = get_user_data()

        if path == '/api/save_answer':
            qid = body.get('question_id')
            if not qid or qid not in QUESTIONS_MAP:
                self.send_json(400, {'error': 'Question ID not found'})
                return

            q = QUESTIONS_MAP[qid]
            selected = sorted(body.get('selected', []))
            time_spent = body.get('time_spent', 0)
            is_flagged = body.get('is_flagged', False)
            eval_now = body.get('evaluate', True)

            user_str = ''.join(selected)
            std_ans = q.get('answer', '')
            is_correct = (user_str == std_ans) if (eval_now and user_str) else None

            if qid not in user_data['answers']:
                user_data['answers'][qid] = {}

            rec = user_data['answers'][qid]
            rec['selected'] = selected
            rec['time_spent'] = time_spent
            rec['is_flagged'] = is_flagged
            rec['is_correct'] = is_correct
            rec['updated_at'] = datetime.datetime.now().isoformat()

            # Automatic mistake handling
            if eval_now and user_str:
                if not is_correct:
                    if qid not in user_data['mistakes']:
                        user_data['mistakes'][qid] = {
                            'question_id': qid,
                            'wrong_count': 0,
                            'history': []
                        }
                    m = user_data['mistakes'][qid]
                    m['wrong_count'] += 1
                    m['last_selected'] = selected
                    m['standard_answer'] = std_ans
                    m['mastered'] = False
                    m['last_wrong_time'] = datetime.datetime.now().isoformat()
                elif is_correct and qid in user_data['mistakes']:
                    user_data['mistakes'][qid]['mastered'] = True

            save_user_data(user_data)

            self.send_json(200, {
                'success': True,
                'question_id': qid,
                'is_correct': is_correct,
                'standard_answer': std_ans,
                'source': q.get('source', ''),
                'analysis': q.get('analysis', ''),
                'tips': q.get('tips', ''),
                'tag': q.get('tag', '')
            })
            return

        elif path == '/api/submit_exam':
            part = body.get('part')
            chapter = body.get('chapter')
            if not part or not chapter:
                self.send_json(400, {'error': 'Missing part or chapter'})
                return

            ch_questions = [q for q in QUESTIONS_DATA['questions'] if q['part'] == part and q['chapter'] == chapter]
            
            results = []
            correct_cnt = 0
            wrong_cnt = 0
            unanswered_cnt = 0

            for q in ch_questions:
                qid = q['id']
                rec = user_data['answers'].get(qid, {})
                selected = rec.get('selected', [])
                user_str = ''.join(sorted(selected))
                std_ans = q.get('answer', '')

                if not user_str:
                    unanswered_cnt += 1
                    is_corr = False
                elif user_str == std_ans:
                    correct_cnt += 1
                    is_corr = True
                    rec['is_correct'] = True
                    if qid in user_data['mistakes']:
                        user_data['mistakes'][qid]['mastered'] = True
                else:
                    wrong_cnt += 1
                    is_corr = False
                    rec['is_correct'] = False
                    if qid not in user_data['mistakes']:
                        user_data['mistakes'][qid] = {
                            'question_id': qid,
                            'wrong_count': 0,
                            'history': []
                        }
                    m = user_data['mistakes'][qid]
                    m['wrong_count'] += 1
                    m['last_selected'] = selected
                    m['standard_answer'] = std_ans
                    m['mastered'] = False
                    m['last_wrong_time'] = datetime.datetime.now().isoformat()

                rec['is_correct'] = is_corr
                user_data['answers'][qid] = rec

                results.append({
                    'id': qid,
                    'num': q['num'],
                    'type': q['type'],
                    'stem': q['stem'],
                    'user_ans': user_str or '未作答',
                    'standard_ans': std_ans,
                    'is_correct': is_corr,
                    'source': q.get('source', ''),
                    'analysis': q.get('analysis', ''),
                    'tips': q.get('tips', ''),
                    'tag': q.get('tag', '')
                })

            save_user_data(user_data)
            total_graded = correct_cnt + wrong_cnt
            score_rate = round(correct_cnt / len(ch_questions) * 100, 1) if ch_questions else 0
            accuracy = round(correct_cnt / total_graded * 100, 1) if total_graded > 0 else 0

            self.send_json(200, {
                'success': True,
                'total': len(ch_questions),
                'correct_count': correct_cnt,
                'wrong_count': wrong_cnt,
                'unanswered_count': unanswered_cnt,
                'accuracy': accuracy,
                'score_rate': score_rate,
                'results': results
            })
            return

        elif path == '/api/toggle_flag':
            qid = body.get('question_id')
            if not qid:
                self.send_json(400, {'error': 'Missing question_id'})
                return
            if qid not in user_data['answers']:
                user_data['answers'][qid] = {'selected': [], 'time_spent': 0, 'is_flagged': True}
            else:
                user_data['answers'][qid]['is_flagged'] = not user_data['answers'][qid].get('is_flagged', False)
            save_user_data(user_data)
            self.send_json(200, {'is_flagged': user_data['answers'][qid]['is_flagged']})
            return

        elif path == '/api/mistake_action':
            qid = body.get('question_id')
            action = body.get('action')

            if qid in user_data.get('mistakes', {}):
                if action == 'remove':
                    del user_data['mistakes'][qid]
                elif action == 'master':
                    user_data['mistakes'][qid]['mastered'] = True
                elif action == 'unmaster':
                    user_data['mistakes'][qid]['mastered'] = False
                save_user_data(user_data)
                self.send_json(200, {'success': True})
                return
            self.send_json(404, {'error': 'Mistake record not found'})
            return

        elif path == '/api/reset_chapter':
            part = body.get('part')
            chapter = body.get('chapter')
            if not part or not chapter:
                self.send_json(400, {'error': 'Missing part or chapter'})
                return

            ch_q_ids = [q['id'] for q in QUESTIONS_DATA['questions'] if q['part'] == part and q['chapter'] == chapter]
            for qid in ch_q_ids:
                if qid in user_data['answers']:
                    del user_data['answers'][qid]
            save_user_data(user_data)
            self.send_json(200, {'success': True, 'cleared_count': len(ch_q_ids)})
            return

        self.send_error(404, "API endpoint not found")


def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def run_server(port=8000):
    server_address = ('0.0.0.0', port)
    httpd = HTTPServer(server_address, QuizServerHandler)
    lan_ip = get_lan_ip()
    print("=" * 60)
    print("🚀 考研政治 1000 题 · 沉浸式做题软件（全量官方解析版） 服务已启动！")
    print(f"👉 本地电脑访问: http://localhost:{port}")
    print(f"👉 iPad/手机同局域网访问: http://{lan_ip}:{port}")
    print("=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已平稳关闭。")
        httpd.server_close()


if __name__ == '__main__':
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run_server(port)
