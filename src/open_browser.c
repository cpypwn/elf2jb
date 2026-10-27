/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Launched by elfldr as a separate payload only after the host is listening. */
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

typedef struct { char reserved[45]; char message[3075]; } notice;
extern int sceKernelSendNotificationRequest(int,notice *,size_t,int);
extern int sceSystemServiceLaunchWebBrowser(const char *uri);
extern int sceUserServiceInitialize(void *);
#ifndef ELF2JB_BROWSER_WAIT_MS
#define ELF2JB_BROWSER_WAIT_MS 10000
#endif

static double now_ms(void) {
    struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;
    return (double)t.tv_sec*1000+(double)t.tv_nsec/1000000;
}
static void notify(const char *text) {
    notice request={0};snprintf(request.message,sizeof(request.message),"%s",text);
    (void)sceKernelSendNotificationRequest(0,&request,sizeof(request),0);
}
static void report(const char *root,const char *state,int error,int user_error) {
    char path[1024],text[512];snprintf(path,sizeof(path),"%s/browser-launch.json",root);
    int size=snprintf(text,sizeof(text),"{\"state\":\"%s\",\"systemError\":%d,\"userServiceError\":%d,\"monotonicMs\":%.3f}\n",state,error,user_error,now_ms());
    int fd=open(path,O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW,0600);
    if(fd>=0){size_t at=0;while(at<(size_t)size){ssize_t n=write(fd,text+at,(size_t)size-at);if(n<0&&errno==EINTR)continue;if(n<=0)break;at+=(size_t)n;}close(fd);}
    fputs(text,stdout);fflush(stdout);
}
/* Check HTTP readiness, not just an open port. Never send any request off-console. */
static int ui_ready(int port) {
    int fd=socket(AF_INET,SOCK_STREAM,0);if(fd<0)return 0;
    int flags=fcntl(fd,F_GETFL,0);
    if(flags<0||fcntl(fd,F_SETFL,flags|O_NONBLOCK)<0){close(fd);return 0;}
    struct sockaddr_in address={0};address.sin_family=AF_INET;address.sin_port=htons((uint16_t)port);
#ifdef __FreeBSD__
    address.sin_len=sizeof(address);
#endif
    address.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    int rc=connect(fd,(struct sockaddr *)&address,sizeof(address));
    if(rc<0&&errno!=EINPROGRESS&&errno!=EWOULDBLOCK){close(fd);return 0;}
    struct pollfd waiter={.fd=fd,.events=POLLOUT};
    if(poll(&waiter,1,500)<=0){close(fd);return 0;}
    int error=0;socklen_t length=sizeof(error);
    if(getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&length)||error){close(fd);return 0;}
    const char request[]="GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    size_t sent=0;double deadline=now_ms()+1000;
    while(sent<sizeof(request)-1&&now_ms()<deadline){
        ssize_t n=send(fd,request+sent,sizeof(request)-1-sent,0);
        if(n>0)sent+=(size_t)n;else if(n<0&&(errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR)){waiter.events=POLLOUT;(void)poll(&waiter,1,50);}else break;
    }
    char response[256];size_t at=0;int ready=0;
    while(sent==sizeof(request)-1&&at<sizeof(response)-1&&now_ms()<deadline){
        waiter.events=POLLIN;if(poll(&waiter,1,100)<=0)continue;
        ssize_t n=recv(fd,response+at,sizeof(response)-1-at,0);
        if(n<0&&(errno==EAGAIN||errno==EWOULDBLOCK||errno==EINTR))continue;
        if(n<=0)break;
        at+=(size_t)n;response[at]=0;
        if(strstr(response,"\r\n")){ready=!strncmp(response,"HTTP/1.1 200 ",13)||!strncmp(response,"HTTP/1.0 200 ",13);break;}
    }
    close(fd);return ready;
}
int main(int argc,char **argv) {
    signal(SIGPIPE,SIG_IGN);
    const char *root="/data/elf2jb";int port=8088;
#ifndef __PROSPERO__
    if(argc>1)root=argv[1];
    if(argc>2)port=atoi(argv[2]);
#else
    (void)argc;(void)argv;
#endif
    notify("elf2jb: browser helper started; waiting for the host page.");
    struct stat st;
    if((mkdir(root,0700)&&errno!=EEXIST)||lstat(root,&st)||!S_ISDIR(st.st_mode)){
        notify("elf2jb: browser helper cannot access /data/elf2jb.");return 1;
    }
    char logfile[1024];snprintf(logfile,sizeof(logfile),"%s/browser-launch.log",root);
    int fd=open(logfile,O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);
    if(fd>=0){dup2(fd,STDOUT_FILENO);dup2(fd,STDERR_FILENO);if(fd>2)close(fd);}
    report(root,"waiting-for-ui",0,0);
    double deadline=now_ms()+ELF2JB_BROWSER_WAIT_MS;
    while(!ui_ready(port)){
        if(now_ms()>=deadline){report(root,"ui-not-ready",ETIMEDOUT,0);notify("elf2jb: browser not opened because the host page is unavailable.");return 1;}
        struct timespec delay={.tv_nsec=100000000};nanosleep(&delay,NULL);
    }
    int priority=256;int user_error=sceUserServiceInitialize(&priority);
    report(root,"requesting-browser",0,user_error);
    char uri[128];snprintf(uri,sizeof(uri),"http://127.0.0.1:%d/",port);
    int error=sceSystemServiceLaunchWebBrowser(uri);
    report(root,error?"launch-failed":"launch-accepted",error,user_error);
    if(error){notify("elf2jb: PS5 browser launch failed. See browser-launch.log; the host is still running.");return 1;}
    return 0;
}
