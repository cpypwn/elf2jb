/* SPDX-License-Identifier: GPL-3.0-or-later */
/* PS5 port bring-up only. This does not run the ns2jb engine. */
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/utsname.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t stopping;
#ifdef __PROSPERO__
typedef struct { char reserved[45]; char message[3075]; } notify_request;
int sceKernelSendNotificationRequest(int, notify_request *, size_t, int);
static void notify(const char *message) {
    notify_request request = {0};
    snprintf(request.message, sizeof(request.message), "%s", message);
    (void)sceKernelSendNotificationRequest(0, &request, sizeof(request), 0);
}
#else
static void notify(const char *message) { (void)message; }
#endif
static const char page[] =
    "<!doctype html><html lang=en><meta charset=utf-8>"
    "<meta name=viewport content='width=device-width,initial-scale=1'>"
    "<title>elf2jb preflight</title><body>"
    "<h1>elf2jb preflight</h1><p>This is a PS5 compatibility test, "
    "not the working ns2jb host. No Switch exploit runs.</p>"
    "<p><a href=/status>Open the compatibility report</a> and send its contents "
    "to the developer. Restart the console when finished.</p></body></html>";

static void stop_server(int sig) { (void)sig; stopping = 1; }
static void *worker(void *arg) { *(int *)arg = 1; return NULL; }

/* Report only the success of a new temporary-file round trip, never existing data. */
static int storage_probe(const char *directory) {
    char name[512];
    const char value[] = "elf2jb storage probe\n";
    char actual[sizeof(value)] = {0};
    if (snprintf(name, sizeof(name), "%s/elf2jb-probe-XXXXXX", directory) >= (int)sizeof(name))
        return ENAMETOOLONG;
    int fd = mkstemp(name);
    if (fd < 0) return errno;
    int error = 0;
    if (write(fd, value, sizeof(value)) != (ssize_t)sizeof(value)) error = errno ? errno : EIO;
    if (!error && lseek(fd, 0, SEEK_SET) < 0) error = errno;
    if (!error && read(fd, actual, sizeof(actual)) != (ssize_t)sizeof(actual)) error = errno ? errno : EIO;
    if (!error && memcmp(value, actual, sizeof(value))) error = EIO;
    if (close(fd) && !error) error = errno;
    if (unlink(name) && !error) error = errno;
    return error;
}

static int send_all(int fd, const char *data, size_t size) {
    while (size) {
        ssize_t n = send(fd, data, size, 0);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return -1;
        data += n; size -= (size_t)n;
    }
    return 0;
}

static void respond(int fd, const char *status, const char *type, const char *body) {
    char header[512];
    int n = snprintf(header, sizeof(header),
        "HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\n"
        "Connection: close\r\nCache-Control: no-store\r\n"
        "X-Content-Type-Options: nosniff\r\n\r\n", status, type, strlen(body));
    if (n > 0 && n < (int)sizeof(header) && !send_all(fd, header, (size_t)n))
        (void)send_all(fd, body, strlen(body));
}

/* Bound both the length and time of requests so incomplete clients cannot hang us. */
static void serve_client(int fd, const char *report) {
    char request[2048];
    size_t used = 0;
    struct timespec started, now;
    if (clock_gettime(CLOCK_MONOTONIC, &started)) return;
    while (used < sizeof(request) - 1 && !stopping) {
        if (clock_gettime(CLOCK_MONOTONIC, &now) || now.tv_sec - started.tv_sec >= 3) return;
        struct pollfd waiter = {.fd = fd, .events = POLLIN};
        int ready = poll(&waiter, 1, 100);
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) return;
        if (!ready) continue;
        ssize_t n = recv(fd, request + used, sizeof(request) - 1 - used, 0);
        if (n <= 0) return;
        used += (size_t)n; request[used] = 0;
        if (!strstr(request, "\r\n\r\n")) continue;
        if (!strncmp(request, "GET /status HTTP/1.", 19))
            respond(fd, "200 OK", "application/json", report);
        else if (!strncmp(request, "GET / HTTP/1.", 13))
            respond(fd, "200 OK", "text/html; charset=utf-8", page);
        else respond(fd, "404 Not Found", "text/plain", "Not found\n");
        return;
    }
}

int main(int argc, char **argv) {
    unsigned long port = 8088;
    const char *directory = "/data";
    if (argc > 1) {
        char *end;
        port = strtoul(argv[1], &end, 10);
        if (!*argv[1] || *end || port < 1024 || port > 65535) return 2;
    }
    if (argc > 2) directory = argv[2];
    if (argc > 3) return 2;
    signal(SIGPIPE, SIG_IGN);
    signal(SIGINT, stop_server); signal(SIGTERM, stop_server);
    pthread_t thread;
    int thread_ran = 0, thread_error = pthread_create(&thread, NULL, worker, &thread_ran);
    if (!thread_error) thread_error = pthread_join(thread, NULL);
    int storage_error = storage_probe(directory);
    struct timespec ts;
    int clock_ok = clock_gettime(CLOCK_MONOTONIC, &ts) == 0;
    struct utsname system;
    int uname_ok = uname(&system) == 0;
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) { perror("socket"); return 1; }
    int one = 1;
    (void)setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
    struct sockaddr_in addr = {0};
#ifdef __FreeBSD__
    addr.sin_len = sizeof(addr);
#endif
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)port);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) || listen(fd, 4)) {
        notify("elf2jb preflight: cannot listen. Check whether port 8088 is already in use.");
        perror("listen"); close(fd); return 1;
    }
    char report[1024];
    snprintf(report, sizeof(report),
        "{\n  \"application\": \"elf2jb-preflight\",\n  \"version\": 1,\n"
        "  \"ns2jb_host_implemented\": false,\n  \"tcp_listen\": true,\n"
        "  \"pointer_bits\": %zu,\n  \"pthread\": %s,\n  \"pthread_error\": %d,\n"
        "  \"temporary_file_roundtrip\": %s,\n  \"storage_error\": %d,\n"
        "  \"monotonic_clock\": %s,\n  \"uname\": %s\n}\n",
        sizeof(void *) * 8, !thread_error && thread_ran ? "true" : "false", thread_error,
        !storage_error ? "true" : "false", storage_error,
        clock_ok ? "true" : "false", uname_ok ? "true" : "false");
    printf("elf2jb preflight listening on port %lu; ns2jb engine is not implemented.\n%s", port, report);
    fflush(stdout);
    notify("elf2jb preflight only: open http://YOUR-PS5-IP:8088/status on your phone. This is not the ns2jb host.");
    while (!stopping) {
        struct pollfd waiter = {.fd = fd, .events = POLLIN};
        int ready = poll(&waiter, 1, 200);
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) break;
        if (!ready) continue;
        int client = accept(fd, NULL, NULL);
        if (client < 0) continue;
        struct timeval timeout = {.tv_sec = 3};
        (void)setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
        serve_client(client, report);
        close(client);
    }
    close(fd);
    return 0;
}
