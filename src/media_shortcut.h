/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef ELF2JB_MEDIA_SHORTCUT_H
#define ELF2JB_MEDIA_SHORTCUT_H
#include <stddef.h>

#define ELF2JB_SHORTCUT_TITLE_ID "ELFJ00001"
#define ELF2JB_SHORTCUT_TITLE_NAME "elf2jb Host"

struct elf2jb_app_services {
    int (*initialize)(void *opaque);
    int (*register_title)(void *opaque, const char *title_id, const char *app_root);
    void (*terminate)(void *opaque);
    void *opaque;
};

/* Returns 1 installed, 0 already current, -1 failure. Never registers other titles.
 * system_error contains a platform-service error; errno describes filesystem errors.
 */
int elf2jb_install_media_shortcut(const char *app_root, const char *state_root,
                                const struct elf2jb_app_services *services,
                                int *system_error);
extern const unsigned char media_param_json[], media_icon_png[], media_fingerprint[];
extern const size_t media_param_json_size, media_icon_png_size, media_fingerprint_size;
#endif
