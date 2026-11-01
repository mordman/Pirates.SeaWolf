#!/usr/bin/env python3
"""Brute-force snappy stream scanner for SST values + marker search."""
import sys, os, re

def snappy_decode(buf, pos, max_out=80_000_000):
    length = 0; shift = 0
    while True:
        if pos >= len(buf): return None
        b = buf[pos]; pos += 1
        length |= (b & 0x7f) << shift
        if not b & 0x80: break
        shift += 7
        if shift > 28: return None
    if length == 0 or length > max_out: return None
    out = bytearray()
    n = len(buf)
    while len(out) < length:
        if pos >= n: return None
        tag = buf[pos]; pos += 1
        t = tag & 3
        if t == 0:
            ln = tag >> 2
            if ln < 60:
                ln += 1
            elif ln == 60:
                if pos + 1 > n: return None
                ln = buf[pos] + 1; pos += 1
            elif ln == 61:
                if pos + 2 > n: return None
                ln = int.from_bytes(buf[pos:pos+2], 'little') + 1; pos += 2
            elif ln == 62:
                if pos + 3 > n: return None
                ln = int.from_bytes(buf[pos:pos+3], 'little') + 1; pos += 3
            else:
                if pos + 4 > n: return None
                ln = int.from_bytes(buf[pos:pos+4], 'little') + 1; pos += 4
            if pos + ln > n: return None
            out += buf[pos:pos+ln]; pos += ln
        else:
            if t == 1:
                if pos >= n: return None
                ln = 4 + ((tag >> 2) & 7)
                off = ((tag >> 5) << 8) | buf[pos]; pos += 1
            elif t == 2:
                if pos + 2 > n: return None
                ln = (tag >> 2) + 1
                off = int.from_bytes(buf[pos:pos+2], 'little'); pos += 2
            else:
                if pos + 4 > n: return None
                ln = (tag >> 2) + 1
                off = int.from_bytes(buf[pos:pos+4], 'little'); pos += 4
            if off == 0 or off > len(out): return None
            start = len(out) - off
            if off >= ln:
                out += out[start:start+ln]
            else:
                for i in range(ln):
                    out.append(out[start+i])
    if len(out) != length: return None
    return bytes(out), pos

def scan_window(buf, marker_pos, window=400_000, need=b''):
    """Scan backwards from marker_pos for a valid snappy stream whose output contains need."""
    lo = max(0, marker_pos - window)
    found = []
    for start in range(marker_pos - 1, lo - 1, -1):
        r = snappy_decode(buf, start)
        if r is None: continue
        out, end = r
        if marker_pos <= end and (not need or need in out):
            found.append((start, end, out))
            print(f'  HIT start={start} end={end} out={len(out)}B')
            return found
    return found

def main():
    sst_dir = sys.argv[1]
    markers = [m.encode() for m in sys.argv[2].split('|')]
    out_dir = sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)
    for fn in sorted(os.listdir(sst_dir)):
        if not fn.endswith('.sst'): continue
        path = os.path.join(sst_dir, fn)
        buf = open(path, 'rb').read()
        for mk in markers:
            positions = [m.start() for m in re.finditer(re.escape(mk), buf)]
            if positions:
                print(f'{fn}: marker {mk!r} x{len(positions)} at {positions[:5]}')
                for p in positions[:3]:
                    hits = scan_window(buf, p, need=mk)
                    for i, (s, e, out) in enumerate(hits):
                        ofn = os.path.join(out_dir, f'{fn}.{p}.{s}.decomp')
                        open(ofn, 'wb').write(out)
                        print(f'    saved {ofn} ({len(out)}B)')

if __name__ == '__main__':
    main()
