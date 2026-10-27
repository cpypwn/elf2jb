"""Package a versioned release with buildable source and exact artifact hashes."""
from pathlib import Path
import hashlib
import zipfile

root=Path(__file__).resolve().parents[1]
elf=root/'build/elf2jb-host.elf'
assert elf.is_file(), 'Build the PS5 ELF first'
files=[root/name for name in ('README.md','RELEASE_NOTES.md','LICENSE','THIRD_PARTY.md','Makefile','.gitignore','VERSION')]
for folder in ('.github','runtime','src','scripts','tests','vendor','upstream','assets'):
    files.extend(sorted(p for p in (root/folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts))
version=(root/'VERSION').read_text().strip()
destination=root/('build/elf2jb-v'+version+'.zip')
with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as archive:
    archive.write(elf,'elf2jb-host.elf')
    archive.write(root/'build/elf2jb-open-browser.elf','elf2jb-open-browser.elf')
    archive.write(root/'upstream/bootstrap.bas','bootstrap.bas')
    for p in files:
        archive.write(p,'source/'+str(p.relative_to(root)))
    archive.write(root/'README.md','README.md')
    archive.write(root/'RELEASE_NOTES.md','RELEASE_NOTES.md')
    archive.write(root/'THIRD_PARTY.md','THIRD_PARTY.md')
    archive.write(root/'LICENSE','LICENSE')
    for p in sorted((root/'build/pages').rglob('*')):
        if p.is_file(): archive.write(p,'pages/'+str(p.relative_to(root/'build/pages')))
    archive.write(elf,'payload-manager/elf2jb-host.elf')
    archive.write(root/'assets/payload-icon.png','payload-manager/payload-icon.png')
    archive.write(root/'VERSION','payload-manager/VERSION')
    for script in ('payload_catalog.py','serve-payload-catalog.py','serve.command'):
        archive.write(root/'scripts'/script,'payload-manager/'+script)
    archive.write(root/'assets/ICON_PROVENANCE.md','payload-manager/ICON_PROVENANCE.md')
    archive.write(root/'assets/mac2jb-LICENSE.txt','payload-manager/mac2jb-LICENSE.txt')
    archive.writestr('SHA256SUMS',hashlib.sha256(elf.read_bytes()).hexdigest()+'  elf2jb-host.elf\n'+
        hashlib.sha256((root/'build/elf2jb-open-browser.elf').read_bytes()).hexdigest()+'  elf2jb-open-browser.elf\n')
print(destination)
destination.with_suffix('.zip.sha256').write_text(hashlib.sha256(destination.read_bytes()).hexdigest()+'  '+destination.name+'\n')
print('ELF SHA256:',hashlib.sha256(elf.read_bytes()).hexdigest())
