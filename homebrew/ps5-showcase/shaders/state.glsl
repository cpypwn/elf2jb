#ifndef STATE_ACCESS
#define STATE_ACCESS
#endif
layout(set=0,binding=0,std430) STATE_ACCESS buffer Controls {
    uvec4 raw[4];
    vec4 motion;
    uvec4 state;
    vec4 refresh;
    uvec4 library;
    uint touch[164];
    uvec4 game;
    ivec4 piece;
    vec4 flow;
    uvec4 bagMeta;
    uint bag[8];
    uint rows[20];
    vec4 transition;
    uvec4 events;
    uvec4 stats;
    uvec4 reserved;
    uint atlas[];
} c;
