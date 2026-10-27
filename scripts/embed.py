"""Generate self-contained runtime assets; never use files from a moving ref."""
from pathlib import Path
import hashlib

root = Path(__file__).resolve().parents[1]
out = root / "build/assets.c"
files = sorted((str(p.relative_to(root)),p) for name in ("upstream", "runtime", "assets") for p in (root / name).rglob("*") if p.is_file())
files.append(('runtime/open-browser.elf',root/'build/elf2jb-open-browser.elf'))
digest = hashlib.sha256()
for name,p in files:
    digest.update(name.encode() + b"\0" + p.read_bytes())
package = digest.hexdigest()[:16]

def array(data):
    return ",".join(str(b) for b in data)

with out.open("w") as f:
    f.write('#include <stddef.h>\n#include <stdio.h>\n#include <string.h>\n#include <errno.h>\n#include <sys/stat.h>\n#include <fcntl.h>\n#include <unistd.h>\n')
    shim = (root / "runtime/node-compat.js").read_bytes()
    f.write(f'const unsigned char shim_source[]={{ {array(shim)},0 }};\nconst size_t shim_source_size={len(shim)};\n')
    f.write(f'const char package_id[]="{package}";\n')
    param = (root / 'assets/param.json').read_bytes()
    icon = (root / 'assets/icon0.png').read_bytes()
    fingerprint = (hashlib.sha256(param + icon).hexdigest() + '\n').encode()
    for name, data in [('media_param_json', param), ('media_icon_png', icon), ('media_fingerprint', fingerprint)]:
        f.write(f'const unsigned char {name}[]={{ {array(data)} }};\nconst size_t {name}_size={len(data)};\n')
    for i, (name,p) in enumerate(files):
        f.write(f'static const unsigned char file_{i}[]={{ {array(p.read_bytes())} }};\n')
    f.write('static const struct {const char *name;const unsigned char *data;size_t size;} files[]={\n')
    for i, (name,p) in enumerate(files):
        f.write(f'{{"{name}",file_{i},sizeof(file_{i})}},\n')
    f.write('};\n')
    f.write(r'''
static int directory(char *path) {
    for(char *p=path+1;;p++) if(*p=='/'||!*p) {
        char saved=*p; *p=0;
        if(mkdir(path,0700)&&errno!=EEXIST){*p=saved;return -1;}
        struct stat st;if(lstat(path,&st)||!S_ISDIR(st.st_mode)){*p=saved;return -1;}
        *p=saved;if(!saved)break;
    }
    return 0;
}
int unpack_assets(const char *root) {
    for(size_t i=0;i<sizeof(files)/sizeof(files[0]);i++) {
        char path[2048];if(snprintf(path,sizeof(path),"%s/packages/%s/%s",root,package_id,files[i].name)>=(int)sizeof(path))return -1;
        char *end=strrchr(path,'/');*end=0;if(directory(path))return -1;*end='/';
        int fd=open(path,O_WRONLY|O_CREAT|O_EXCL,0600);
        if(fd<0&&errno==EEXIST) {
            fd=open(path,O_RDONLY|O_NOFOLLOW);if(fd<0)return -1;
            struct stat st;if(fstat(fd,&st)||!S_ISREG(st.st_mode)||(size_t)st.st_size!=files[i].size){close(fd);return -1;}
            size_t at=0;unsigned char buf[4096];
            while(at<files[i].size){ssize_t n=read(fd,buf,sizeof(buf));if(n<=0||(size_t)n>files[i].size-at||memcmp(buf,files[i].data+at,(size_t)n)){close(fd);return -1;}at+=(size_t)n;}
            close(fd);continue;
        }
        if(fd<0)return -1;
        size_t at=0;while(at<files[i].size){ssize_t n=write(fd,files[i].data+at,files[i].size-at);if(n<=0){close(fd);unlink(path);return -1;}at+=(size_t)n;}
        if(close(fd))return -1;
    }
    return 0;
}
''')
print(f"Embedded {len(files)} files; package {package}")
