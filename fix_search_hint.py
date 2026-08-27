#!/usr/bin/env python3
"""One-shot fix script for perTypeHints.ts search hint."""

with open('backend/src/prompts/chatbot/perTypeHints.ts', 'rb') as f:
    data = f.read()

# Old search hint block (current UTF-8)
old = (
    b'  search: `Section "search": k'
).replace(b'k', b'k\xe1\xba\xbft qu\xe1\xba\xa3 semantic search top 5 theo c\xc3\xa2u h\xe1\xbb\x8fi user.')

# That doesn't work cleanly with concatenation. Let me use the actual raw bytes
# from the current file.
# Find the block
import re
m = re.search(rb'  search: `Section "search":.*?`,\n', data, re.DOTALL)
if not m:
    print('Search block not found')
    raise SystemExit(1)

old_block = m.group(0)
print(f'Current block length: {len(old_block)} bytes')

new_block = (
    b'  search: `Section "search": k'
    b'\xe1\xba\xbft qu\xe1\xba\xa3 semantic search top 5 theo c\xc3\xa2u h\xe1\xbb\x8fi user '
    b'(threshold 0.75 \xe2\x80\x94 \xc4\x91\xc3\xa3 l\xe1\xbb\x8dc job match y\xe1\xba\xbfu).\n'
    b'Tr\xc3\xacnh b\xc3\xa0y g\xe1\xbb\x8dn: ti\xc3\xaau \xc4\x91\xe1\xbb\x81 + l\xc6\xb0\xc6\xa1ng + \xc4\x91\xe1\xbb\x8ba \xc4\x91i\xe1\xbb\x83m. '
    b'\xc4\x90\xe1\xbb\x99 t\xc6\xb0\xc6\xa1ng \xc4\x91\xe1\xbb\x93ng >0.8 l\xc3\xa0 match t\xe1\xbb\x91t, <0.8 l\xc3\xa0 v\xe1\xbb\xaba.\n'
    b'N\xe1\xba\xbfu section n\xc3\xb3i "ch\xc6\xb0a c\xc3\xb3 job ph\xc3\xb9 h\xe1\xbb\xa3p" \xe2\x86\x92 '
    b'g\xe1\xbb\xa3i \xc3\xbd user \xc4\x91\xe1\xbb\x95i t\xe1\xbb\xab kho\xc3\xa1 (th\xc3\xam \xc4\x91\xe1\xbb\x8ba \xc4\x91i\xe1\xbb\x83m / '
    b'lo\xe1\xba\xa1i h\xc3\xacnh / m\xe1\xbb\xa9c l\xc6\xb0\xc6\xa1ng / c\xc3\xb4ng ngh\xe1\xbb\x87 c\xe1\xbb\xa5 th\xe1\xbb\x83).\n'
    b'QUAN TR\xe1\xbb\x8cNG: Ti\xc3\xaau \xc4\x91\xe1\xbb\x81 job trong section l\xc3\xa0 markdown link "[T\xc3\xaan job](/jobs/<id>)". '
    b'Khi nh\xe1\xba\xafc l\xe1\xba\xa1i job trong c\xc3\xa2u tr\xe1\xba\xa3 l\xe1\xbb\x9di, GI\xe1\xbb\xae NGUY\xc3\x8aN markdown link '
    b'\xc4\x91\xc3\xb3 verbatim \xe2\x80\x94 kh\xc3\xb4ng b\xe1\xbb\x8f ngo\xe1\xba\xbfc, kh\xc3\xb4ng ghi "t\xe1\xba\xa1i \xc4\x91\xc3\xa2y". '
    b'User click \xc4\x91\xc6\xb0\xe1\xbb\xa3c v\xc3\xa0o t\xc3\xaan job \xc4\x91\xe1\xbb\x83 m\xe1\xbb\x9f chi ti\xe1\xba\xbft.`,\n'
)

data = data.replace(old_block, new_block)

with open('backend/src/prompts/chatbot/perTypeHints.ts', 'wb') as f:
    f.write(data)
print('Done.')
