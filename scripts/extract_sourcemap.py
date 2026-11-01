#!/usr/bin/env python3
"""Extract original TS sources from a (sectioned) Turbopack .js.map source map."""
import json, sys, os
from urllib.parse import unquote, urlparse

def main():
    map_path = sys.argv[1]
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    with open(map_path, 'r', encoding='utf-8') as f:
        sm = json.load(f)
    maps = []
    if 'sections' in sm:
        for sec in sm['sections']:
            maps.append(sec.get('map') or {})
    else:
        maps.append(sm)
    seen = {}
    total = 0
    for m in maps:
        sources = m.get('sources') or []
        contents = m.get('sourcesContent') or []
        for i, src in enumerate(sources):
            if not src:
                continue
            content = contents[i] if i < len(contents) else None
            if not content:
                continue
            if src.startswith('file://'):
                path = unquote(urlparse(src).path)
            else:
                path = src
            idx = path.find('/home/z/my-project/')
            if idx >= 0:
                path = path[idx + len('/home/z/my-project/'):]
            path = path.lstrip('/')
            if path.startswith('node_modules'):
                continue
            if not any(path.endswith(ext) for ext in ('.ts', '.tsx', '.js', '.mjs')):
                continue
            seen[path] = content
    for path, content in sorted(seen.items()):
        out = os.path.join(out_dir, path)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'w', encoding='utf-8') as wf:
            wf.write(content)
        total += 1
        print(f'  {path}: {len(content)} chars')
    print(f'TOTAL: {total} files -> {out_dir}')

if __name__ == '__main__':
    main()
