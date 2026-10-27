/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Optional Media tile installer; never executes as part of host startup. */
#include "media_shortcut.h"
#include <dlfcn.h>
#include <ps5/kernel.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>
static const char *shortcut_state="not-started";
static int shortcut_errno,shortcut_system_error;
#ifdef __PROSPERO__
struct ps5_app_services {
    int (*initialize)(void);
    int (*install_title)(const char *, const char *, void *);
    int (*terminate)(void);
};
static int initialize_app_service(void *opaque) { return ((struct ps5_app_services *)opaque)->initialize(); }
static int register_app_title(void *opaque,const char *title,const char *root) {
    return ((struct ps5_app_services *)opaque)->install_title(title,root,NULL);
}
static void terminate_app_service(void *opaque) { (void)((struct ps5_app_services *)opaque)->terminate(); }
static void install_media_shortcut(const char *state_root) {
    /* Optional service: a missing module/API must not prevent host startup. */
    void *library = dlopen("libSceAppInstUtil.sprx",RTLD_LAZY);
    if (!library) { shortcut_state="failed";shortcut_errno=ENOSYS;goto report; }
    struct ps5_app_services api;
    api.initialize=dlsym(library,"sceAppInstUtilInitialize");
    api.terminate=dlsym(library,"sceAppInstUtilTerminate");
    api.install_title=dlsym(library,"sceAppInstUtilAppInstallTitleDir");
    uint32_t handle;
    if (!kernel_dynlib_handle(-1,"libSceAppInstUtil.sprx",&handle)) {
        if (!api.initialize) api.initialize=(void *)kernel_dynlib_dlsym(-1,handle,"sceAppInstUtilInitialize");
        if (!api.terminate) api.terminate=(void *)kernel_dynlib_dlsym(-1,handle,"sceAppInstUtilTerminate");
        if (!api.install_title) api.install_title=(void *)kernel_dynlib_resolve(-1,handle,"Wudg3Xe3heE");
    }
    if (!api.initialize||!api.terminate||!api.install_title) {
        shortcut_state="failed";shortcut_errno=ENOSYS;
    } else {
        const struct elf2jb_app_services services={initialize_app_service,register_app_title,terminate_app_service,&api};
        int result=elf2jb_install_media_shortcut("/user/app",state_root,&services,&shortcut_system_error);
        shortcut_errno=result<0?errno:0;
        shortcut_state=result<0?"failed":result?"installed":"already-installed";
    }
    dlclose(library);
report:
    fprintf(stdout,"Media shortcut %s (%s), errno=%d, service=0x%08x\n",
        ELF2JB_SHORTCUT_TITLE_ID,shortcut_state,shortcut_errno,(unsigned int)shortcut_system_error);
    fflush(stdout);
}
#endif

int main(void) {
    const char *root="/data/elf2jb";
    struct stat st;
    if ((mkdir(root,0700)&&errno!=EEXIST)||lstat(root,&st)||!S_ISDIR(st.st_mode))return 1;
    int fd=open("/data/elf2jb/shortcut-installer.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);
    if(fd>=0){dup2(fd,STDOUT_FILENO);dup2(fd,STDERR_FILENO);if(fd>2)close(fd);}
    install_media_shortcut(root);
    typedef struct {char reserved[45];char message[3075];} notice;
    extern int sceKernelSendNotificationRequest(int,notice*,size_t,int);
    notice request={0};
    snprintf(request.message,sizeof(request.message),"elf2jb Media shortcut: %s (errno %d, service 0x%08x). The host ELF must be running to open the tile.",shortcut_state,shortcut_errno,(unsigned int)shortcut_system_error);
    sceKernelSendNotificationRequest(0,&request,sizeof(request),0);
    return shortcut_errno||shortcut_system_error?1:0;
}
