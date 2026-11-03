#version 450
#extension GL_GOOGLE_include_directive : require
layout(location=0) out vec4 outColor;
#define STATE_ACCESS readonly
#include "state.glsl"
#include "text.glsl"

float ink(vec2 p, vec2 origin, ivec4 rect) {
    ivec2 q = ivec2(floor(p - origin));
    if (any(lessThan(p - origin, vec2(0.0))) || any(greaterThanEqual(q, rect.zw))) {
        return 0.0;
    }
    uint index = uint((q.y + rect.y) * 1024 + q.x + rect.x);
    uint word = c.atlas[index >> 2u];
    return float((word >> ((index & 3u) * 8u)) & 255u) / 255.0;
}

vec3 palette(float x) {
    return 0.55 + 0.45 * cos(6.2831853 * (vec3(0.04, 0.35, 0.66) + x));
}

void main() {
    vec2 p = gl_FragCoord.xy;
    vec2 uv = (p - vec2(960.0, 540.0)) / 540.0;
    float t = c.motion.x;
    float r = length(uv);
    float a = atan(uv.y, uv.x);
    float warp = sin(5.0 * a + 1.3 * t + 7.0 * r) * 0.035;
    vec3 color = mix(vec3(0.018, 0.043, 0.055), vec3(0.018, 0.085, 0.105), p.y / 1080.0);
    color += palette(0.08 * t + 0.11 * r) * 0.08 * exp(-4.0 * abs(r - 0.74 - warp));
    color += palette(0.06 * t + 0.22) * 0.11 * exp(-10.0 * abs(r - 0.92 + warp));
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float angle = t * (0.28 + 0.07 * fi) + fi * 6.2831853 / 5.0;
        vec2 center = vec2(960.0, 540.0) + vec2(cos(angle), sin(angle)) * (290.0 + 45.0 * sin(0.7 * t + fi));
        float d = length(p - center);
        vec3 glow = palette(fi / 5.0 + 0.04 * t);
        color += glow * (0.12 * exp(-d * d / 34000.0) + 0.25 * exp(-d * d / 1900.0));
    }
    float ribbon = abs(sin(a * 4.0 - t * 0.9 + r * 12.0));
    color += palette(0.16 * t + 0.38 * uv.x) * 0.07 * exp(-30.0 * ribbon) * smoothstep(0.3, 0.8, r);
    float shade = exp(-pow((p.y - 548.0) / 185.0, 2.0)) * exp(-pow((p.x - 960.0) / 650.0, 2.0));
    color *= 1.0 - 0.50 * shade;
    vec2 first = vec2((1920.0 - float(TEXT_FIRST.z)) * 0.5, 446.0);
    vec2 second = vec2((1920.0 - float(TEXT_SECOND.z)) * 0.5, 582.0);
    float shadow = max(ink(p, first + vec2(3.0, -3.0), TEXT_FIRST), ink(p, second + vec2(2.0, -2.0), TEXT_SECOND));
    color = mix(color, vec3(0.0, 0.01, 0.012), shadow * 0.75);
    color = mix(color, vec3(0.86, 1.0, 0.94), ink(p, first, TEXT_FIRST));
    color = mix(color, vec3(0.52, 0.98, 0.78), ink(p, second, TEXT_SECOND));
    outColor = vec4(clamp(color * (1.0 - c.transition.x), 0.0, 1.0), 1.0);
}
