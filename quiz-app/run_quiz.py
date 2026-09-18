import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

import socket
import webbrowser
import threading
import time
from server import run_server

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def is_port_available(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) != 0

def find_available_port(start_port=8000):
    for p in range(start_port, start_port + 20):
        if is_port_available(p):
            return p
    return start_port

def open_browser_delayed(url):
    time.sleep(1.2)
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"Could not open browser automatically: {e}")

if __name__ == '__main__':
    port = find_available_port(8000)
    lan_ip = get_lan_ip()
    local_url = f"http://localhost:{port}"
    lan_url = f"http://{lan_ip}:{port}"

    print("\n" + "=" * 62)
    print("  📚 2027 考研政治 1000 题 · 沉浸式做题软件已启动！")
    print("=" * 62)
    print(f"  👉 电脑浏览器访问:   {local_url}")
    print(f"  📱 iPad / 手机扫码访问: {lan_url}")
    print("=" * 62)
    print("  💡 提示：按 Ctrl+C 可退出服务。正在自动为你打开浏览器...\n")

    # Start browser opener in background thread
    threading.Thread(target=open_browser_delayed, args=(local_url,), daemon=True).start()

    # Run HTTP Server
    run_server(port)
