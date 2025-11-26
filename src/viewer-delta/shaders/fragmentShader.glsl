precision mediump float;

// Uniforms e Inputs
uniform sampler2D u_matcap;
in vec3 v_viewNormal;

// Output (WebGL 2 requer variável de saída explícita)
out vec4 fragColor;

void main() {
    // 1. Mapeamento Esférico (Matcap UV)
    // Projeta a normal do View Space para coordenadas UV [0, 1]
    vec2 uv = v_viewNormal.xy * 0.5 + 0.5;

    // 2. Amostragem
    vec3 color = texture(u_matcap, uv).rgb;

    fragColor = vec4(color, 1.0);
}
