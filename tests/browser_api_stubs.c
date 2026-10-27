/* Native tests only: record the browser system-service call without launching UI. */
#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
int sceKernelSendNotificationRequest(int a,void *b,size_t c,int d) {
    (void)a;(void)b;(void)c;(void)d;return 0;
}
int sceUserServiceInitialize(void *p) {(void)p;return 0;}
int sceSystemServiceLaunchWebBrowser(const char *uri) {
    const char *file=getenv("ELF2JB_BROWSER_TEST_CALLS");
    if(file){FILE *out=fopen(file,"a");if(out){fprintf(out,"%s\n",uri);fclose(out);}}
    const char *error=getenv("ELF2JB_BROWSER_TEST_ERROR");
    return error?atoi(error):0;
}
