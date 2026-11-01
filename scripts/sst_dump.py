#!/usr/bin/env python3
"""Dump RocksDB SST files (Turbopack cache) to key/value files for recovery.

Usage: python3 sst_dump.py <sst-file> <out-dir>
"""
import os, sys, struct, binascii

try:
    import snappy
except ImportError:
    snappy = None
try:
    import zstandard as zstd
except ImportError:
    zstd = None
try:
    import lz4.block as lz4b
except ImportError:
    lz4b = None

COMP = {0: 'none', 1: 'snappy', 2: 'zlib', 3: 'bzip2', 4: 'lz4', 5: 'lz4hc', 6: 'xpress', 7: 'zstd', 8: 'zstd?'}


def decode_varint(data, pos):
    result = 0
    shift = 0
    while True:
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7


def decompress(data, ctype):
    if ctype == 0:
        return data
    if ctype == 1 and snappy:
        return snappy.decompress(data)
    if ctype == 7 and zstd:
        return zstd.ZstdDecompressor().decompress(data, max_output_size=1 << 30)
    if ctype in (4, 5) and lz4b:
        # lz4 block format has no size header; use heuristic: try growing buffers
        import lz4.block as _b
        for cap in (1 << 20, 1 << 23, 1 << 26):
            try:
                return _b.decompress(data, uncompressed_size=cap)
            except Exception:
                continue
        raise ValueError('lz4 fail')
    raise ValueError(f'unsupported compression {ctype} ({COMP.get(ctype)})')


def parse_block(data):
    """Parse a BlockBasedTable block into (entries, restarts). Entries = [(key, value)]."""
    if len(data) < 8:
        raise ValueError('block too small')
    num_restarts = struct.unpack('<I', data[-4:])[0]
    if num_restarts == 0 or num_restarts > (len(data) - 4) // 4:
        raise ValueError(f'bad num_restarts {num_restarts} for block len {len(data)}')
    restart_offset = len(data) - 4 - num_restarts * 4
    restarts = [struct.unpack('<I', data[restart_offset + 4 * i: restart_offset + 4 * i + 4])[0]
                for i in range(num_restarts)]
    entries = []
    pos = 0
    last_key = b''
    while pos < restart_offset:
        shared, pos = decode_varint(data, pos)
        non_shared, pos = decode_varint(data, pos)
        vlen, pos = decode_varint(data, pos)
        if shared > len(last_key) or pos + non_shared + vlen > restart_offset + 4 * num_restarts + 4:
            raise ValueError('entry overflow')
        key = last_key[:shared] + data[pos:pos + non_shared]
        pos += non_shared
        val = data[pos:pos + vlen]
        pos += vlen
        entries.append((key, val))
        last_key = key
    return entries, restarts


def parse_footer(f):
    f.seek(0, 2)
    size = f.tell()
    if size < 48:
        raise ValueError('file too small')
    f.seek(size - 48)
    footer = f.read(48)
    magic = struct.unpack('<Q', footer[-8:])[0]
    # classic footer: [checksum:1][metaindex varints][index varints][pad][magic:8]
    pos = 1
    try:
        meta_off, pos = decode_varint(footer, pos)
        meta_sz, pos = decode_varint(footer, pos)
        idx_off, pos = decode_varint(footer, pos)
        idx_sz, pos = decode_varint(footer, pos)
    except Exception:
        raise ValueError('varint parse fail')
    return dict(size=size, magic=hex(magic), meta=(meta_off, meta_sz), index=(idx_off, idx_sz))


def read_block(f, off, sz):
    f.seek(off)
    data = f.read(sz)
    f.seek(off + sz)
    trailer = f.read(5)
    ctype = trailer[0]
    raw = decompress(data, ctype)
    return raw, ctype


def main():
    sst_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    val_dir = os.path.join(out_dir, 'values')
    os.makedirs(val_dir, exist_ok=True)
    manifest = []
    stats = dict(blocks=0, entries=0, err=0, comp={})
    with open(sst_path, 'rb') as f:
        footer = parse_footer(f)
        print(f'SST {sst_path}: size={footer["size"]} magic={footer["magic"]} '
              f'index={footer["index"]} meta={footer["meta"]}')
        # index block
        try:
            idx_raw, idx_comp = read_block(f, *footer['index'])
            idx_entries, _ = parse_block(idx_raw)
            print(f'index block: comp={COMP.get(idx_comp, idx_comp)} entries={len(idx_entries)}')
            handles = []
            for key, val in idx_entries:
                p = 0
                off, p = decode_varint(val, p)
                sz, p = decode_varint(val, p)
                handles.append((off, sz))
            print(f'data blocks: {len(handles)}')
            base = os.path.basename(sst_path)
            for bi, (off, sz) in enumerate(handles):
                try:
                    raw, ctype = read_block(f, off, sz)
                    stats['comp'][COMP.get(ctype, ctype)] = stats['comp'].get(COMP.get(ctype, ctype), 0) + 1
                    entries, _ = parse_block(raw)
                    stats['blocks'] += 1
                    for ei, (key, val) in enumerate(entries):
                        stats['entries'] += 1
                        if len(val) >= 200:
                            fn = os.path.join(val_dir, f'{base}.b{bi:04d}.e{ei:05d}.bin')
                            with open(fn, 'wb') as vf:
                                vf.write(val)
                            manifest.append((fn, bi, ei, len(key), len(val),
                                             binascii.hexlify(key[:40]).decode()))
                except Exception as e:
                    stats['err'] += 1
                    if stats['err'] <= 5:
                        print(f'  block {bi} @{off}+{sz} ERROR: {e}')
        except Exception as e:
            print(f'INDEX PARSE FAILED: {e}')
    with open(os.path.join(out_dir, 'manifest.txt'), 'w') as mf:
        for row in manifest:
            mf.write('\t'.join(str(x) for x in row) + '\n')
    print('STATS:', stats)


if __name__ == '__main__':
    main()
