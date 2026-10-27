/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "quickjs.h"
#include "sha256.h"
#include "media_shortcut.h"
#include <arpa/inet.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/time.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

typedef struct event { struct event *next; int type; size_t size; char data[]; } event;
typedef struct worker {
    struct worker *parent, *next;
    pthread_t thread;
    pthread_mutex_t mutex;
    int id, done, code, kill, signal_pending;
    int owned[1024], owned_count;
    event *first, *last, *in_first, *in_last;
    char *script, *arguments, *cwd, *environment;
} worker;
static pthread_mutex_t workers_mutex = PTHREAD_MUTEX_INITIALIZER;
static worker *workers;
static int next_id = 1;
#ifdef __PROSPERO__
static const char *shortcut_state = "separate-installer";
#else
static const char *shortcut_state = "unavailable-on-native-host";
#endif
static int shortcut_errno, shortcut_system_error;
extern const unsigned char shim_source[];
extern const size_t shim_source_size;
extern int unpack_assets(const char *root);
extern const char package_id[];
static int run_worker(worker *w);
static void boot_notify(const char *message) {
#ifdef __PROSPERO__
    typedef struct {char reserved[45];char message[3075];} notice;
    extern int sceKernelSendNotificationRequest(int,notice*,size_t,int);
    notice request={0};snprintf(request.message,sizeof(request.message),"%s",message);
    (void)sceKernelSendNotificationRequest(0,&request,sizeof(request),0);
#else
    (void)message;
#endif
}
static void boot_stage(const char *stage) {
    char text[512];snprintf(text,sizeof(text),"[elf2jb boot %s] %s\n",package_id,stage);
    fputs(text,stdout);fflush(stdout);
}

static void own_fd(JSContext *ctx,int fd) {worker *w=JS_GetContextOpaque(ctx);if(w->owned_count<1024)w->owned[w->owned_count++]=fd;}
static void release_fd(JSContext *ctx,int fd) {worker *w=JS_GetContextOpaque(ctx);for(int i=0;i<w->owned_count;i++)if(w->owned[i]==fd){w->owned[i]=w->owned[--w->owned_count];break;}}
static void queue(worker *w, int incoming, int type, const void *data, size_t size) {
    event *e = malloc(sizeof(*e) + size + 1);
    if (!e) return;
    e->next = NULL; e->type = type; e->size = size;
    memcpy(e->data, data, size); e->data[size] = 0;
    pthread_mutex_lock(&w->mutex);
    event **first = incoming ? &w->in_first : &w->first;
    event **last = incoming ? &w->in_last : &w->last;
    if (*last) (*last)->next = e; else *first = e;
    *last = e;
    pthread_mutex_unlock(&w->mutex);
}
static JSValue error(JSContext *ctx, const char *operation) {
    int saved = errno;
    const char *code = "EIO";
    switch(saved) {
    case ENOENT: code="ENOENT"; break; case EEXIST: code="EEXIST"; break;
    case EACCES: code="EACCES"; break; case ENOTDIR: code="ENOTDIR"; break;
    case EISDIR: code="EISDIR"; break; case ENOTEMPTY: code="ENOTEMPTY"; break;
    case ECONNREFUSED: code="ECONNREFUSED"; break; case EADDRINUSE: code="EADDRINUSE"; break;
    }
    JSValue e = JS_NewError(ctx);
    char text[512]; snprintf(text,sizeof(text),"%s: %s",operation,strerror(saved));
    JS_SetPropertyStr(ctx,e,"message",JS_NewString(ctx,text));
    JS_SetPropertyStr(ctx,e,"code",JS_NewString(ctx,code));
    JS_SetPropertyStr(ctx,e,"errno",JS_NewInt32(ctx,saved));
    return JS_Throw(ctx,e);
}
static int integer(JSContext *ctx, JSValueConst v) { int n=0; JS_ToInt32(ctx,&n,v); return n; }
static JSValue n_print(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self; worker *w=JS_GetContextOpaque(ctx);
    size_t size; const char *s=JS_ToCStringLen(ctx,&size,argv[0]); if(!s)return JS_EXCEPTION;
    int stream=argc>1?integer(ctx,argv[1]):1;
    if(w->parent) queue(w,0,stream,s,size); else {fwrite(s,1,size,stdout);fflush(stdout);}
    JS_FreeCString(ctx,s); return JS_UNDEFINED;
}
static JSValue n_readfile(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc; const char *path=JS_ToCString(ctx,argv[0]);
    if(!path)return JS_EXCEPTION;
    int fd=open(path,O_RDONLY); JS_FreeCString(ctx,path); if(fd<0)return error(ctx,"readFile");
    struct stat st;
    if(fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_size<0||st.st_size>512*1024*1024) {
        close(fd);errno=EINVAL;return error(ctx,"readFile size/type");
    }
    size_t len=(size_t)st.st_size, at=0; uint8_t *b=malloc(len?len:1);
    if(!b){close(fd);return JS_ThrowOutOfMemory(ctx);}
    while(at<len){ssize_t n=read(fd,b+at,len-at); if(n<0&&errno==EINTR)continue;
        if(n<=0){free(b);close(fd);errno=EIO;return error(ctx,"readFile truncated");}at+=(size_t)n;}
    close(fd); JSValue result=JS_NewArrayBufferCopy(ctx,b,len); free(b); return result;
}
static JSValue n_fs(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self; const char *op=JS_ToCString(ctx,argv[0]); if(!op)return JS_EXCEPTION;
    const char *a=argc>1?JS_ToCString(ctx,argv[1]):NULL;
    const char *b=NULL; JSValue result=JS_UNDEFINED; int rc=0;
    if(!strcmp(op,"open")) {rc=open(a,integer(ctx,argv[2]),integer(ctx,argv[3]));if(rc>=0){own_fd(ctx,rc);result=JS_NewInt32(ctx,rc);}}
    else if(!strcmp(op,"close")) {int fd=integer(ctx,argv[1]);release_fd(ctx,fd);rc=close(fd);}
    else if(!strcmp(op,"sync")) rc=fsync(integer(ctx,argv[1]));
    else if(!strcmp(op,"mkdir")) rc=mkdir(a,integer(ctx,argv[2]));
    else if(!strcmp(op,"unlink")) rc=unlink(a);
    else if(!strcmp(op,"rmdir")) rc=rmdir(a);
    else if(!strcmp(op,"chmod")) rc=chmod(a,integer(ctx,argv[2]));
    else if(!strcmp(op,"rename")||!strcmp(op,"link")||!strcmp(op,"symlink")) {b=JS_ToCString(ctx,argv[2]);rc=!strcmp(op,"rename")?rename(a,b):!strcmp(op,"symlink")?symlink(a,b):link(a,b);}
    else if(!strcmp(op,"mkdtemp")) {char *p=strdup(a);if(!p)rc=-1;else{if(!mkdtemp(p))rc=-1;else result=JS_NewString(ctx,p);free(p);}}
    else if(!strcmp(op,"stat")||!strcmp(op,"lstat")||!strcmp(op,"fstat")) {
        struct stat st;rc=!strcmp(op,"fstat")?fstat(integer(ctx,argv[1]),&st):(!strcmp(op,"lstat")?lstat(a,&st):stat(a,&st));
        if(!rc){result=JS_NewObject(ctx);
#define NUM(name,value) JS_SetPropertyStr(ctx,result,name,JS_NewFloat64(ctx,(double)(value)))
            NUM("size",st.st_size);NUM("mode",st.st_mode);NUM("dev",st.st_dev);NUM("nlink",st.st_nlink);
            NUM("kind",S_ISDIR(st.st_mode)?1:S_ISREG(st.st_mode)?2:S_ISLNK(st.st_mode)?3:0);
            NUM("mtimeMs",(double)st.st_mtime*1000);
        }
    } else if(!strcmp(op,"statfs")) {struct statvfs st;rc=statvfs(a,&st);if(!rc){result=JS_NewObject(ctx);NUM("bavail",st.f_bavail);NUM("bsize",st.f_frsize);}}
    else if(!strcmp(op,"readdir")) {DIR *d=opendir(a);if(!d)rc=-1;else {result=JS_NewArray(ctx);struct dirent *e;uint32_t i=0;while((e=readdir(d)))if(strcmp(e->d_name,".")&&strcmp(e->d_name,".."))JS_SetPropertyUint32(ctx,result,i++,JS_NewString(ctx,e->d_name));closedir(d);}}
    else {errno=ENOSYS;rc=-1;}
    int saved=errno;JS_FreeCString(ctx,a);JS_FreeCString(ctx,b);JS_FreeCString(ctx,op);errno=saved;
    if(rc<0){JS_FreeValue(ctx,result);return error(ctx,"filesystem");}return result;
}
static JSValue n_io(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;int fd=integer(ctx,argv[0]),writing=integer(ctx,argv[1]);
    size_t size;uint8_t *p=JS_GetArrayBuffer(ctx,&size,argv[2]);if(!p)return JS_EXCEPTION;
    int off=integer(ctx,argv[3]),len=integer(ctx,argv[4]);int64_t position=-1;
    JS_ToInt64(ctx,&position,argv[5]);if(off<0||len<0||(size_t)off+(size_t)len>size)return JS_ThrowRangeError(ctx,"I/O bounds");
    ssize_t n;
    do {n=position<0?(writing?write(fd,p+off,(size_t)len):read(fd,p+off,(size_t)len)):
        (writing?pwrite(fd,p+off,(size_t)len,(off_t)position):pread(fd,p+off,(size_t)len,(off_t)position));} while(n<0&&errno==EINTR);
    if(n<0)return error(ctx,"file I/O");
    return JS_NewInt64(ctx,n);
}
static int nonblock(int fd) {return fcntl(fd,F_SETFL,fcntl(fd,F_GETFL,0)|O_NONBLOCK);}
static JSValue n_socket(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;const char *op=JS_ToCString(ctx,argv[0]);if(!op)return JS_EXCEPTION;
    int fd=integer(ctx,argv[1]),rc=0;JSValue result=JS_UNDEFINED;
    if(!strcmp(op,"listen")||!strcmp(op,"connect")) {
        const char *host=JS_ToCString(ctx,argv[1]); int port=integer(ctx,argv[2]);int local=port<0;
        fd=socket(local?AF_UNIX:AF_INET,SOCK_STREAM,0);if(fd<0){JS_FreeCString(ctx,host);goto failed;}
        if(nonblock(fd)<0){close(fd);JS_FreeCString(ctx,host);goto failed;}
        int one=1;setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&one,sizeof(one));
        if(!local)setsockopt(fd,IPPROTO_TCP,TCP_NODELAY,&one,sizeof(one));
        struct sockaddr_storage address={0};socklen_t length;
        if(local){struct sockaddr_un *un=(void*)&address;un->sun_family=AF_UNIX;
#ifdef __FreeBSD__
            un->sun_len=sizeof(*un);
#endif
            if(strlen(host)>=sizeof(un->sun_path)){close(fd);JS_FreeCString(ctx,host);errno=ENAMETOOLONG;goto failed;}
            strcpy(un->sun_path,host);length=sizeof(*un);
        }else{struct sockaddr_in *in=(void*)&address;in->sin_family=AF_INET;in->sin_port=htons((uint16_t)port);
#ifdef __FreeBSD__
            in->sin_len=sizeof(*in);
#endif
            if(inet_pton(AF_INET,host,&in->sin_addr)!=1){close(fd);JS_FreeCString(ctx,host);errno=EINVAL;goto failed;}length=sizeof(*in);}
        JS_FreeCString(ctx,host);
        rc=!strcmp(op,"listen")?bind(fd,(void*)&address,length):connect(fd,(void*)&address,length);
        if(rc<0&&(!strcmp(op,"listen")||errno!=EINPROGRESS)){int saved=errno;close(fd);errno=saved;goto failed;}
        if(!strcmp(op,"listen")&&listen(fd,8)<0){int saved=errno;close(fd);errno=saved;goto failed;}
        own_fd(ctx,fd);result=JS_NewInt32(ctx,fd);
    }else if(!strcmp(op,"accept")){rc=accept(fd,NULL,NULL);if(rc<0&&(errno==EAGAIN||errno==EWOULDBLOCK))result=JS_NULL;
        else if(rc<0)goto failed;else {nonblock(rc);int one=1;setsockopt(rc,IPPROTO_TCP,TCP_NODELAY,&one,sizeof(one));own_fd(ctx,rc);result=JS_NewInt32(ctx,rc);}}
    else if(!strcmp(op,"recv")){uint8_t buffer[65536];ssize_t n=recv(fd,buffer,sizeof(buffer),0);
        if(n<0&&(errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR))result=JS_NULL;
        else if(n<0)goto failed;else result=JS_NewArrayBufferCopy(ctx,buffer,(size_t)n);}
    else if(!strcmp(op,"send")){size_t size;uint8_t *p=JS_GetArrayBuffer(ctx,&size,argv[2]);
        int offset=integer(ctx,argv[3]),len=integer(ctx,argv[4]);if(!p){JS_FreeCString(ctx,op);return JS_EXCEPTION;}
        if(offset<0||len<0||(size_t)offset+(size_t)len>size){JS_FreeCString(ctx,op);return JS_ThrowRangeError(ctx,"send bounds");}
        ssize_t n=send(fd,p+offset,(size_t)len,0);if(n<0&&(errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR))n=0;
        if(n<0)goto failed;
        result=JS_NewInt64(ctx,n);
    }else if(!strcmp(op,"connected")){int err=0;socklen_t size=sizeof(err);rc=getsockopt(fd,SOL_SOCKET,SO_ERROR,&err,&size);if(rc<0)goto failed;
        if(err){errno=err;goto failed;}struct sockaddr_storage a;socklen_t n=sizeof(a);result=JS_NewBool(ctx,getpeername(fd,(void*)&a,&n)==0);}
    else if(!strcmp(op,"port")){struct sockaddr_in in;socklen_t n=sizeof(in);if(getsockname(fd,(void*)&in,&n)<0)goto failed;result=JS_NewInt32(ctx,ntohs(in.sin_port));}
    else if(!strcmp(op,"shutdown")){shutdown(fd,SHUT_WR);}
    else if(!strcmp(op,"close")){release_fd(ctx,fd);close(fd);}
    else {errno=ENOSYS;goto failed;}
    JS_FreeCString(ctx,op);return result;
failed: JS_FreeCString(ctx,op);return error(ctx,"socket");
}
static JSValue n_random(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;int n=integer(ctx,argv[0]);if(n<0||n>64*1024*1024)return JS_ThrowRangeError(ctx,"random size");
    uint8_t *p=malloc(n?n:1);if(!p)return JS_ThrowOutOfMemory(ctx);arc4random_buf(p,(size_t)n);
    JSValue result=JS_NewArrayBufferCopy(ctx,p,(size_t)n);free(p);return result;
}
static JSValue n_sha(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;size_t size;uint8_t *p=JS_GetArrayBuffer(ctx,&size,argv[0]);if(!p)return JS_EXCEPTION;
    SHA256_CTX state;uint8_t digest[32];sha256_init(&state);sha256_update(&state,p,size);sha256_final(&state,digest);
    return JS_NewArrayBufferCopy(ctx,digest,32);
}
static JSValue n_lan(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;(void)argv;int fd=socket(AF_INET,SOCK_DGRAM,0);if(fd<0)return error(ctx,"LAN socket");
    struct sockaddr_in addr={0};addr.sin_family=AF_INET;addr.sin_port=htons(9);
#ifdef __FreeBSD__
    addr.sin_len=sizeof(addr);
#endif
    inet_pton(AF_INET,"192.0.2.1",&addr.sin_addr);int rc=connect(fd,(void*)&addr,sizeof(addr));socklen_t len=sizeof(addr);
    if(!rc)rc=getsockname(fd,(void*)&addr,&len);
    int saved=errno;close(fd);errno=saved;if(rc)return error(ctx,"LAN route");
    char text[64];if(!inet_ntop(AF_INET,&addr.sin_addr,text,sizeof(text)))return error(ctx,"LAN address");return JS_NewString(ctx,text);
}
static JSValue n_now(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;(void)argv;struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return error(ctx,"monotonic clock");
    return JS_NewFloat64(ctx,(double)t.tv_sec*1000+(double)t.tv_nsec/1000000);
}
static void *thread_main(void *data) {worker *w=data;int code=run_worker(w);pthread_mutex_lock(&w->mutex);w->code=code;w->done=1;pthread_mutex_unlock(&w->mutex);return NULL;}
static JSValue n_spawn(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;worker *w=calloc(1,sizeof(*w));if(!w)return JS_ThrowOutOfMemory(ctx);
    const char *s=JS_ToCString(ctx,argv[0]),*a=JS_ToCString(ctx,argv[1]),*cwd=JS_ToCString(ctx,argv[2]),*env=JS_ToCString(ctx,argv[3]);
    w->script=strdup(s);w->arguments=strdup(a);w->cwd=strdup(cwd);w->environment=strdup(env);w->parent=JS_GetContextOpaque(ctx);
    JS_FreeCString(ctx,s);JS_FreeCString(ctx,a);JS_FreeCString(ctx,cwd);JS_FreeCString(ctx,env);
    pthread_mutex_init(&w->mutex,NULL);pthread_mutex_lock(&workers_mutex);w->id=++next_id;w->next=workers;workers=w;pthread_mutex_unlock(&workers_mutex);
    pthread_attr_t attributes;pthread_attr_init(&attributes);pthread_attr_setstacksize(&attributes,4UL*1024*1024);
    int rc=pthread_create(&w->thread,&attributes,thread_main,w);pthread_attr_destroy(&attributes);if(rc){pthread_mutex_lock(&w->mutex);w->code=1;w->done=2;pthread_mutex_unlock(&w->mutex);errno=rc;return error(ctx,"worker");}
    return JS_NewInt32(ctx,w->id);
}
static JSValue n_events(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;(void)argv;worker *parent=JS_GetContextOpaque(ctx);JSValue result=JS_NewArray(ctx);uint32_t at=0;
    pthread_mutex_lock(&workers_mutex);
    for(worker *w=workers;w;w=w->next)if(w->parent==parent){pthread_mutex_lock(&w->mutex);
        event *e=w->first;w->first=w->last=NULL;
        while(e){event *next=e->next;JSValue row=JS_NewArray(ctx);JS_SetPropertyUint32(ctx,row,0,JS_NewInt32(ctx,w->id));JS_SetPropertyUint32(ctx,row,1,JS_NewInt32(ctx,e->type));JS_SetPropertyUint32(ctx,row,2,JS_NewStringLen(ctx,e->data,e->size));JS_SetPropertyUint32(ctx,result,at++,row);free(e);e=next;}
        if(w->done==1){JSValue row=JS_NewArray(ctx);JS_SetPropertyUint32(ctx,row,0,JS_NewInt32(ctx,w->id));JS_SetPropertyUint32(ctx,row,1,JS_NewInt32(ctx,0));JS_SetPropertyUint32(ctx,row,2,JS_NewInt32(ctx,w->code));JS_SetPropertyUint32(ctx,result,at++,row);w->done=2;pthread_detach(w->thread);}
        pthread_mutex_unlock(&w->mutex);}
    pthread_mutex_unlock(&workers_mutex);
    pthread_mutex_lock(&parent->mutex);event *e=parent->in_first;parent->in_first=parent->in_last=NULL;int sig=parent->signal_pending;parent->signal_pending=0;pthread_mutex_unlock(&parent->mutex);
    while(e){event *next=e->next;JSValue row=JS_NewArray(ctx);JS_SetPropertyUint32(ctx,row,0,JS_NewInt32(ctx,0));JS_SetPropertyUint32(ctx,row,1,JS_NewInt32(ctx,3));JS_SetPropertyUint32(ctx,row,2,JS_NewStringLen(ctx,e->data,e->size));JS_SetPropertyUint32(ctx,result,at++,row);free(e);e=next;}
    if(sig){JSValue row=JS_NewArray(ctx);JS_SetPropertyUint32(ctx,row,0,JS_NewInt32(ctx,0));JS_SetPropertyUint32(ctx,row,1,JS_NewInt32(ctx,4));JS_SetPropertyUint32(ctx,row,2,JS_NewString(ctx,sig==9?"SIGKILL":"SIGTERM"));JS_SetPropertyUint32(ctx,result,at++,row);}
    return result;
}
static JSValue n_message(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;worker *parent=JS_GetContextOpaque(ctx);int id=integer(ctx,argv[0]),kind=integer(ctx,argv[1]);
    const char *s=JS_ToCString(ctx,argv[2]);if(!s)return JS_EXCEPTION;
    if(id==0&&parent->parent)queue(parent,0,3,s,strlen(s));
    else {pthread_mutex_lock(&workers_mutex);for(worker *w=workers;w;w=w->next)if(w->parent==parent&&w->id==id){
        if(kind==3)queue(w,1,kind,s,strlen(s));else{pthread_mutex_lock(&w->mutex);w->signal_pending=kind;w->kill=kind==9;pthread_mutex_unlock(&w->mutex);}break;}
        pthread_mutex_unlock(&workers_mutex);}
    JS_FreeCString(ctx,s);return JS_UNDEFINED;
}
static JSValue n_notify(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;
    const char *s=JS_ToCString(ctx,argv[0]);if(!s)return JS_EXCEPTION;
    boot_notify(s);JS_FreeCString(ctx,s);
    return JS_UNDEFINED;
}
static JSValue n_shortcut(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    (void)self;(void)argc;(void)argv;
    JSValue result=JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,result,"titleId",JS_NewString(ctx,ELF2JB_SHORTCUT_TITLE_ID));
    JS_SetPropertyStr(ctx,result,"name",JS_NewString(ctx,ELF2JB_SHORTCUT_TITLE_NAME));
    JS_SetPropertyStr(ctx,result,"state",JS_NewString(ctx,shortcut_state));
    JS_SetPropertyStr(ctx,result,"errno",JS_NewInt32(ctx,shortcut_errno));
    JS_SetPropertyStr(ctx,result,"systemError",JS_NewInt32(ctx,shortcut_system_error));
    return result;
}
static void dump_exception(JSContext *ctx) {
    JSValue e=JS_GetException(ctx),stack=JS_GetPropertyStr(ctx,e,"stack");
    const char *s=JS_ToCString(ctx,e),*t=JS_ToCString(ctx,stack);worker *w=JS_GetContextOpaque(ctx);
    char text[8192];int n=snprintf(text,sizeof(text),"%s\n%s\n",s?s:"exception",t?t:"");
    if(w->parent)queue(w,0,2,text,(size_t)(n<(int)sizeof(text)?n:(int)sizeof(text)-1));else fputs(text,stderr);
    JS_FreeCString(ctx,s);JS_FreeCString(ctx,t);JS_FreeValue(ctx,stack);JS_FreeValue(ctx,e);
}
static void rejection(JSContext *ctx, JSValueConst promise, JSValueConst reason, JS_BOOL handled, void *opaque) {
    (void)promise;(void)opaque;
    /* Delay fatal reporting in JS: attaching .catch in a later job is legal. */
    JSValue global=JS_GetGlobalObject(ctx),hook=JS_GetPropertyStr(ctx,global,"__rejection");
    if(JS_IsFunction(ctx,hook)){JSValue args[3]={JS_DupValue(ctx,promise),JS_DupValue(ctx,reason),JS_NewBool(ctx,handled)};
        JSValue r=JS_Call(ctx,hook,global,3,args);JS_FreeValue(ctx,r);for(int i=0;i<3;i++)JS_FreeValue(ctx,args[i]);}
    JS_FreeValue(ctx,hook);JS_FreeValue(ctx,global);
}
static int interrupt(JSRuntime *rt, void *opaque) {(void)rt;worker *w=opaque;pthread_mutex_lock(&w->mutex);int kill=w->kill;pthread_mutex_unlock(&w->mutex);return kill;}
static int run_worker(worker *w) {
    if(!w->parent)boot_stage("creating JavaScript runtime");
    JSRuntime *rt=JS_NewRuntime();if(!rt)return 1;
    JS_SetMemoryLimit(rt,512UL*1024*1024);JS_SetMaxStackSize(rt,2UL*1024*1024);
    JS_SetInterruptHandler(rt,interrupt,w);JS_SetHostPromiseRejectionTracker(rt,rejection,NULL);
    if(!w->parent)boot_stage("creating JavaScript context");
    JSContext *ctx=JS_NewContext(rt);if(!ctx){JS_FreeRuntime(rt);return 1;}JS_SetContextOpaque(ctx,w);
    JSValue global=JS_GetGlobalObject(ctx),native=JS_NewObject(ctx);
#define FN(name,fn,n) JS_SetPropertyStr(ctx,native,name,JS_NewCFunction(ctx,fn,name,n))
    FN("print",n_print,2);FN("readFile",n_readfile,1);FN("fs",n_fs,4);FN("io",n_io,6);FN("socket",n_socket,5);
    FN("random",n_random,1);FN("sha256",n_sha,1);FN("lan",n_lan,0);FN("now",n_now,0);FN("spawn",n_spawn,4);FN("events",n_events,0);FN("message",n_message,3);FN("notify",n_notify,1);
    FN("shortcutInfo",n_shortcut,0);
    JSValue flags=JS_NewObject(ctx);
#define FLAG(name) JS_SetPropertyStr(ctx,flags,#name,JS_NewInt32(ctx,name))
    FLAG(O_RDONLY);FLAG(O_WRONLY);FLAG(O_RDWR);FLAG(O_CREAT);FLAG(O_EXCL);FLAG(O_TRUNC);FLAG(O_APPEND);
    JS_SetPropertyStr(ctx,native,"flags",flags);
    JS_SetPropertyStr(ctx,global,"_native",native);
    JS_SetPropertyStr(ctx,global,"__cwd",JS_NewString(ctx,w->cwd));
    JS_SetPropertyStr(ctx,global,"__entry",JS_NewString(ctx,w->script));
    JS_SetPropertyStr(ctx,global,"__argumentsJSON",JS_NewString(ctx,w->arguments));
    JS_SetPropertyStr(ctx,global,"__environmentJSON",JS_NewString(ctx,w->environment));
    JS_SetPropertyStr(ctx,global,"__workerId",JS_NewInt32(ctx,w->id));
    JS_SetPropertyStr(ctx,global,"__hasParent",JS_NewBool(ctx,w->parent!=NULL));
#ifdef __PROSPERO__
    JS_SetPropertyStr(ctx,global,"__platform",JS_NewString(ctx,"ps5"));
#else
    JS_SetPropertyStr(ctx,global,"__platform",JS_NewString(ctx,"linux"));
#endif
    int code=0;
    if(!w->parent)boot_stage("evaluating host entrypoint");
    JSValue r=JS_Eval(ctx,(const char*)shim_source,shim_source_size,"node-compat.js",JS_EVAL_TYPE_GLOBAL);
    if(JS_IsException(r)){dump_exception(ctx);code=1;}JS_FreeValue(ctx,r);
    if(!w->parent&&!code)boot_stage("host entrypoint evaluated; starting event loop");
    JSValue tick=JS_GetPropertyStr(ctx,global,"__tick");
    while(!code){JSContext *job_ctx=NULL;int jobs=0,job;
        while((job=JS_ExecutePendingJob(rt,&job_ctx))>0){if(++jobs>10000)break;}
        if(job<0){dump_exception(job_ctx);code=1;break;}
        r=JS_Call(ctx,tick,global,0,NULL);if(JS_IsException(r)){dump_exception(ctx);JS_FreeValue(ctx,r);code=1;break;}
        int alive=JS_ToBool(ctx,r);JS_FreeValue(ctx,r);
        JSValue exit=JS_GetPropertyStr(ctx,global,"__exit");if(!JS_IsUndefined(exit)){code=integer(ctx,exit);JS_FreeValue(ctx,exit);break;}JS_FreeValue(ctx,exit);
        if(!alive&&!JS_IsJobPending(rt))break;
        struct timespec pause={.tv_nsec=250000};nanosleep(&pause,NULL);
    }
    r=JS_GetPropertyStr(ctx,global,"process");JSValue ec=JS_GetPropertyStr(ctx,r,"exitCode");if(!code)code=integer(ctx,ec);JS_FreeValue(ctx,ec);JS_FreeValue(ctx,r);
    /* All child interpreters must retire before freeing their parent's state. */
    pthread_mutex_lock(&workers_mutex);for(worker *child=workers;child;child=child->next)if(child->parent==w){pthread_mutex_lock(&child->mutex);if(!child->done)child->kill=1;pthread_mutex_unlock(&child->mutex);}pthread_mutex_unlock(&workers_mutex);
    for(;;){int active=0;pthread_mutex_lock(&workers_mutex);for(worker *child=workers;child;child=child->next)if(child->parent==w){pthread_mutex_lock(&child->mutex);active+=!child->done;pthread_mutex_unlock(&child->mutex);}pthread_mutex_unlock(&workers_mutex);if(!active)break;struct timespec pause={.tv_nsec=1000000};nanosleep(&pause,NULL);}
    for(int i=0;i<w->owned_count;i++)close(w->owned[i]);
    w->owned_count=0;
    JS_FreeValue(ctx,tick);JS_FreeValue(ctx,global);JS_FreeContext(ctx);JS_FreeRuntime(rt);return code;
}
int main(int argc, char **argv) {
    signal(SIGPIPE,SIG_IGN);
    const char *root;
#ifdef __PROSPERO__
    root="/data/elf2jb";
    boot_notify("elf2jb recovery: entered startup. Waiting for the host on port 8088.");
    struct stat root_stat;
    if((mkdir(root,0700)&&errno!=EEXIST)||lstat(root,&root_stat)||!S_ISDIR(root_stat.st_mode)) {
        boot_notify("elf2jb: cannot open /data/elf2jb. Host did not start.");return 1;
    }
    char logfile[1024];snprintf(logfile,sizeof(logfile),"%s/host-runtime.log",root);
    int logfd=open(logfile,O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);
    if(logfd>=0){dup2(logfd,STDOUT_FILENO);dup2(logfd,STDERR_FILENO);if(logfd>2)close(logfd);}
    boot_stage("main entered; shortcut installation is separate");
#else
    root=argc>1?argv[1]:".";
#endif
    int extract=1;
#ifndef __PROSPERO__
    extract=argc<=2;
#endif
    if(extract){boot_stage("extracting packaged files");if(unpack_assets(root)){
        perror("extract runtime assets");boot_notify("elf2jb: package extraction failed. See /data/elf2jb/host-runtime.log.");return 1;
    }boot_stage("packaged files ready");}
    char entry[1024],cwd[1024];snprintf(entry,sizeof(entry),"%s/packages/%s/runtime/ps5-entry.cjs",root,package_id);snprintf(cwd,sizeof(cwd),"%s/packages/%s/upstream",root,package_id);
    worker w={0};w.id=1;pthread_mutex_init(&w.mutex,NULL);w.script=entry;w.cwd=cwd;w.arguments="[]";w.environment="{}";
#ifndef __PROSPERO__
    if(argc>2){w.script=argv[2];w.cwd=(char*)root;}
#else
    (void)argc;(void)argv;
#endif
    boot_stage("starting interpreter thread");
    pthread_attr_t attributes;int rc=pthread_attr_init(&attributes);
    if(!rc){rc=pthread_attr_setstacksize(&attributes,4UL*1024*1024);if(!rc)rc=pthread_create(&w.thread,&attributes,thread_main,&w);pthread_attr_destroy(&attributes);}
    if(rc){errno=rc;perror("main interpreter thread");boot_notify("elf2jb: interpreter thread could not start. See host-runtime.log.");return 1;}
    pthread_join(w.thread,NULL);
    if(w.code){boot_stage("interpreter exited with an error");boot_notify("elf2jb: host startup failed. Send /data/elf2jb/host-runtime.log.");}
    return w.code;
}
