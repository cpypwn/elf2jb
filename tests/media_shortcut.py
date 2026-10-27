"""Validate Media shortcut files and registration with stubbed PS5 services.

This runs the production installer on isolated filesystem trees; it cannot
establish actual PS5 registration or Media-tab behavior.
"""
import errno
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import zlib

PROJECT = Path(__file__).resolve().parents[1]
DRIVER = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else PROJECT / 'build/media-shortcut-driver'
TITLE = 'ELFJ00001'
NAME = 'elf2jb Host'


def invoke(app_root, state_root, initialize_error=0, register_error=0, trailing_slash=False):
    result = subprocess.run(
        [str(DRIVER), str(app_root) + ('/' if trailing_slash else ''), str(state_root),
         str(initialize_error), str(register_error)],
        check=True, capture_output=True, text=True, timeout=10,
    )
    return json.loads(result.stdout)


def environment(root):
    app_root, state_root = root / 'user app', root / 'host state'
    app_root.mkdir()
    state_root.mkdir()
    return app_root, state_root


def assert_registered(result, app_root):
    assert result['result'] == 1, result
    assert result['system_error'] == 0, result
    assert result['trace'] == 'IRT', result
    assert (result['initialize_calls'], result['register_calls'], result['terminate_calls']) == (1, 1, 1), result
    assert result['title_id'] == TITLE, result
    assert Path(result['app_root']).resolve() == app_root.resolve(), result


def assert_real_png(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'icon is not a PNG'
    at, compressed, ended = 8, bytearray(), False
    while at < len(data):
        assert at + 12 <= len(data), 'truncated PNG chunk'
        length, = struct.unpack_from('>I', data, at)
        kind = data[at + 4:at + 8]
        assert at + 12 + length <= len(data), 'PNG chunk exceeds file'
        payload = data[at + 8:at + 8 + length]
        checksum, = struct.unpack_from('>I', data, at + 8 + length)
        assert zlib.crc32(kind + payload) & 0xffffffff == checksum, f'invalid {kind!r} checksum'
        if kind == b'IHDR':
            assert length == 13
            width, height = struct.unpack_from('>II', payload)
            assert 0 < width == height <= 4096, (width, height)
        elif kind == b'IDAT':
            compressed.extend(payload)
        elif kind == b'IEND':
            assert length == 0
            ended = True
        at += 12 + length
        if ended:
            break
    assert ended and at == len(data), 'PNG has no complete IEND or trailing bytes'
    assert zlib.decompress(compressed), 'PNG has no pixel data'


def snapshot(directory):
    return {str(p.relative_to(directory)): p.read_bytes()
            for p in directory.rglob('*') if p.is_file() and not p.is_symlink()}


with tempfile.TemporaryDirectory(prefix='elf2jb-media-tests-') as temporary:
    root = Path(temporary)

    first = root / 'first'
    first.mkdir()
    app_root, state_root = environment(first)
    unrelated = app_root / 'OTHER0001/sce_sys'
    unrelated.mkdir(parents=True)
    (unrelated / 'param.json').write_text('{"titleId":"OTHER0001","keep":true}')
    (unrelated / 'sentinel').write_bytes(b'keep another app untouched')
    before_unrelated = snapshot(unrelated)
    result = invoke(app_root, state_root, trailing_slash=True)
    assert_registered(result, app_root)
    assets = app_root / TITLE / 'sce_sys'
    param_bytes = (assets / 'param.json').read_bytes()
    param = json.loads(param_bytes)
    assert param['titleId'] == TITLE
    assert param['applicationCategoryType'] == 65536
    assert param['deeplinkUri'] == 'http://127.0.0.1:8088/'
    assert param['localizedParameters']['defaultLanguage'] == 'en-US'
    assert param['localizedParameters']['en-US']['titleName'] == NAME
    icon_bytes = (assets / 'icon0.png').read_bytes()
    assert_real_png(icon_bytes)
    marker = state_root / 'media-shortcut.registered'
    assert marker.is_file() and marker.stat().st_size > 0
    assert snapshot(unrelated) == before_unrelated
    print('PASS: first registration, Media metadata, PNG integrity, normalized root and unrelated app preservation')

    before = snapshot(first)
    result = invoke(app_root, state_root)
    assert result['result'] == 0, result
    assert result['register_calls'] == 0, result
    assert result['initialize_calls'] == 0, result
    assert result['terminate_calls'] == 0, result
    assert snapshot(first) == before
    print('PASS: repeated startup leaves matching files unchanged and skips registration')

    retry = root / 'retry'
    retry.mkdir()
    app_retry, state_retry = environment(retry)
    result = invoke(app_retry, state_retry, register_error=-77)
    assert result['result'] == -1 and result['system_error'] == -77, result
    assert result['trace'] == 'IRT', result
    retry_marker = state_retry / 'media-shortcut.registered'
    assert not retry_marker.exists()
    result = invoke(app_retry, state_retry)
    assert_registered(result, app_retry)
    assert retry_marker.is_file()
    print('PASS: registration failure propagates, terminates services and retries on next startup')

    (assets / 'icon0.png').write_bytes(b'outdated owned icon')
    result = invoke(app_root, state_root, register_error=-88)
    assert result['result'] == -1 and result['system_error'] == -88, result
    assert not marker.exists(), 'stale successful marker must not survive an update failure'
    assert (assets / 'param.json').read_bytes() == param_bytes
    result = invoke(app_root, state_root)
    assert_registered(result, app_root)
    assert (assets / 'icon0.png').read_bytes() == icon_bytes
    assert marker.is_file()
    print('PASS: changed owned icon invalidates the marker and failed updates remain retryable')

    failed = root / 'initialize-failure'
    failed.mkdir()
    app_failed, state_failed = environment(failed)
    result = invoke(app_failed, state_failed, initialize_error=-42)
    assert result['result'] == -1 and result['system_error'] == -42, result
    assert result['trace'] == 'I', result
    assert result['register_calls'] == 0 and result['terminate_calls'] == 0, result
    assert not (app_failed / TITLE).exists(), 'initialization failure must not create app assets'
    assert not (state_failed / 'media-shortcut.registered').exists()
    print('PASS: initialization failure propagates before creating launcher assets')

    foreign = root / 'foreign'
    foreign.mkdir()
    app_foreign, state_foreign = environment(foreign)
    foreign_assets = app_foreign / TITLE / 'sce_sys'
    foreign_assets.mkdir(parents=True)
    (foreign_assets / 'param.json').write_text('{"titleId":"ELFJ00001","owner":"someone else"}')
    (foreign_assets / 'icon0.png').write_bytes(b'existing user icon')
    (foreign_assets / 'sentinel').write_bytes(b'preserve')
    before = snapshot(foreign)
    result = invoke(app_foreign, state_foreign)
    assert result['result'] == -1 and result['errno'] == errno.EEXIST, result
    assert result['register_calls'] == 0, result
    assert snapshot(foreign) == before
    print('PASS: conflicting title metadata and existing assets are preserved')

    linked = root / 'symlink'
    linked.mkdir()
    app_linked, state_linked = environment(linked)
    external = linked / 'external'
    external.mkdir()
    (external / 'sentinel').write_bytes(b'not an installer destination')
    (app_linked / TITLE).symlink_to(external, target_is_directory=True)
    before = snapshot(external)
    result = invoke(app_linked, state_linked)
    assert result['result'] == -1 and result['register_calls'] == 0, result
    assert (app_linked / TITLE).is_symlink()
    assert snapshot(external) == before
    assert not (state_linked / 'media-shortcut.registered').exists()
    print('PASS: symlink title destination is rejected without changing its target')

    interrupted = root / 'interrupted-first-write'
    interrupted.mkdir()
    app_interrupted, state_interrupted = environment(interrupted)
    interrupted_assets = app_interrupted / TITLE / 'sce_sys'
    interrupted_assets.mkdir(parents=True)
    leftover = interrupted_assets / '.elf2jb-123-1234abcd.tmp'
    leftover.write_bytes(b'incomplete first atomic write')
    result = invoke(app_interrupted, state_interrupted)
    assert_registered(result, app_interrupted)
    assert leftover.read_bytes() == b'incomplete first atomic write'
    assert (interrupted_assets / 'param.json').read_bytes() == param_bytes
    assert (interrupted_assets / 'icon0.png').read_bytes() == icon_bytes
    assert (state_interrupted / 'media-shortcut.registered').is_file()
    print('PASS: interrupted first write recovers while preserving its regular temporary file')

    linked_temporary = root / 'symlink-temporary'
    linked_temporary.mkdir()
    app_temp_linked, state_temp_linked = environment(linked_temporary)
    linked_assets = app_temp_linked / TITLE / 'sce_sys'
    linked_assets.mkdir(parents=True)
    external_file = linked_temporary / 'external-file'
    external_file.write_bytes(b'preserve symlink target')
    symlink_temporary = linked_assets / '.elf2jb-123-1234abcd.tmp'
    symlink_temporary.symlink_to(external_file)
    before = snapshot(linked_temporary)
    result = invoke(app_temp_linked, state_temp_linked)
    assert result['result'] == -1 and result['register_calls'] == 0, result
    assert symlink_temporary.is_symlink()
    assert external_file.read_bytes() == b'preserve symlink target'
    assert snapshot(linked_temporary) == before
    assert not (state_temp_linked / 'media-shortcut.registered').exists()
    print('PASS: temporary-name symlinks are rejected without changing their targets')

    malformed = root / 'malformed-temporary'
    malformed.mkdir()
    app_malformed, state_malformed = environment(malformed)
    malformed_assets = app_malformed / TITLE / 'sce_sys'
    malformed_assets.mkdir(parents=True)
    foreign_temporary = malformed_assets / '.elf2jb-123-1234abcd.tmp.extra'
    foreign_temporary.write_bytes(b'not a recognized installer temporary')
    before = snapshot(malformed)
    result = invoke(app_malformed, state_malformed)
    assert result['result'] == -1 and result['errno'] == errno.EEXIST, result
    assert result['register_calls'] == 0, result
    assert snapshot(malformed) == before
    print('PASS: malformed temporary basenames remain foreign and are preserved')

print('All Media shortcut installer checks passed (PS5 registration stubbed).')
