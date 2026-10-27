/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Use the same path-based filesystem APIs as the PS5 SDK/PM examples.
 * In particular, do not use the SDK's raw FreeBSD *at syscall shims here:
 * their error convention is not the POSIX -1/errno contract used on Linux.
 */
#include "media_shortcut.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int join(char *out,size_t size,const char *directory,const char *name) {
    int n=snprintf(out,size,"%s/%s",directory,name);
    if(n<0||(size_t)n>=size){errno=ENAMETOOLONG;return -1;}return 0;
}
static int directory_exists(const char *path) {
    struct stat st;
    if(lstat(path,&st))return errno==ENOENT?0:-1;
    if(!S_ISDIR(st.st_mode)){errno=EEXIST;return -1;}return 1;
}
static int read_matches(const char *path,const unsigned char *data,size_t size,int *exists) {
    struct stat st;*exists=0;
    if(lstat(path,&st))return errno==ENOENT?0:-1;
    *exists=1;
    if(!S_ISREG(st.st_mode)){errno=EEXIST;return -1;}
    int fd=open(path,O_RDONLY|O_NOFOLLOW);if(fd<0)return -1;
    if(fstat(fd,&st)||!S_ISREG(st.st_mode)){int saved=errno;close(fd);errno=saved?saved:EEXIST;return -1;}
    int same=st.st_size>=0&&(size_t)st.st_size==size;
    unsigned char buffer[4096];
    for(size_t at=0;same&&at<size;){
        size_t wanted=size-at<sizeof(buffer)?size-at:sizeof(buffer);
        ssize_t n=read(fd,buffer,wanted);if(n<0&&errno==EINTR)continue;
        if(n<0){int saved=errno;close(fd);errno=saved;return -1;}
        if(!n||memcmp(buffer,data+at,(size_t)n))same=0;else at+=(size_t)n;
    }
    close(fd);return same;
}
static int atomic_file(const char *directory,const char *name,const unsigned char *data,size_t size) {
    char temporary[2048],destination[2048],basename[80];int fd=-1;
    if(join(destination,sizeof(destination),directory,name))return -1;
    for(unsigned int attempt=0;attempt<16;attempt++){
        snprintf(basename,sizeof(basename),".elf2jb-%ld-%08x.tmp",(long)getpid(),arc4random());
        if(join(temporary,sizeof(temporary),directory,basename))return -1;
        fd=open(temporary,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0644);
        if(fd>=0||errno!=EEXIST)break;
    }
    if(fd<0)return -1;
    int rc=0,saved=0;
    for(size_t at=0;at<size;){ssize_t n=write(fd,data+at,size-at);if(n<0&&errno==EINTR)continue;
        if(n<=0){rc=-1;saved=n<0?errno:EIO;break;}at+=(size_t)n;}
    if(!rc&&fsync(fd)){rc=-1;saved=errno;}
    if(close(fd)&&!rc){rc=-1;saved=errno;}
    if(!rc&&rename(temporary,destination)){rc=-1;saved=errno;}
    if(rc){unlink(temporary);errno=saved;}return rc;
}
static int temporary_name(const char *name) {
    if(strncmp(name,".elf2jb-",8))return 0;
    const char *p=name+8;unsigned int digits=0;
    while(*p>='0'&&*p<='9'){p++;if(++digits>20)return 0;}
    if(!digits||*p++!='-')return 0;
    for(unsigned int i=0;i<8;i++,p++)if(!((*p>='0'&&*p<='9')||(*p>='a'&&*p<='f')))return 0;
    return !strcmp(p,".tmp");
}
static int known_layout(const char *path,const char *first,const char *second) {
    DIR *d=opendir(path);if(!d)return errno==ENOENT?1:-1;
    int known=1;struct dirent *entry;
    while((entry=readdir(d))){const char *name=entry->d_name;
        if(!strcmp(name,".")||!strcmp(name,"..")||!strcmp(name,first)||(second&&!strcmp(name,second)))continue;
        if(second&&temporary_name(name)){char file[2048];struct stat st;
            if(!join(file,sizeof(file),path,name)&&!lstat(file,&st)&&S_ISREG(st.st_mode))continue;}
        known=0;break;
    }
    closedir(d);if(!known)errno=EEXIST;return known;
}
int elf2jb_install_media_shortcut(const char *app_root,const char *state_root,
                                const struct elf2jb_app_services *services,int *system_error) {
    if(system_error)*system_error=0;
    if(!app_root||!state_root||!services||!services->initialize||!services->register_title||!services->terminate){errno=EINVAL;return -1;}
    char normalized[1024],title[2048],sys[2048],param_path[2048],icon_path[2048],marker_path[2048];
    size_t length=strlen(app_root);while(length>1&&app_root[length-1]=='/')length--;
    if(!length||length+2>sizeof(normalized)){errno=ENAMETOOLONG;return -1;}
    memcpy(normalized,app_root,length);normalized[length]=0;
    if(directory_exists(normalized)!=1||directory_exists(state_root)!=1)return -1;
    if(join(title,sizeof(title),normalized,ELF2JB_SHORTCUT_TITLE_ID)||join(sys,sizeof(sys),title,"sce_sys")||
       join(param_path,sizeof(param_path),sys,"param.json")||join(icon_path,sizeof(icon_path),sys,"icon0.png")||
       join(marker_path,sizeof(marker_path),state_root,"media-shortcut.registered"))return -1;
    int have_title=directory_exists(title);if(have_title<0)return -1;
    int have_sys=have_title?directory_exists(sys):0;if(have_sys<0)return -1;
    int param_exists,icon_exists,marker_exists;
    int param=read_matches(param_path,media_param_json,media_param_json_size,&param_exists);if(param<0)return -1;
    if(param_exists&&!param){errno=EEXIST;return -1;}
    int icon=read_matches(icon_path,media_icon_png,media_icon_png_size,&icon_exists);if(icon<0)return -1;
    if(!param_exists){if(icon_exists&&!icon){errno=EEXIST;return -1;}
        if(known_layout(title,"sce_sys",NULL)<=0||known_layout(sys,"param.json","icon0.png")<=0)return -1;}
    int marker=read_matches(marker_path,media_fingerprint,media_fingerprint_size,&marker_exists);if(marker<0)return -1;
    if(param&&icon&&marker){errno=0;return 0;}
    int platform_error=services->initialize(services->opaque);
    if(platform_error){if(system_error)*system_error=platform_error;errno=EIO;return -1;}
    int result=-1;
    if(marker_exists&&unlink(marker_path))goto finish;
    if(!have_title&&mkdir(title,0755))goto finish;
    if(!have_sys&&mkdir(sys,0755))goto finish;
    if(!param&&atomic_file(sys,"param.json",media_param_json,media_param_json_size))goto finish;
    if(!icon&&atomic_file(sys,"icon0.png",media_icon_png,media_icon_png_size))goto finish;
    normalized[length]='/';normalized[length+1]=0;
    platform_error=services->register_title(services->opaque,ELF2JB_SHORTCUT_TITLE_ID,normalized);
    if(platform_error){errno=EIO;goto finish;}
    if(atomic_file(state_root,"media-shortcut.registered",media_fingerprint,media_fingerprint_size))goto finish;
    result=1;
finish:;
    int saved=result<0?errno:0;
    services->terminate(services->opaque);
    if(system_error)*system_error=platform_error;
    errno=saved;return result;
}
