"""Drive the real CLI through a PTY; never uses the user's skill roots."""
import fcntl
import json
import os
import pty
import select
import struct
import subprocess
import sys
import termios
import time

request = json.loads(sys.stdin.read())
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
process = subprocess.Popen(request['argv'] + request.get('extra_args', []), stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
output = b''
sent = False
deadline = time.monotonic() + 12
while time.monotonic() < deadline:
    if select.select([master], [], [], 0.05)[0]:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        if not chunk:
            break
        output += chunk
    if not sent and b'Space' in output:
        if request.get('edit'):
            with open(request['edit']['path'], 'a') as file:
                file.write(request['edit']['text'])
        os.write(master, request['keys'].encode())
        sent = True
    if process.poll() is not None:
        break
if process.poll() is None:
    process.kill()
process.wait()
os.close(master)
print(json.dumps({'output': output.decode(errors='replace'), 'status': process.returncode, 'sent': sent}))
