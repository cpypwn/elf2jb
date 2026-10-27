/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Exercise the real installer with recorded PS5 registration-service calls. */
#include "media_shortcut.h"
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct recording {
    int initialize_error, register_error;
    int initialize_calls, register_calls, terminate_calls;
    char title_id[64], app_root[4096], trace[16];
};

static void trace(struct recording *recording, char operation) {
    size_t length = strlen(recording->trace);
    if (length + 1 < sizeof(recording->trace)) {
        recording->trace[length] = operation;
        recording->trace[length + 1] = 0;
    }
}

static int initialize(void *opaque) {
    struct recording *recording = opaque;
    recording->initialize_calls++;
    trace(recording, 'I');
    return recording->initialize_error;
}

static int register_title(void *opaque, const char *title_id, const char *app_root) {
    struct recording *recording = opaque;
    recording->register_calls++;
    trace(recording, 'R');
    snprintf(recording->title_id, sizeof(recording->title_id), "%s", title_id);
    snprintf(recording->app_root, sizeof(recording->app_root), "%s", app_root);
    return recording->register_error;
}

static void terminate(void *opaque) {
    struct recording *recording = opaque;
    recording->terminate_calls++;
    trace(recording, 'T');
}

static void json_string(const char *text) {
    putchar('"');
    for (const unsigned char *p = (const unsigned char *)text; *p; p++) {
        if (*p == '"' || *p == '\\') {
            putchar('\\');
            putchar(*p);
        } else if (*p < 32) {
            printf("\\u%04x", *p);
        } else {
            putchar(*p);
        }
    }
    putchar('"');
}

int main(int argc, char **argv) {
    if (argc < 3 || argc > 5) {
        fputs("usage: media-shortcut-driver APP_ROOT STATE_ROOT [INITIALIZE_ERROR [REGISTER_ERROR]]\n", stderr);
        return 2;
    }
    struct recording recording = {0};
    if (argc > 3) recording.initialize_error = atoi(argv[3]);
    if (argc > 4) recording.register_error = atoi(argv[4]);
    const struct elf2jb_app_services services = {
        .initialize = initialize,
        .register_title = register_title,
        .terminate = terminate,
        .opaque = &recording,
    };
    int system_error = 0x12345;
    errno = 0;
    int result = elf2jb_install_media_shortcut(argv[1], argv[2], &services, &system_error);
    int saved_errno = errno;
    printf("{\"result\":%d,\"errno\":%d,\"system_error\":%d,"
           "\"initialize_calls\":%d,\"register_calls\":%d,\"terminate_calls\":%d,"
           "\"trace\":", result, saved_errno, system_error,
           recording.initialize_calls, recording.register_calls, recording.terminate_calls);
    json_string(recording.trace);
    fputs(",\"title_id\":", stdout);
    json_string(recording.title_id);
    fputs(",\"app_root\":", stdout);
    json_string(recording.app_root);
    puts("}");
    return 0;
}
